import { describe, it, expect } from 'vitest'
import { leadsParaRecuperar, mensajeRecupero, linkRecupero } from '../../src/lib/recupero'

const ahora = new Date()
const hace = (d) => new Date(ahora.getTime() - d * 864e5).toISOString()
const l = (p = {}) => ({ id: Math.random().toString(), nombre: 'JUAN perez', telefono: '3512033710', estado: 'contactado', puntaje_compra: 60, created_at: hace(10), notas: '', modelo_interes: 'Honda Wave', origen: 'presencial', ...p })

describe('Para recuperar', () => {
  it('ordena por probabilidad, saca duplicados de teléfono y los ya recuperados', () => {
    const lista = leadsParaRecuperar([
      l({ id: 'a', puntaje_compra: 50 }),
      l({ id: 'b', puntaje_compra: 80, telefono: '3511111111' }),
      l({ id: 'c', puntaje_compra: 40, estado: 'perdido', telefono: '3512222222' }),
      l({ id: 'd', telefono: '3513333333', notas: '[x] Recuperación manual: se le escribió por WhatsApp' }),
      l({ id: 'e', telefono: '3514444444', created_at: hace(1) }),
      l({ id: 'f', puntaje_compra: 45 }), // mismo teléfono que a
    ])
    expect(lista.map(x => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('arma el mensaje y el link de WhatsApp', () => {
    expect(mensajeRecupero(l())).toMatch(/^¡Hola Juan! Te escribo de MotoBox Córdoba .* consultaste por la Honda Wave\./)
    expect(mensajeRecupero(l({ nombre: 'Sin nombre (instagram)', modelo_interes: 'a consultar' }))).toMatch(/^¡Hola! .*por una moto 0km\./)
    expect(linkRecupero(l())).toMatch(/^https:\/\/wa\.me\/5493512033710\?text=/)
  })
})
