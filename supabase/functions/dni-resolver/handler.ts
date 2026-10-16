// Lógica de la edge function dni-resolver, separada del arranque de Deno para poder testearla.
//
// accion = "resolver":         registra el resultado con la sesión del operador (función SQL dni_resolver)
//                              y después le pide a SendPulse que ejecute el flujo "DNI aprobado" o "DNI rechazado".
// accion = "reintentar_aviso": vuelve a intentar el aviso de una resolución que no se pudo avisar.
//
// El resultado se guarda ANTES de llamar a SendPulse: si SendPulse falla, el resultado no se pierde
// y la resolución queda como "fallido" para que el operador la reintente o avise a mano.

import { sanitizarError, type ClienteSendPulse, type CanalSendPulse } from './sendpulse.ts'

type ErrorBase = { message: string; code?: string } | null
type RespuestaRpc = { data: any; error: ErrorBase }

export interface Dependencias {
  // Orígenes permitidos para CORS. Vacío = cualquiera (la seguridad la da el token del usuario).
  origenesPermitidos: string[]
  // Llama a una función SQL con el token del operador (auth.uid() = operador).
  rpcComoUsuario: (authorization: string, funcion: string, args: Record<string, unknown>) => Promise<RespuestaRpc>
  // Llama a una función SQL con la clave de servicio (solo para registrar el aviso).
  rpcServicio: (funcion: string, args: Record<string, unknown>) => Promise<RespuestaRpc>
  sendpulse: ClienteSendPulse | null
  // Flujos de WhatsApp (por defecto) y, opcionalmente, los del bot de Instagram.
  flujos: { aprobado?: string; rechazado?: string; instagram?: { aprobado?: string; rechazado?: string } }
  // Canal del lead de una resolución (según leads.origen). Sin esto, o si falla, se usa WhatsApp.
  canalDeResolucion?: (resolucionId: string) => Promise<CanalSendPulse>
  log?: Pick<Console, 'error' | 'warn'>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTO_MAXIMO = 999_999_999

const ERRORES_CONOCIDOS: Record<string, number> = {
  SIN_PERMISO: 403,
  COLA_DESACTIVADA: 409,
  RESULTADO_INVALIDO: 400,
  MONTO_INVALIDO: 400,
  LEAD_NO_ENCONTRADO: 404,
  RESOLUCION_NO_ENCONTRADA: 404,
}

function cabecerasCors(origen: string | null, permitidos: string[]): Record<string, string> {
  const base = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (permitidos.length === 0) return { ...base, 'Access-Control-Allow-Origin': '*' }
  if (origen && permitidos.includes(origen)) return { ...base, 'Access-Control-Allow-Origin': origen }
  return base
}

function json(payload: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function respuestaDeError(error: NonNullable<ErrorBase>, cors: Record<string, string>, log: Pick<Console, 'error'>) {
  const motivo = Object.keys(ERRORES_CONOCIDOS).find((m) => error.message?.includes(m))
  if (motivo) return json({ ok: false, motivo }, ERRORES_CONOCIDOS[motivo], cors)
  if (/jwt|token/i.test(error.message ?? '')) return json({ ok: false, motivo: 'NO_AUTORIZADO' }, 401, cors)
  // Solo el código: el mensaje de Postgres puede traer datos de la fila.
  log.error('Error de base de datos', error.code ?? 'sin_codigo')
  return json({ ok: false, motivo: 'ERROR_INTERNO' }, 500, cors)
}

async function avisar(
  deps: Dependencias,
  resolucionId: string,
  resultado: 'aprobado' | 'rechazado',
  contactId: string,
  log: Pick<Console, 'error' | 'warn'>
): Promise<{ estado: 'enviado' | 'fallido'; error?: string }> {
  let canal: CanalSendPulse = 'whatsapp'
  if (deps.canalDeResolucion) {
    try {
      canal = await deps.canalDeResolucion(resolucionId)
    } catch {
      log.warn('No se pudo determinar el canal del lead; se usa WhatsApp')
    }
  }
  const flujoDe = (c: CanalSendPulse) => (c === 'instagram' ? deps.flujos.instagram?.[resultado] : deps.flujos[resultado])
  const enviarPor = (c: CanalSendPulse, flowId: string) =>
    c === 'instagram'
      ? deps.sendpulse!.ejecutarFlujo(contactId, flowId, 'instagram')
      : deps.sendpulse!.ejecutarFlujo(contactId, flowId)

  const flowId = flujoDe(canal)
  let envio = !deps.sendpulse || !flowId
    ? { ok: false as const, intentos: 0, error: `Falta configurar SendPulse (credenciales, URL o ID del flujo${canal === 'instagram' ? ' de Instagram' : ''})` }
    : await enviarPor(canal, flowId)

  // El contacto guardado puede ser del otro bot (p. ej. un lead que entró por Instagram y después
  // escribió por WhatsApp con el mismo teléfono). Si SendPulse lo rechaza, se prueba por el otro canal.
  if (!envio.ok && deps.sendpulse && deps.canalDeResolucion) {
    const otro: CanalSendPulse = canal === 'instagram' ? 'whatsapp' : 'instagram'
    const otroFlujo = flujoDe(otro)
    if (otroFlujo) {
      const segundo = await enviarPor(otro, otroFlujo)
      envio = segundo.ok
        ? { ok: true as const, intentos: envio.intentos + segundo.intentos }
        : { ...envio, intentos: envio.intentos + segundo.intentos }
    }
  }

  const { error } = await deps.rpcServicio('dni_registrar_aviso', {
    p_resolucion_id: resolucionId,
    p_enviado: envio.ok,
    p_intentos: envio.intentos,
    p_error: envio.ok ? null : envio.error,
  })
  if (error) {
    // El resultado ya está guardado; el aviso queda "pendiente" y aparece en "sin avisar" a los 2 minutos.
    log.error('No se pudo registrar el estado del aviso', error.code ?? 'sin_codigo')
  }
  return envio.ok ? { estado: 'enviado' } : { estado: 'fallido', error: sanitizarError(envio.error) }
}

async function resolver(body: Record<string, unknown>, authorization: string, deps: Dependencias, cors: Record<string, string>, log: Pick<Console, 'error' | 'warn'>) {
  const leadId = body.lead_id
  const intento = body.intento
  const resultado = body.resultado
  const monto = body.monto ?? null

  if (typeof leadId !== 'string' || !UUID.test(leadId)) return json({ ok: false, motivo: 'LEAD_INVALIDO' }, 400, cors)
  if (typeof intento !== 'number' || !Number.isInteger(intento) || intento < 0) return json({ ok: false, motivo: 'INTENTO_INVALIDO' }, 400, cors)
  if (resultado !== 'aprobado' && resultado !== 'rechazado') return json({ ok: false, motivo: 'RESULTADO_INVALIDO' }, 400, cors)
  if (monto !== null && (typeof monto !== 'number' || !Number.isFinite(monto) || monto < 0 || monto > MONTO_MAXIMO)) {
    return json({ ok: false, motivo: 'MONTO_INVALIDO' }, 400, cors)
  }

  const { data, error } = await deps.rpcComoUsuario(authorization, 'dni_resolver', {
    p_lead_id: leadId,
    p_intento: intento,
    p_resultado: resultado,
    p_monto: resultado === 'aprobado' ? monto : null,
  })
  if (error) return respuestaDeError(error, cors, log)
  if (!data?.ok) return json({ ok: false, ...data }, 409, cors)

  const aviso = data.aviso_estado === 'pendiente' && data.sendpulse_contact_id
    ? await avisar(deps, data.resolucion_id, data.resultado, data.sendpulse_contact_id, log)
    : { estado: data.aviso_estado as string }

  return json({
    ok: true,
    resolucion_id: data.resolucion_id,
    resultado: data.resultado,
    monto_aprobado: data.monto_aprobado,
    aviso,
  }, 200, cors)
}

async function reintentarAviso(body: Record<string, unknown>, authorization: string, deps: Dependencias, cors: Record<string, string>, log: Pick<Console, 'error' | 'warn'>) {
  const resolucionId = body.resolucion_id
  if (typeof resolucionId !== 'string' || !UUID.test(resolucionId)) return json({ ok: false, motivo: 'RESOLUCION_INVALIDA' }, 400, cors)

  const { data, error } = await deps.rpcComoUsuario(authorization, 'dni_preparar_reintento', { p_resolucion_id: resolucionId })
  if (error) return respuestaDeError(error, cors, log)
  if (!data?.ok) return json({ ok: false, ...data }, 409, cors)

  const aviso = await avisar(deps, data.resolucion_id, data.resultado, data.sendpulse_contact_id, log)
  return json({ ok: true, resolucion_id: data.resolucion_id, resultado: data.resultado, aviso }, 200, cors)
}

export async function handleRequest(req: Request, deps: Dependencias): Promise<Response> {
  const log = deps.log ?? console
  const cors = cabecerasCors(req.headers.get('origin'), deps.origenesPermitidos)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, motivo: 'METODO_NO_PERMITIDO' }, 405, cors)

  const authorization = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ ok: false, motivo: 'NO_AUTORIZADO' }, 401, cors)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, motivo: 'JSON_INVALIDO' }, 400, cors)
  }
  if (!body || typeof body !== 'object') return json({ ok: false, motivo: 'JSON_INVALIDO' }, 400, cors)

  try {
    if (body.accion === 'resolver') return await resolver(body, authorization, deps, cors, log)
    if (body.accion === 'reintentar_aviso') return await reintentarAviso(body, authorization, deps, cors, log)
    return json({ ok: false, motivo: 'ACCION_INVALIDA' }, 400, cors)
  } catch (e) {
    log.error('Error inesperado en dni-resolver', e instanceof Error ? e.name : 'desconocido')
    return json({ ok: false, motivo: 'ERROR_INTERNO' }, 500, cors)
  }
}
