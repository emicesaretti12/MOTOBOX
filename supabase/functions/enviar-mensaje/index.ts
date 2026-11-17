// Supabase Edge Function: enviar-mensaje
// El vendedor contesta el WhatsApp o Instagram del cliente desde la ficha del lead.
// verify_jwt = true: solo usuarios logueados. El acceso al lead se valida con SU sesión (RLS): un vendedor solo
// puede escribirle a sus leads. El envío sale por la API de SendPulse y el bot se pausa una hora para no pisarse.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crearClienteSendPulse } from './sendpulse.ts'
import { ventanaAbierta, validarTexto, canalDelLead } from './logica.ts'

const env = (n: string) => (Deno.env.get(n) ?? '').trim()
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const sendpulse = crearClienteSendPulse({ apiUrl: env('SENDPULSE_API_URL'), clientId: env('SENDPULSE_CLIENT_ID'), clientSecret: env('SENDPULSE_CLIENT_SECRET') })
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const usuario = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: quien } = await usuario.auth.getUser()
  if (!quien?.user) return json({ error: 'Iniciá sesión de nuevo' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Pedido inválido' }, 400) }
  let texto: string
  try { texto = validarTexto(body.texto) } catch (e) { return json({ error: (e as Error).message }, 400) }

  // Con la sesión del usuario: si RLS no le deja ver el lead, no le puede escribir.
  const { data: lead } = await usuario.from('leads')
    .select('id, nombre, telefono, origen, estado, sendpulse_contact_id, vendedor_asignado')
    .eq('id', String(body.lead_id ?? '')).maybeSingle()
  if (!lead) return json({ error: 'No tenés acceso a este lead' }, 403)
  if (!lead.sendpulse_contact_id) return json({ error: 'Este lead no tiene chat en SendPulse. Escribile desde el botón WhatsApp.' }, 400)

  const { data: ultimos } = await admin.from('agente_eventos').select('canal, tipo, created_at')
    .eq('contact_id', lead.sendpulse_contact_id).in('tipo', ['mensaje_entrante', 'mensaje_saliente'])
    .order('created_at', { ascending: false }).limit(50)
  const canal = canalDelLead(lead.origen, ultimos?.[0]?.canal ?? null)
  const ultimoEntrante = (ultimos ?? []).find((e) => e.tipo === 'mensaje_entrante') ?? null
  if (ultimoEntrante && !ventanaAbierta(ultimoEntrante, new Date())) {
    return json({ error: 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp/Instagram no deja escribirle libre por el bot. Escribile desde tu WhatsApp.', fuera_de_ventana: true }, 409)
  }

  const envio = await sendpulse.enviarTexto(lead.sendpulse_contact_id, texto, canal)
  if (!envio.ok) {
    const fuera = /24|window|ventana|re-engagement|131047/i.test(envio.error)
    return json({ error: fuera ? 'El cliente no escribió en las últimas 24 h: escribile desde tu WhatsApp.' : `SendPulse no pudo enviarlo: ${envio.error}` }, fuera ? 409 : 502)
  }

  const { data: perfil } = await admin.from('profiles').select('full_name').eq('id', quien.user.id).maybeSingle()
  await admin.from('agente_eventos').insert({
    canal, tipo: 'mensaje_saliente', autor: 'humano', contact_id: lead.sendpulse_contact_id, telefono: lead.telefono,
    nombre: lead.nombre, lead_id: lead.id, texto, raw: { desde_crm: true, usuario: quien.user.id, vendedor: perfil?.full_name ?? null },
  })
  const cambios: Record<string, unknown> = { ultimo_contacto_at: new Date().toISOString() }
  if (lead.estado === 'nuevo') cambios.estado = 'contactado'
  if (!lead.vendedor_asignado) cambios.vendedor_asignado = quien.user.id
  await usuario.from('leads').update(cambios).eq('id', lead.id)

  return json({ ok: true, canal })
})
