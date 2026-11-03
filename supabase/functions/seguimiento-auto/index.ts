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
import {
  decidir, completarTexto, horaCordoba, aplicaRecupero, telefonoWhatsApp, TEXTOS_POR_DEFECTO,
  type ConfigSeguimiento, type LeadSeguimiento, type EnvioPrevio, type LeadRecupero, type ConfigRecupero,
} from './logica.ts'

const env = (n: string) => (Deno.env.get(n) ?? '').trim()
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sendpulse = env('SENDPULSE_API_URL') && env('SENDPULSE_CLIENT_ID') && env('SENDPULSE_CLIENT_SECRET')
  ? crearClienteSendPulse({ apiUrl: env('SENDPULSE_API_URL'), clientId: env('SENDPULSE_CLIENT_ID'), clientSecret: env('SENDPULSE_CLIENT_SECRET') })
  : null

const MAX_POR_CORRIDA = 40
const MAX_RECUPERO_POR_CORRIDA = 10
const NOMBRE_PASO: Record<string, string> = {
  p0_rescate: 'rescate de rechazado (agente de cierre)',
  p1_sin_respuesta: 'recordatorio 1 h',
  p1v_visita: 'invitación a ver la moto',
  p2_antes_24h: 'recordatorio antes de 24 h',
  p3_dia_2: 'seguimiento día 2 (plantilla)',
  p4_dia_5: 'seguimiento día 5 (plantilla)',
  p5_recupero: 'recupero por plantilla de WhatsApp',
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function ahoraAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
}

// Recupero (p5): plantilla de WhatsApp por teléfono a leads fríos. Apagado por defecto porque cada mensaje
// lo cobra Meta. crm_config: seguimiento_recupero_activo, _plantilla, _idioma, _bot_id, _max_dia,
// _puntaje_minimo, _dias_desde, _dias_hasta, _hora_desde, _hora_hasta.
interface ConfigRecuperoCompleta extends ConfigRecupero {
  activo: boolean; plantilla: string; idioma: string; botId: string; maxDia: number; horaDesde: number; horaHasta: number
}

async function leerConfigRecupero(): Promise<ConfigRecuperoCompleta> {
  const { data } = await db.from('crm_config').select('clave, valor').like('clave', 'seguimiento_recupero_%')
  const v: Record<string, string> = Object.fromEntries((data ?? []).map((r: { clave: string; valor: string }) => [r.clave.replace('seguimiento_recupero_', ''), String(r.valor ?? '').trim()]))
  const n = (k: string, def: number) => (v[k] !== undefined && v[k] !== '' && !Number.isNaN(Number(v[k])) ? Number(v[k]) : def)
  return {
    activo: v.activo === 'true',
    plantilla: v.plantilla || 'motobox_recupero_opciones',
    idioma: v.idioma || 'es_AR',
    botId: v.bot_id || '',
    maxDia: n('max_dia', 40),
    puntajeMinimo: n('puntaje_minimo', 45),
    puntajeMinimoPerdidos: n('puntaje_minimo_perdidos', 30),
    diasDesde: n('dias_desde', 3),
    diasHasta: n('dias_hasta', 90),
    horaDesde: n('hora_desde', 10),
    horaHasta: n('hora_hasta', 20),
  }
}

async function correrRecupero(ahora: Date, cupoCorrida: number) {
  const r = await leerConfigRecupero()
  const res = { recupero_activo: r.activo, recupero_enviados: 0, recupero_fallidos: 0, recupero_cupo_hoy: 0 }
  if (!r.activo || !r.botId || !sendpulse || cupoCorrida <= 0) return res
  const hora = horaCordoba(ahora)
  if (hora < r.horaDesde || hora >= r.horaHasta) return res

  // Tope por día de Córdoba (UTC-3): cuenta envíos y fallos desde las 00:00 de hoy.
  const inicioDia = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 3))
  if (inicioDia > ahora) inicioDia.setUTCDate(inicioDia.getUTCDate() - 1)
  const { count } = await db.from('seguimientos').select('id', { count: 'exact', head: true })
    .eq('paso', 'p5_recupero').gte('created_at', inicioDia.toISOString())
  const cupo = Math.min(cupoCorrida, r.maxDia - (count ?? 0))
  res.recupero_cupo_hoy = Math.max(r.maxDia - (count ?? 0), 0)
  if (cupo <= 0) return res

  const { data: leads } = await db.from('leads')
    .select('id, nombre, telefono, estado, prioridad, notas, duplicado_de, puntaje_compra, created_at, bot_ultimo_evento_at, primer_contacto_at')
    .not('telefono', 'is', null)
    .in('estado', ['nuevo', 'contactado', 'perdido'])
    .is('duplicado_de', null)
    .gte('puntaje_compra', Math.min(r.puntajeMinimo, r.puntajeMinimoPerdidos))
    .gte('created_at', new Date(ahora.getTime() - (r.diasHasta + 30) * 864e5).toISOString())
    .order('puntaje_compra', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300)
  const ids = (leads ?? []).map((l) => l.id)
  const previos = new Map<string, EnvioPrevio[]>()
  if (ids.length) {
    const { data: s } = await db.from('seguimientos').select('lead_id, paso, created_at').in('lead_id', ids)
    for (const x of s ?? []) previos.set(x.lead_id, [...(previos.get(x.lead_id) ?? []), { paso: x.paso, created_at: x.created_at }])
  }
  // Un solo mensaje por teléfono aunque haya dos leads con el mismo número.
  const telefonosUsados = new Set<string>()
  for (const l of (leads ?? []) as (LeadRecupero & { nombre: string | null })[]) {
    if (res.recupero_enviados + res.recupero_fallidos >= cupo) break
    if (!aplicaRecupero(l, previos.get(l.id) ?? [], ahora, r)) continue
    const tel = telefonoWhatsApp(l.telefono)!
    if (telefonosUsados.has(tel)) continue
    telefonosUsados.add(tel)

    const { data: reserva, error: errRes } = await db.from('seguimientos')
      .insert({ lead_id: l.id, paso: 'p5_recupero', canal: 'whatsapp', estado: 'enviando' })
      .select('id').maybeSingle()
    if (errRes || !reserva) continue
    const envio = await sendpulse.enviarPlantillaPorTelefono(r.botId, tel, r.plantilla, r.idioma)
    if (envio.ok) {
      await db.from('seguimientos').update({ estado: 'enviado', error: null, texto: `plantilla ${r.plantilla}` }).eq('id', reserva.id)
      res.recupero_enviados++
      const nota = `[${ahoraAR()}] Seguimiento automático: recupero por plantilla de WhatsApp enviado`
      await db.from('leads').update({ notas: [l.notas, nota].filter(Boolean).join('\n') }).eq('id', l.id)
    } else {
      res.recupero_fallidos++
      console.error('Recupero fallido', envio.error)
      ;(res as Record<string, unknown>).recupero_error = envio.error
      // Si en esta corrida ya salió alguno, el problema es del número (sin WhatsApp): queda como fallido.
      // Si es el primero que falla, puede ser la cuenta (sin saldo, SendPulse caído): se libera para reintentar
      // y se corta. Si ese mismo lead ya había fallado primero antes, se lo da por fallido para no trabar la cola.
      const yaFalloAntes = (previos.get(l.id) ?? []).some((p) => p.paso === 'p5_reintento')
      const deCuenta = /balance|saldo|insufficient|fondos|token|HTTP 5\d\d|HTTP 429|Sin respuesta/i.test(envio.error)
      if (res.recupero_enviados === 0 && (deCuenta || !yaFalloAntes)) {
        await db.from('seguimientos').delete().eq('id', reserva.id)
        if (!deCuenta) await db.from('seguimientos').insert({ lead_id: l.id, paso: 'p5_reintento', canal: 'whatsapp', estado: 'fallido', error: envio.error })
        break
      }
      await db.from('seguimientos').update({ estado: 'fallido', error: envio.error, texto: `plantilla ${r.plantilla}` }).eq('id', reserva.id)
    }
  }
  return res
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
  if (!activo && !pruebaLead) return json({ ok: true, activo: false, ...(await correrRecupero(new Date(), MAX_RECUPERO_POR_CORRIDA)) })
  if (!sendpulse) return json({ ok: false, error: 'Faltan las credenciales de SendPulse' }, 500)

  if (pruebaLead && pruebaPaso === 'p5_recupero') {
    const r = await leerConfigRecupero()
    const { data: l } = await db.from('leads').select('telefono').eq('id', pruebaLead).maybeSingle()
    const tel = telefonoWhatsApp(l?.telefono)
    if (!tel || !r.botId) return json({ ok: false, error: !tel ? 'Lead sin teléfono válido' : 'Falta seguimiento_recupero_bot_id' }, 400)
    const envio = await sendpulse.enviarPlantillaPorTelefono(r.botId, tel, r.plantilla, r.idioma)
    return json({ ok: envio.ok, prueba: true, paso: pruebaPaso, ...(envio.ok ? {} : { error: envio.error }) })
  }

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

  const recupero = await correrRecupero(ahora, Math.min(MAX_RECUPERO_POR_CORRIDA, MAX_POR_CORRIDA - resultado.enviados - resultado.fallidos))
  return json({ ok: true, activo: true, ...resultado, ...recupero })
})
