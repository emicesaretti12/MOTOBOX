// Cliente mínimo de la API de chatbots de SendPulse (WhatsApp e Instagram).
//   Token:          POST {SENDPULSE_API_URL}/oauth/access_token  (client_credentials, dura ~1 h)
//   Ejecutar flujo: POST {SENDPULSE_API_URL}/{canal}/flows/run  { contact_id, flow_id }  (canal: whatsapp | instagram)
// Sin dependencias de Deno para poder testearlo con Vitest.

export interface ConfigSendPulse {
  apiUrl: string
  clientId: string
  clientSecret: string
  timeoutMs?: number
  // Esperas entre intentos: con [500, 1500] se hacen hasta 3 intentos.
  esperasMs?: number[]
}

export type ResultadoAviso =
  | { ok: true; intentos: number }
  | { ok: false; intentos: number; error: string }

export type CanalSendPulse = 'whatsapp' | 'instagram'

export interface ClienteSendPulse {
  ejecutarFlujo(contactId: string, flowId: string, canal?: CanalSendPulse): Promise<ResultadoAviso>
}

interface Dependencias {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
}

class ErrorSendPulse extends Error {
  constructor(message: string, readonly reintentable: boolean) {
    super(message)
  }
}

// Los errores se guardan y se muestran: nunca con números largos (DNI, teléfonos).
export function sanitizarError(texto: unknown): string {
  return String(texto ?? '')
    .replace(/\d{7,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function describirRespuesta(status: number, cuerpo: unknown): string {
  let detalle = ''
  if (cuerpo && typeof cuerpo === 'object') {
    const c = cuerpo as Record<string, unknown>
    detalle = String(c.message ?? c.error_description ?? c.error ?? JSON.stringify(c))
  } else if (typeof cuerpo === 'string') {
    detalle = cuerpo
  }
  return `SendPulse respondió HTTP ${status}${detalle ? `: ${detalle}` : ''}`
}

async function leerCuerpo(res: Response): Promise<unknown> {
  const texto = await res.text()
  if (!texto) return null
  try {
    return JSON.parse(texto)
  } catch {
    return texto
  }
}

export function crearClienteSendPulse(cfg: ConfigSendPulse, deps: Partial<Dependencias> = {}): ClienteSendPulse {
  const d: Dependencias = {
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: deps.now ?? (() => Date.now()),
  }
  const base = cfg.apiUrl.replace(/\/+$/, '')
  const timeoutMs = cfg.timeoutMs ?? 8000
  const esperas = cfg.esperasMs ?? [500, 1500]
  let token: { valor: string; vence: number } | null = null

  async function pedir(url: string, init: RequestInit): Promise<Response> {
    const control = new AbortController()
    const reloj = setTimeout(() => control.abort(), timeoutMs)
    try {
      return await d.fetch(url, { ...init, signal: control.signal })
    } catch {
      throw new ErrorSendPulse('Sin respuesta de SendPulse (red o tiempo agotado)', true)
    } finally {
      clearTimeout(reloj)
    }
  }

  async function obtenerToken(): Promise<string> {
    if (token && token.vence > d.now()) return token.valor
    const res = await pedir(`${base}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    })
    const cuerpo = await leerCuerpo(res) as Record<string, unknown> | null
    if (!res.ok || !cuerpo || typeof cuerpo.access_token !== 'string') {
      throw new ErrorSendPulse(`No se pudo obtener el token de SendPulse (HTTP ${res.status})`, res.status === 429 || res.status >= 500)
    }
    const segundos = Number(cuerpo.expires_in) || 3600
    token = { valor: cuerpo.access_token, vence: d.now() + Math.max(segundos - 60, 30) * 1000 }
    return token.valor
  }

  async function ejecutarFlujo(contactId: string, flowId: string, canal: CanalSendPulse = 'whatsapp'): Promise<ResultadoAviso> {
    const ruta = canal === 'instagram' ? 'instagram' : 'whatsapp'
    const maxIntentos = esperas.length + 1
    let intento = 0
    let tokenRenovado = false
    let ultimoError = ''

    while (intento < maxIntentos) {
      intento++
      try {
        const valor = await obtenerToken()
        const res = await pedir(`${base}/${ruta}/flows/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${valor}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: contactId, flow_id: flowId }),
        })
        // Token vencido antes de tiempo: se pide uno nuevo una sola vez, sin contar como intento.
        if (res.status === 401 && !tokenRenovado) {
          token = null
          tokenRenovado = true
          intento--
          continue
        }
        const cuerpo = await leerCuerpo(res)
        const exito = res.ok && !(cuerpo && typeof cuerpo === 'object' && (cuerpo as Record<string, unknown>).success === false)
        if (exito) return { ok: true, intentos: intento }

        ultimoError = describirRespuesta(res.status, cuerpo)
        if (!(res.status === 429 || res.status >= 500)) {
          return { ok: false, intentos: intento, error: sanitizarError(ultimoError) }
        }
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e)
        if (e instanceof ErrorSendPulse && !e.reintentable) {
          return { ok: false, intentos: intento, error: sanitizarError(ultimoError) }
        }
      }
      if (intento < maxIntentos) await d.sleep(esperas[intento - 1])
    }
    return { ok: false, intentos: maxIntentos, error: sanitizarError(ultimoError) }
  }

  return { ejecutarFlujo }
}
