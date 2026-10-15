import { describe, it, expect, vi } from 'vitest'
import { handleRequest, secretoValido, type Dependencias } from '../../supabase/functions/sendpulse-whatsapp-webhook/handler.v3.ts'

function pedido(body: unknown, { secreto = 'secreto-ok', method = 'POST' } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secreto) headers['x-webhook-secret'] = secreto
  return new Request('https://x.supabase.co/functions/v1/sendpulse-whatsapp-webhook', {
    method,
    headers,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
}

function deps(respuesta: unknown = { lead_id: 'L1', is_new: true, estado: 'creado' }, error: unknown = null) {
  const log = { error: vi.fn(), warn: vi.fn() }
  const d: Dependencias = { secreto: 'secreto-ok', rpc: vi.fn(async () => ({ data: respuesta, error: error as never })), log }
  return { d, log }
}

describe('webhook WhatsApp v3', () => {
  it('rechaza sin el secreto correcto', async () => {
    const { d } = deps()
    expect((await handleRequest(pedido({}, { secreto: 'otro' }), d)).status).toBe(401)
    expect((await handleRequest(pedido({}, { secreto: '' }), d)).status).toBe(401)
    expect(d.rpc).not.toHaveBeenCalled()
    expect(secretoValido('abc', '')).toBe(false)
    expect(secretoValido('abc', 'abc')).toBe(true)
    expect(secretoValido('abcd', 'abc')).toBe(false)
  })

  it('mantiene las respuestas de v2 para pedidos inválidos', async () => {
    const { d } = deps()
    expect((await handleRequest(pedido(null, { method: 'GET' }), d)).status).toBe(405)
    const noJson = await handleRequest(pedido('no es json'), d)
    expect([noJson.status, await noJson.json()]).toEqual([400, { error: 'Body inválido: no es JSON válido' }])
    const dni = await handleRequest(pedido({ contact_id: 'c', dni: '123' }), d)
    expect([dni.status, await dni.json()]).toEqual([400, { error: 'DNI inválido' }])
    const sinContacto = await handleRequest(pedido({ dni: '30111222' }), d)
    expect([sinContacto.status, await sinContacto.json()]).toEqual([400, { error: 'Se requiere teléfono o contact_id' }])
    const res = await handleRequest(pedido({ accion: 'resultado', resultado: 'quizas', contact_id: 'c' }), d)
    expect([res.status, await res.json()]).toEqual([400, { error: 'resultado debe ser aprobado o rechazado' }])
    expect(d.rpc).not.toHaveBeenCalled()
  })

  it('dni_recibido: normaliza el DNI e ignora variables vacías de SendPulse', async () => {
    const { d } = deps()
    const res = await handleRequest(pedido({ contact_id: 'sp-1', telefono: '{{phone}}', nombre: '  Juan  ', dni: '30.111.222', relacion: '-' }), d)
    expect(await res.json()).toEqual({ message: 'Lead creado', lead_id: 'L1', is_new: true })
    expect(d.rpc).toHaveBeenCalledWith('dni_webhook_recibido', { p_contact_id: 'sp-1', p_telefono: null, p_nombre: 'Juan', p_dni: '30111222', p_relacion: 'titular' })
  })

  it('dni_recibido sobre un lead existente informa qué pasó', async () => {
    const { d } = deps({ lead_id: 'L1', is_new: false, estado: 'ya_pendiente' })
    const res = await handleRequest(pedido({ accion: 'dni_recibido', phone: '3515551234', dni: 30111222 }), d)
    expect(await res.json()).toEqual({ message: 'Lead existente actualizado', lead_id: 'L1', is_new: false, estado: 'ya_pendiente' })
  })

  it('resultado: parsea el monto como v2 y responde según lo que hizo la base', async () => {
    const casos: Array<[string, number, string]> = [
      ['registrado', 200, 'Resultado guardado'],
      ['ya_registrado', 200, 'Resultado ya registrado'],
      ['conflicto', 200, 'El CRM tiene otro resultado: no se cambió nada'],
    ]
    for (const [estado, status, message] of casos) {
      const { d } = deps({ lead_id: 'L1', estado, estado_dni: 'aprobado' })
      const res = await handleRequest(pedido({ accion: 'resultado', contact_id: 'sp-1', resultado: 'APROBADO', monto: '$1.500.000' }), d)
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ message, lead_id: 'L1', estado_dni: 'aprobado', estado })
      expect(d.rpc).toHaveBeenCalledWith('dni_webhook_resultado', { p_contact_id: 'sp-1', p_telefono: null, p_resultado: 'aprobado', p_monto: 1500000 })
    }
    const { d } = deps({ estado: 'no_encontrado' })
    const res = await handleRequest(pedido({ action: 'resultado', contact_id: 'x', estado_dni: 'rechazado' }), d)
    expect([res.status, await res.json()]).toEqual([404, { error: 'Lead no encontrado' }])
  })

  it('si la base falla responde 500 y no escribe datos personales en el log', async () => {
    const { d, log } = deps(null, { message: 'new row violates check constraint, Failing row contains (..., 30111222, ...)', code: '23514' })
    const res = await handleRequest(pedido({ contact_id: 'sp-1', dni: '30111222' }), d)
    expect([res.status, await res.json()]).toEqual([500, { error: 'Error interno del servidor' }])
    expect(log.error).toHaveBeenCalledWith('Error guardando DNI recibido', '23514')
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('30111222')
  })
})
