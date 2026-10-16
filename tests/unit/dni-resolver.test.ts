import { describe, it, expect, vi } from 'vitest'
import { handleRequest, type Dependencias } from '../../supabase/functions/dni-resolver/handler.ts'

const LEAD = '11111111-2222-3333-4444-555555555555'
const RESOLUCION = '99999999-8888-7777-6666-555555555555'

function pedido(body: unknown, { auth = 'Bearer jwt-operador', origin = 'https://crm.motobox.test', method = 'POST' } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', origin }
  if (auth) headers.authorization = auth
  return new Request('https://x.supabase.co/functions/v1/dni-resolver', {
    method,
    headers,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
}

function deps(over: Partial<Dependencias> = {}) {
  const log = { error: vi.fn(), warn: vi.fn() }
  const d: Dependencias = {
    origenesPermitidos: [],
    rpcComoUsuario: vi.fn(async () => ({
      data: { ok: true, resolucion_id: RESOLUCION, resultado: 'aprobado', monto_aprobado: 1500000, aviso_estado: 'pendiente', sendpulse_contact_id: 'sp-1' },
      error: null,
    })),
    rpcServicio: vi.fn(async () => ({ data: true, error: null })),
    sendpulse: { ejecutarFlujo: vi.fn(async () => ({ ok: true as const, intentos: 1 })) },
    flujos: { aprobado: 'flujo-aprobado', rechazado: 'flujo-rechazado' },
    log,
    ...over,
  }
  return { d, log }
}

const RESOLVER = { accion: 'resolver', lead_id: LEAD, intento: 2, resultado: 'aprobado', monto: 1500000 }

describe('dni-resolver', () => {
  it('resuelve con el token del operador y avisa al cliente con el flujo correcto', async () => {
    const { d } = deps()
    const res = await handleRequest(pedido(RESOLVER), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, resolucion_id: RESOLUCION, resultado: 'aprobado', monto_aprobado: 1500000, aviso: { estado: 'enviado' } })

    expect(d.rpcComoUsuario).toHaveBeenCalledWith('Bearer jwt-operador', 'dni_resolver', { p_lead_id: LEAD, p_intento: 2, p_resultado: 'aprobado', p_monto: 1500000 })
    expect(d.sendpulse!.ejecutarFlujo).toHaveBeenCalledWith('sp-1', 'flujo-aprobado')
    expect(d.rpcServicio).toHaveBeenCalledWith('dni_registrar_aviso', { p_resolucion_id: RESOLUCION, p_enviado: true, p_intentos: 1, p_error: null })
  })

  it('al rechazar usa el flujo de rechazo y no manda monto', async () => {
    const { d } = deps({
      rpcComoUsuario: vi.fn(async () => ({ data: { ok: true, resolucion_id: RESOLUCION, resultado: 'rechazado', monto_aprobado: null, aviso_estado: 'pendiente', sendpulse_contact_id: 'sp-1' }, error: null })),
    })
    await handleRequest(pedido({ ...RESOLVER, resultado: 'rechazado', monto: 999 }), d)
    expect(d.rpcComoUsuario).toHaveBeenCalledWith(expect.any(String), 'dni_resolver', expect.objectContaining({ p_resultado: 'rechazado', p_monto: null }))
    expect(d.sendpulse!.ejecutarFlujo).toHaveBeenCalledWith('sp-1', 'flujo-rechazado')
  })

  it('si SendPulse falla, el resultado queda guardado y se informa que el cliente no fue avisado', async () => {
    const { d } = deps({ sendpulse: { ejecutarFlujo: vi.fn(async () => ({ ok: false as const, intentos: 3, error: 'SendPulse respondió HTTP 500' })) } })
    const res = await handleRequest(pedido(RESOLVER), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, aviso: { estado: 'fallido', error: 'SendPulse respondió HTTP 500' } })
    expect(d.rpcServicio).toHaveBeenCalledWith('dni_registrar_aviso', { p_resolucion_id: RESOLUCION, p_enviado: false, p_intentos: 3, p_error: 'SendPulse respondió HTTP 500' })
  })

  it('sin configuración de SendPulse no rompe: queda como no avisado', async () => {
    const { d } = deps({ sendpulse: null })
    const body = await (await handleRequest(pedido(RESOLVER), d)).json()
    expect(body.aviso).toEqual({ estado: 'fallido', error: 'Falta configurar SendPulse (credenciales, URL o ID del flujo)' })
  })

  it('si el lead no tiene contacto o el aviso está apagado, no llama a SendPulse', async () => {
    for (const aviso_estado of ['sin_contacto', 'desactivado']) {
      const { d } = deps({
        rpcComoUsuario: vi.fn(async () => ({ data: { ok: true, resolucion_id: RESOLUCION, resultado: 'aprobado', monto_aprobado: null, aviso_estado, sendpulse_contact_id: null }, error: null })),
      })
      const body = await (await handleRequest(pedido(RESOLVER), d)).json()
      expect(body.aviso).toEqual({ estado: aviso_estado })
      expect(d.sendpulse!.ejecutarFlujo).not.toHaveBeenCalled()
    }
  })

  it('si otro ya lo resolvió devuelve 409 con el detalle y no avisa', async () => {
    const { d } = deps({ rpcComoUsuario: vi.fn(async () => ({ data: { ok: false, motivo: 'YA_RESUELTO', resultado: 'aprobado', por: 'Vendedor 2' }, error: null })) })
    const res = await handleRequest(pedido(RESOLVER), d)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ ok: false, motivo: 'YA_RESUELTO', resultado: 'aprobado', por: 'Vendedor 2' })
    expect(d.sendpulse!.ejecutarFlujo).not.toHaveBeenCalled()
  })

  it('traduce los errores de la base sin exponer el mensaje original', async () => {
    const casos: Array<[string, number, string]> = [
      ['SIN_PERMISO', 403, 'SIN_PERMISO'],
      ['COLA_DESACTIVADA', 409, 'COLA_DESACTIVADA'],
      ['JWT expired', 401, 'NO_AUTORIZADO'],
      ['duplicate key value violates unique constraint ... (30111222)', 500, 'ERROR_INTERNO'],
    ]
    for (const [message, status, motivo] of casos) {
      const { d, log } = deps({ rpcComoUsuario: vi.fn(async () => ({ data: null, error: { message, code: 'XX' } })) })
      const res = await handleRequest(pedido(RESOLVER), d)
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ ok: false, motivo })
      for (const llamada of log.error.mock.calls) expect(JSON.stringify(llamada)).not.toContain('30111222')
    }
  })

  it('valida el pedido', async () => {
    const { d } = deps()
    const casos: Array<[unknown, string]> = [
      [{ ...RESOLVER, lead_id: 'x' }, 'LEAD_INVALIDO'],
      [{ ...RESOLVER, intento: '2' }, 'INTENTO_INVALIDO'],
      [{ ...RESOLVER, resultado: 'quizas' }, 'RESULTADO_INVALIDO'],
      [{ ...RESOLVER, monto: -1 }, 'MONTO_INVALIDO'],
      [{ ...RESOLVER, monto: '1000' }, 'MONTO_INVALIDO'],
      [{ accion: 'otra' }, 'ACCION_INVALIDA'],
      ['no es json', 'JSON_INVALIDO'],
    ]
    for (const [body, motivo] of casos) {
      const res = await handleRequest(pedido(body), d)
      expect(res.status).toBe(400)
      expect((await res.json()).motivo).toBe(motivo)
    }
    expect(d.rpcComoUsuario).not.toHaveBeenCalled()
  })

  it('exige sesión y solo acepta POST', async () => {
    const { d } = deps()
    expect((await handleRequest(pedido(RESOLVER, { auth: '' }), d)).status).toBe(401)
    expect((await handleRequest(pedido(null, { method: 'GET' }), d)).status).toBe(405)
    const pre = await handleRequest(pedido(null, { method: 'OPTIONS' }), d)
    expect(pre.status).toBe(200)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('con orígenes configurados, solo responde CORS al CRM', async () => {
    const { d } = deps({ origenesPermitidos: ['https://crm.motobox.test'] })
    const ok = await handleRequest(pedido(null, { method: 'OPTIONS' }), d)
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://crm.motobox.test')
    const otro = await handleRequest(pedido(null, { method: 'OPTIONS', origin: 'https://otro.test' }), d)
    expect(otro.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('reintentar aviso: verifica que siga vigente y vuelve a llamar a SendPulse', async () => {
    const { d } = deps({
      rpcComoUsuario: vi.fn(async () => ({ data: { ok: true, resolucion_id: RESOLUCION, resultado: 'rechazado', sendpulse_contact_id: 'sp-9' }, error: null })),
    })
    const res = await handleRequest(pedido({ accion: 'reintentar_aviso', resolucion_id: RESOLUCION }), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, resolucion_id: RESOLUCION, resultado: 'rechazado', aviso: { estado: 'enviado' } })
    expect(d.rpcComoUsuario).toHaveBeenCalledWith('Bearer jwt-operador', 'dni_preparar_reintento', { p_resolucion_id: RESOLUCION })
    expect(d.sendpulse!.ejecutarFlujo).toHaveBeenCalledWith('sp-9', 'flujo-rechazado')
  })

  it('reintentar aviso desactualizado: 409 sin llamar a SendPulse', async () => {
    const { d } = deps({ rpcComoUsuario: vi.fn(async () => ({ data: { ok: false, motivo: 'DESACTUALIZADO' }, error: null })) })
    const res = await handleRequest(pedido({ accion: 'reintentar_aviso', resolucion_id: RESOLUCION }), d)
    expect(res.status).toBe(409)
    expect(d.sendpulse!.ejecutarFlujo).not.toHaveBeenCalled()
  })
})

describe('dni-resolver: canal Instagram', () => {
  it('si el lead vino de Instagram, ejecuta el flujo del bot de Instagram', async () => {
    const { d } = deps({
      flujos: { aprobado: 'flujo-aprobado', rechazado: 'flujo-rechazado', instagram: { aprobado: 'ig-aprobado', rechazado: 'ig-rechazado' } },
      canalDeResolucion: vi.fn(async () => 'instagram' as const),
    })
    const res = await handleRequest(pedido(RESOLVER), d)
    expect(res.status).toBe(200)
    expect(d.sendpulse!.ejecutarFlujo).toHaveBeenCalledWith('sp-1', 'ig-aprobado', 'instagram')
  })

  it('si no se puede saber el canal, usa WhatsApp', async () => {
    const { d } = deps({ canalDeResolucion: vi.fn(async () => { throw new Error('db') }) })
    const res = await handleRequest(pedido(RESOLVER), d)
    expect(res.status).toBe(200)
    expect(d.sendpulse!.ejecutarFlujo).toHaveBeenCalledWith('sp-1', 'flujo-aprobado')
  })
})

describe('dni-resolver: contacto de otro canal', () => {
  it('si falla por el canal del origen, prueba por el otro bot', async () => {
    const ejecutarFlujo = vi.fn()
      .mockResolvedValueOnce({ ok: false, intentos: 1, error: 'SendPulse respondió HTTP 422' })
      .mockResolvedValueOnce({ ok: true, intentos: 1 })
    const { d } = deps({
      sendpulse: { ejecutarFlujo },
      flujos: { aprobado: 'flujo-aprobado', rechazado: 'flujo-rechazado', instagram: { aprobado: 'ig-aprobado', rechazado: 'ig-rechazado' } },
      canalDeResolucion: vi.fn(async () => 'instagram' as const),
    })
    const body = await (await handleRequest(pedido(RESOLVER), d)).json()
    expect(ejecutarFlujo).toHaveBeenNthCalledWith(1, 'sp-1', 'ig-aprobado', 'instagram')
    expect(ejecutarFlujo).toHaveBeenNthCalledWith(2, 'sp-1', 'flujo-aprobado')
    expect(body.aviso).toEqual({ estado: 'enviado' })
  })
})
