import { describe, it, expect } from 'vitest'
import { ordenarCalientes, mensajeCaliente, linkCaliente } from '../../src/lib/calientes'

const L = (o) => ({ nombre: 'diego', telefono: '3511234567', caliente_at: '2026-11-08T12:00:00Z', ...o })

describe('alerta de leads calientes', () => {
  it('ordena contado, tarjeta, anticipo, apto y al final el resto; lo más nuevo primero', () => {
    const r = ordenarCalientes([
      L({ id: 'asesor', forma_pago: 'cuotas', caliente_motivo: 'asesor' }),
      L({ id: 'tarjeta', forma_pago: 'tarjeta' }),
      L({ id: 'contado-viejo', forma_pago: 'contado', caliente_at: '2026-11-05T12:00:00Z' }),
      L({ id: 'apto', forma_pago: 'cuotas', bcra_resultado: 'apto' }),
      L({ id: 'contado-nuevo', forma_pago: 'contado' }),
      L({ id: 'anticipo', forma_pago: 'anticipo_cuotas' }),
    ]).map((l) => l.id)
    expect(r).toEqual(['contado-nuevo', 'contado-viejo', 'tarjeta', 'anticipo', 'apto', 'asesor'])
  })

  it('arma el primer mensaje con nombre y vendedor', () => {
    const m = mensajeCaliente(L({ forma_pago: 'contado', modelo_interes: 'Honda Wave S' }), 'Mauricio Barbosa')
    expect(m).toBe('¡Hola Diego! Soy Mauricio del equipo de MotoBox Córdoba 🏍️ Con nosotros te podés llevar tu próxima moto financiada solo con tu DNI.')
  })

  it('no inventa nombre cuando falta', () => {
    const m = mensajeCaliente(L({ nombre: 'Sin nombre (whatsapp)' }), '')
    expect(m).toBe('¡Hola! Te escribo del equipo de MotoBox Córdoba 🏍️ Con nosotros te podés llevar tu próxima moto financiada solo con tu DNI.')
  })

  it('el link lleva el mensaje; sin teléfono no hay link', () => {
    expect(linkCaliente(L({ forma_pago: 'contado' }), 'Mauricio')).toMatch(/^https:\/\/wa\.me\/549351\d+\?text=/)
    expect(linkCaliente(L({ telefono: '' }), 'Mauricio')).toBeNull()
  })
})
