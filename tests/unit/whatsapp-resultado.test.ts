import { describe, it, expect, vi } from 'vitest'
import { registrarResultado } from '../../supabase/functions/sendpulse-whatsapp-webhook/resultado.ts'

function deps(data: unknown, error: unknown = null) {
  const log = { error: vi.fn() }
  return {
    log,
    d: {
      rpc: vi.fn(async () => ({ data, error: error as never })),
      marcarPrioridadAlta: vi.fn(async () => ({ error: null })),
      log,
    },
  }
}

describe('webhook WhatsApp v5: resultado', () => {
  it('llama a la función atómica con los datos del payload', async () => {
    const { d } = deps({ lead_id: 'L1', estado: 'registrado', estado_dni: 'aprobado' })
    const r = await registrarResultado(d, { contactId: 'sp-1', telefono: undefined, resultado: 'aprobado', monto: 1500000 })
    expect(d.rpc).toHaveBeenCalledWith('dni_webhook_resultado', { p_contact_id: 'sp-1', p_telefono: null, p_resultado: 'aprobado', p_monto: 1500000 })
    expect(r).toEqual({ status: 200, body: { message: 'Resultado guardado', lead_id: 'L1', estado_dni: 'aprobado', estado: 'registrado' } })
    expect(d.marcarPrioridadAlta).toHaveBeenCalledWith('L1')
  })

  it('si el CRM ya lo registró responde 200 sin duplicar, y deja la prioridad alta como v4', async () => {
    const { d } = deps({ lead_id: 'L1', estado: 'ya_registrado', estado_dni: 'aprobado' })
    const r = await registrarResultado(d, { contactId: 'sp-1', resultado: 'aprobado', monto: null })
    expect(r.body).toMatchObject({ message: 'Resultado ya registrado', estado: 'ya_registrado' })
    expect(d.marcarPrioridadAlta).toHaveBeenCalledWith('L1')
  })

  it('rechazado no toca la prioridad; un conflicto tampoco', async () => {
    const a = deps({ lead_id: 'L1', estado: 'registrado', estado_dni: 'rechazado' })
    await registrarResultado(a.d, { contactId: 'sp-1', resultado: 'rechazado', monto: null })
    expect(a.d.marcarPrioridadAlta).not.toHaveBeenCalled()
    const b = deps({ lead_id: 'L1', estado: 'conflicto', estado_dni: 'aprobado' })
    const r = await registrarResultado(b.d, { contactId: 'sp-1', resultado: 'aprobado', monto: null })
    expect(r.body.message).toBe('El CRM tiene otro resultado: no se cambió nada')
    expect(b.d.marcarPrioridadAlta).not.toHaveBeenCalled()
  })

  it('lead inexistente: 404 como v4; error de base: 400 sin datos en el log', async () => {
    expect((await registrarResultado(deps({ estado: 'no_encontrado' }).d, { contactId: 'x', resultado: 'aprobado', monto: null })).status).toBe(404)
    const { d, log } = deps(null, { message: 'Failing row contains (30111222)', code: '23514' })
    const r = await registrarResultado(d, { contactId: 'x', resultado: 'aprobado', monto: null })
    expect(r).toEqual({ status: 400, body: { error: 'No se pudo guardar el resultado' } })
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('30111222')
  })
})
