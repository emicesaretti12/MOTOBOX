// Supabase Edge Function: seguimiento-auto
// La llama Supabase Cron cada 15 minutos (migración 016). Busca leads que dejaron de responder y les manda
// el siguiente paso de seguimiento por SendPulse (reglas en logica.ts). Cada paso se manda una sola vez por
// lead: la tabla seguimientos tiene (lead_id, paso) único y se reserva ANTES de enviar.
//
// Autenticación: header x-cron-secret, comparado en la base contra el secreto del Vault
// (función seguimiento_token_valido, solo service_role). verify_jwt = false.
//
// Variables de entorno: las mismas de dni-resolver (SENDPULSE_API_URL, SENDPULSE_CLIENT_ID, SENDPULSE_CLIENT_SECRET).
// Configuración en crm_config (sin redesplegar): seguimiento_activo, seguimiento_hora_desde/hasta,
// seguimiento_texto_p1 / p2 y seguimiento_flujo_p3 / p4 (IDs de flujos de WhatsApp con plantilla).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crearClienteSendPulse } from './sendpulse.ts'
import { decidir, completarTexto, TEXTOS_POR_DEFECTO, type ConfigSeguimiento, type LeadSeguimiento, type EnvioPrevio } from './logica.ts'

const env = (n: string) => (Deno.env.get(n) ?? '').trim()
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sendpulse = env('SENDPULSE_API_URL') && env('SENDPULSE_CLIENT_ID') && env('SENDPULSE_CLIENT_SECRET')
  ? crearClienteSendPulse({ apiUrl: env('SENDPULSE_API_URL'), clientId: env('SENDPULSE_CLIENT_ID'), clientSecret: env('SENDPULSE_CLIENT_SECRET') })
  : null

const MAX_POR_CORRIDA = 40
const NOMBRE_PASO: Record<string, string> = {
  p0_rescate: 'rescate de rechazado (agente de cierre)',
  p1_sin_respuesta: 'recordatorio 1 h',
  p1v_visita: 'invitación a ver la moto',
  p2_antes_24h: 'recordatorio antes de 24 h',
  p3_dia_2: 'seguimiento día 2 (plantilla)',
  p4_dia_5: 'seguimiento día 5 (plantilla)',
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function ahoraAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
}

async function leerConfig(): Promise<{ activo: boolean; cfg: ConfigSeguimiento }> {
  const { data } = await db.from('crm_config').select('clave, valor').like('clave', 'seguimiento_%')
  const v: Record<string, string> = Object.fromEntries((data ?? []).map((r: { clave: string; valor: string }) => [r.clave, String(r.valor ?? '')]))
  const textoOVacio = (k: string, def: string) => (v[k] && v[k].trim()) || def
  return {
    activo: v.seguimiento_activo === 'true',
    cfg: {
      horaDesde: Number(v.seguimiento_hora_desde) || 9,
      horaHasta: Number(v.seguimiento_hora_hasta) || 21,
      separacionMinHoras: Number(v.seguimiento_separacion_horas) || 6,
      textos: {
        p1_sin_respuesta: textoOVacio('seguimiento_texto_p1', TEXTOS_POR_DEFECTO.p1_sin_respuesta),
        p2_antes_24h: textoOVacio('seguimiento_texto_p2', TEXTOS_POR_DEFECTO.p2_antes_24h),
      },
      flujos: {
        p0_rescate_whatsapp: v.seguimiento_flujo_rescate_whatsapp?.trim() || undefined,
        p0_rescate_instagram: v.seguimiento_flujo_rescate_instagram?.trim() || undefined,
        p3_dia_2: v.seguimiento_flujo_p3?.trim() || undefined,
        p4_dia_5: v.seguimiento_flujo_p4?.trim() || undefined,
      },
    },
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const token = req.headers.get('x-cron-secret') ?? ''
  const { data: valido, error: errToken } = await db.rpc('seguimiento_token_valido', { p_token: token })
  if (errToken || valido !== true) return json({ error: 'No autorizado' }, 401)

  // Prueba sobre un solo lead: { "prueba_lead_id": "...", "prueba_paso": "p0_rescate" } manda ese paso ya,
  // sin mirar si el seguimiento está activo ni la ventana de horas (sí exige el secreto del cron).
  let pedido: Record<string, unknown> = {}
  try { pedido = await req.json() } catch { /* cuerpo vacío */ }
  const pruebaLead = typeof pedido.prueba_lead_id === 'string' ? pedido.prueba_lead_id : null
  const pruebaPaso = typeof pedido.prueba_paso === 'string' ? pedido.prueba_paso : null

  const { activo, cfg } = await leerConfig()
  if (!activo && !pruebaLead) return json({ ok: true, activo: false })
  if (!sendpulse) return json({ ok: false, error: 'Faltan las credenciales de SendPulse' }, 500)

  if (pruebaLead && pruebaPaso) {
    const { data: l } = await db.from('leads').select('id, nombre, origen, modelo_interes, sendpulse_contact_id').eq('id', pruebaLead).maybeSingle()
    if (!l?.sendpulse_contact_id) return json({ ok: false, error: 'Lead sin contacto de SendPulse' }, 400)
    const canal = l.origen === 'instagram' ? 'instagram' : 'whatsapp'
    const flowId = cfg.flujos[`${pruebaPaso}_${canal}`] ?? cfg.flujos[pruebaPaso]
    const texto = cfg.textos[pruebaPaso]
    const envio = flowId
      ? await sendpulse.ejecutarFlujo(l.sendpulse_contact_id, flowId, canal)
      : texto
        ? await sendpulse.enviarTexto(l.sendpulse_contact_id, completarTexto(texto, l as LeadSeguimiento), canal)
        : { ok: false as const, intentos: 0, error: 'Paso sin flujo ni texto configurado' }
    return json({ ok: envio.ok, prueba: true, canal, paso: pruebaPaso, ...(envio.ok ? {} : { error: envio.error }) })
  }

  const desde = new Date(Date.now() - 7 * 24 * 36e5).toISOString()
  const { data: leads, error } = await db.from('leads')
    .select('id, nombre, origen, estado, prioridad, forma_pago, estado_dni, bcra_resultado, modelo_interes, sendpulse_contact_id, bot_ultimo_evento_at, notas, fecha_agenda, duplicado_de, puntaje_compra')
    .gte('bot_ultimo_evento_at', desde)
    .not('sendpulse_contact_id', 'is', null)
    .in('origen', ['instagram', 'whatsapp'])
    .not('estado', 'in', '(venta_cerrada,perdido,en_negociacion)')
    // Primero los que más chances tienen de comprar (si hay más envíos que el máximo por corrida).
    .order('puntaje_compra', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) {
    console.error('No se pudieron leer los leads', error.code)
    return json({ ok: false, error: 'lectura' }, 500)
  }

  const ids = (leads ?? []).map((l) => l.id)
  const previos = new Map<string, EnvioPrevio[]>()
  if (ids.length) {
    const { data: env2 } = await db.from('seguimientos').select('lead_id, paso, created_at').in('lead_id', ids)
    for (const s of env2 ?? []) {
      const lista = previos.get(s.lead_id) ?? []
      lista.push({ paso: s.paso, created_at: s.created_at })
      previos.set(s.lead_id, lista)
    }
  }

  const ahora = new Date()
  const resultado = { revisados: ids.length, enviados: 0, fallidos: 0 }
  for (const l of (leads ?? []) as (LeadSeguimiento & { notas: string | null })[]) {
    if (resultado.enviados + resultado.fallidos >= MAX_POR_CORRIDA) break
    const d = decidir(l, previos.get(l.id) ?? [], ahora, cfg)
    if (!d) continue

    // Reserva: si otro proceso ya lo tomó, el índice único lo impide y se saltea.
    const { data: reserva, error: errRes } = await db.from('seguimientos')
      .insert({ lead_id: l.id, paso: d.paso, canal: d.canal, estado: 'enviando' })
      .select('id').maybeSingle()
    if (errRes || !reserva) continue

    const envio = d.tipo === 'texto'
      ? await sendpulse.enviarTexto(l.sendpulse_contact_id!, d.texto, d.canal)
      : await sendpulse.ejecutarFlujo(l.sendpulse_contact_id!, d.flowId, d.canal)

    await db.from('seguimientos').update({
      estado: envio.ok ? 'enviado' : 'fallido',
      error: envio.ok ? null : envio.error,
      texto: d.tipo === 'texto' ? d.texto : null,
    }).eq('id', reserva.id)

    if (envio.ok) {
      resultado.enviados++
      const nota = `[${ahoraAR()}] Seguimiento automático: ${NOMBRE_PASO[d.paso] ?? d.paso} enviado por ${d.canal}`
      await db.from('leads').update({ notas: [l.notas, nota].filter(Boolean).join('\n') }).eq('id', l.id)
    } else {
      resultado.fallidos++
    }
  }

  return json({ ok: true, activo: true, ...resultado })
})
