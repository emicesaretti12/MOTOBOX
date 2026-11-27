// Supabase Edge Function: enviar-push
// La llama la base (trigger trg_leads_aviso_push, migración 030) cuando un lead se vuelve "listo para comprar".
// Manda una notificación al celular/compu del vendedor asignado (o a los admins), aunque tengan el CRM cerrado.
//
// Autenticación: header x-push-secret, comparado con secretos_internos.push_token. verify_jwt = false.
// Variables de entorno: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { textoAviso, destinatarios } from './logica.ts'

const env = (n: string) => (Deno.env.get(n) ?? '').trim()
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@motoboxcordoba.online', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))

const json = (p: unknown, status = 200) => new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  const secreto = req.headers.get('x-push-secret') ?? ''
  const { data: token } = await db.from('secretos_internos').select('valor').eq('clave', 'push_token').maybeSingle()
  if (!secreto || !token?.valor || secreto !== token.valor) return json({ error: 'No autorizado' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Pedido inválido' }, 400) }

  const { data: lead } = await db.from('leads')
    .select('id, nombre, modelo_interes, forma_pago, caliente_motivo, bcra_resultado, vendedor_asignado, caliente_atendido_at')
    .eq('id', String(body.lead_id ?? '')).maybeSingle()
  if (!lead || lead.caliente_atendido_at) return json({ ok: true, enviados: 0 })

  let admins: string[] = []
  if (!lead.vendedor_asignado) {
    const { data } = await db.from('profiles').select('id').eq('role', 'admin')
    admins = (data ?? []).map((p) => p.id)
  }
  const usuarios = destinatarios(lead.vendedor_asignado, admins)
  if (!usuarios.length) return json({ ok: true, enviados: 0 })

  const { data: subs } = await db.from('push_suscripciones').select('endpoint, p256dh, auth').in('user_id', usuarios)
  const aviso = JSON.stringify(textoAviso(lead))
  let enviados = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, aviso, { TTL: 3600, urgency: 'high' })
      enviados++
      await db.from('push_suscripciones').update({ ultimo_envio_at: new Date().toISOString() }).eq('endpoint', s.endpoint)
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      // El celular desinstaló la app o revocó el permiso: se borra la suscripción vieja.
      if (code === 404 || code === 410) await db.from('push_suscripciones').delete().eq('endpoint', s.endpoint)
    }
  }
  return json({ ok: true, enviados })
})
