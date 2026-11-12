// Supabase Edge Function: sendpulse-eventos
// Webhook de SendPulse (Configuración del bot → Webhooks) que guarda cada mensaje entrante y saliente
// en agente_eventos para verlo en vivo en el CRM. Autenticación: ?k=<token> contra secretos_internos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizar, eventosDelBody, claveTelefono } from './eventos.ts'

const json = (payload: unknown, status: number) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

let tokenCache: string | null = null

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true }, 200) // SendPulse a veces prueba la URL con GET

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  if (!tokenCache) {
    const { data } = await db.from('secretos_internos').select('valor').eq('clave', 'agente_webhook_token').maybeSingle()
    tokenCache = data?.valor ?? null
  }
  const k = new URL(req.url).searchParams.get('k')
  if (!tokenCache || k !== tokenCache) return json({ error: 'No autorizado' }, 401)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const filas = []
  for (const ev of eventosDelBody(body)) {
    const e = normalizar(ev)
    let leadId: string | null = null
    if (e.contact_id) {
      const { data } = await db.from('leads').select('id').eq('sendpulse_contact_id', e.contact_id).order('created_at', { ascending: false }).limit(1)
      leadId = data?.[0]?.id ?? null
    }
    if (!leadId && e.telefono && claveTelefono(e.telefono).length >= 8) {
      const clave = claveTelefono(e.telefono)
      const { data } = await db.from('leads').select('id, telefono').ilike('telefono', `%${clave.slice(-6)}%`).order('created_at', { ascending: false }).limit(30)
      leadId = (data ?? []).find((l) => l.telefono && claveTelefono(l.telefono) === clave)?.id ?? null
    }
    // El raw queda para revisar formatos nuevos; se recorta para no inflar la tabla.
    const raw = JSON.stringify(ev)
    filas.push({ ...e, lead_id: leadId, raw: raw.length > 20000 ? { recortado: true, title: ev.title } : ev })
  }

  if (filas.length) {
    const { error } = await db.from('agente_eventos').insert(filas)
    if (error) {
      console.error('No se pudo guardar el evento', error.message)
      return json({ error: 'No se pudo guardar' }, 500)
    }
  }
  return json({ ok: true, guardados: filas.length }, 200)
})
