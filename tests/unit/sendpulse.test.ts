import { describe, it, expect, vi } from 'vitest'
import { crearClienteSendPulse, sanitizarError } from '../../supabase/functions/dni-resolver/sendpulse.ts'

const CFG = { apiUrl: 'https://api.ejemplo.test/', clientId: 'id', clientSecret: 'secreto', esperasMs: [10, 20] }

function respuesta(status: number, cuerpo?: unknown) {
  return new Response(cuerpo === undefined ? '' : JSON.stringify(cuerpo), { status })
}

function fetchFalso(respuestas: Array<Response | Error>) {
  const llamadas: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    const r = respuestas.shift()
    if (!r) throw new Error('sin más respuestas preparadas')
    if (r instanceof Error) throw r
    return r
  })
  return { fn: fn as unknown as typeof fetch, llamadas }
}

const TOKEN_OK = () => respuesta(200, { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 })

describe('cliente SendPulse', () => {
  it('pide el token con client_credentials y ejecuta el flujo para el contacto', async () => {
    const { fn, llamadas } = fetchFalso([TOKEN_OK(), respuesta(200, { success: true })])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async () => {} })
    expect(await sp.ejecutarFlujo('contacto-1', 'flujo-aprobado')).toEqual({ ok: true, intentos: 1 })

    expect(llamadas[0].url).toBe('https://api.ejemplo.test/oauth/access_token')
    expect(JSON.parse(String(llamadas[0].init.body))).toEqual({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'secreto' })
    expect(llamadas[1].url).toBe('https://api.ejemplo.test/whatsapp/flows/run')
    expect((llamadas[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(String(llamadas[1].init.body))).toEqual({ contact_id: 'contacto-1', flow_id: 'flujo-aprobado' })
  })

  it('reutiliza el token mientras no vence y lo renueva cuando vence', async () => {
    let ahora = 0
    const { fn, llamadas } = fetchFalso([TOKEN_OK(), respuesta(200, {}), respuesta(200, {}), TOKEN_OK(), respuesta(200, {})])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async () => {}, now: () => ahora })
    await sp.ejecutarFlujo('c', 'f')
    ahora = 10 * 60 * 1000
    await sp.ejecutarFlujo('c', 'f')
    ahora = 2 * 60 * 60 * 1000
    await sp.ejecutarFlujo('c', 'f')
    expect(llamadas.filter(l => l.url.endsWith('/oauth/access_token'))).toHaveLength(2)
  })

  it('reintenta con espera ante errores 5xx o de red, hasta 3 intentos', async () => {
    const esperas: number[] = []
    const { fn } = fetchFalso([TOKEN_OK(), respuesta(502, { message: 'Bad gateway' }), new TypeError('fetch failed'), respuesta(200, { success: true })])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async (ms) => { esperas.push(ms) } })
    expect(await sp.ejecutarFlujo('c', 'f')).toEqual({ ok: true, intentos: 3 })
    expect(esperas).toEqual([10, 20])
  })

  it('después de 3 fallos devuelve el último error', async () => {
    const { fn } = fetchFalso([TOKEN_OK(), respuesta(500), respuesta(503), respuesta(500, { message: 'caído' })])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async () => {} })
    expect(await sp.ejecutarFlujo('c', 'f')).toEqual({ ok: false, intentos: 3, error: 'SendPulse respondió HTTP 500: caído' })
  })

  it('no reintenta errores del pedido (4xx) ni respuestas con success: false', async () => {
    const a = fetchFalso([TOKEN_OK(), respuesta(400, { success: false, message: 'Flow not found' })])
    const spA = crearClienteSendPulse(CFG, { fetch: a.fn, sleep: async () => {} })
    expect(await spA.ejecutarFlujo('c', 'f')).toEqual({ ok: false, intentos: 1, error: 'SendPulse respondió HTTP 400: Flow not found' })

    const b = fetchFalso([TOKEN_OK(), respuesta(200, { success: false, message: 'Contact is not active' })])
    const spB = crearClienteSendPulse(CFG, { fetch: b.fn, sleep: async () => {} })
    expect(await spB.ejecutarFlujo('c', 'f')).toMatchObject({ ok: false, intentos: 1, error: expect.stringContaining('Contact is not active') })
  })

  it('si el token venció antes de tiempo (401), pide uno nuevo una vez', async () => {
    const { fn, llamadas } = fetchFalso([TOKEN_OK(), respuesta(401), TOKEN_OK(), respuesta(200, {})])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async () => {} })
    expect(await sp.ejecutarFlujo('c', 'f')).toEqual({ ok: true, intentos: 1 })
    expect(llamadas.filter(l => l.url.endsWith('/oauth/access_token'))).toHaveLength(2)
  })

  it('credenciales inválidas: no reintenta y lo explica', async () => {
    const { fn } = fetchFalso([respuesta(401, { error: 'invalid_client' })])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async () => {} })
    expect(await sp.ejecutarFlujo('c', 'f')).toEqual({ ok: false, intentos: 1, error: 'No se pudo obtener el token de SendPulse (HTTP 401)' })
  })

  it('los errores no guardan números largos', () => {
    expect(sanitizarError('contacto 5493511234567 dni 30111222\n falló')).toBe('contacto *** dni *** falló')
    expect(sanitizarError('x'.repeat(500))).toHaveLength(300)
  })
})

describe('cliente SendPulse: Instagram', () => {
  it('usa la ruta de Instagram cuando se pide ese canal', async () => {
    const { fn, llamadas } = fetchFalso([TOKEN_OK(), respuesta(200, { success: true })])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async () => {} })
    expect(await sp.ejecutarFlujo('c-ig', 'ig-aprobado', 'instagram')).toEqual({ ok: true, intentos: 1 })
    expect(llamadas[1].url).toBe('https://api.ejemplo.test/instagram/flows/run')
  })

describe('enviarTexto', () => {
  it('manda texto libre con el formato de cada canal', async () => {
    const { fn, llamadas } = fetchFalso([TOKEN_OK(), respuesta(200, { success: true }), respuesta(200, { success: true })])
    const sp = crearClienteSendPulse(CFG, { fetch: fn, sleep: async () => {} })
    expect(await sp.enviarTexto('c-wa', 'hola', 'whatsapp')).toEqual({ ok: true, intentos: 1 })
    expect(await sp.enviarTexto('c-ig', 'hola', 'instagram')).toEqual({ ok: true, intentos: 1 })
    expect(llamadas[1].url).toBe('https://api.ejemplo.test/whatsapp/contacts/send')
    expect(JSON.parse(String(llamadas[1].init.body))).toEqual({ contact_id: 'c-wa', message: { type: 'text', text: { body: 'hola' } } })
    expect(llamadas[2].url).toBe('https://api.ejemplo.test/instagram/contacts/send')
    expect(JSON.parse(String(llamadas[2].init.body))).toEqual({ contact_id: 'c-ig', messages: [{ type: 'text', message: { text: 'hola' } }] })
  })
})
})
