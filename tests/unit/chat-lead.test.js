import { describe, it, expect } from 'vitest'
import { estadoVentana } from '../../src/lib/chatLead'

describe('ventana de 24 h', () => {
  const ahora = new Date('2026-11-17T15:00:00Z')
  it('abierta con lo que queda', () => {
    expect(estadoVentana([{ tipo: 'mensaje_entrante', created_at: '2026-11-17T13:00:00Z' }, { tipo: 'mensaje_saliente', created_at: '2026-11-17T14:00:00Z' }], ahora)).toEqual({ abierta: true, texto: 'Podés escribirle 22 h más' })
  })
  it('cerrada después de 24 h', () => {
    expect(estadoVentana([{ tipo: 'mensaje_entrante', created_at: '2026-11-16T14:00:00Z' }], ahora).abierta).toBe(false)
  })
  it('sin mensajes del cliente deja intentar', () => {
    expect(estadoVentana([], ahora).abierta).toBe(true)
  })
})
