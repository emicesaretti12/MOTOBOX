import { describe, it, expect } from 'vitest'
import { normalizarConfig, cotizar, textoPresupuesto, planesCargados, motoParaLead, redondear } from '../../src/lib/calculadora'

const conf = normalizarConfig({
  motos: [{ modelo: 'Keller Crono 110 Full', precio: 1650000 }, { modelo: 'Honda Wave S 110', precio: '3.400.000' }],
  contado: { descuento_pct: 0 },
  tarjetas: [{ id: 'naranja', nombre: 'Naranja', opciones: [{ cuotas: 6, recargo_pct: 20 }, { cuotas: 3, recargo_pct: 10 }, { cuotas: 12, recargo_pct: null }] }],
  credito: { nombre: 'Crédito con DNI', anticipo_min_pct: 20, gastos_pct: 5, opciones: [{ cuotas: 12, recargo_pct: 60 }] },
  extras: { patentamiento: 100000, formulario: 0, flete: 0 },
})

describe('calculadora de precios', () => {
  it('normaliza la configuración y ordena las cuotas', () => {
    expect(conf.motos[1].precio).toBe(3400000)
    expect(conf.tarjetas[0].opciones.map((o) => o.cuotas)).toEqual([3, 6, 12])
    expect(planesCargados(conf)).toBe(true)
    expect(planesCargados(normalizarConfig(null))).toBe(false)
  })

  it('cotiza tarjeta sin anticipo y oculta los planes sin recargo', () => {
    const c = cotizar(conf, { precio: 1650000 })
    expect(c.contado.precio).toBe(1650000)
    const n = c.tarjetas[0].opciones
    expect(n.map((o) => o.cuotas)).toEqual([3, 6])
    expect(n[0].cuota).toBe(redondear((1650000 * 1.1) / 3))
    expect(n[1].cuota).toBe(330000)
  })

  it('el crédito pide anticipo mínimo y suma gastos', () => {
    const sin = cotizar(conf, { precio: 1000000 })
    expect(sin.credito.opciones).toEqual([])
    expect(sin.credito.falta_anticipo).toBe(200000)
    const con = cotizar(conf, { precio: 1000000, anticipo: 200000 })
    // (1.000.000 - 200.000) * 1,05 * 1,60 / 12 = 112.000
    expect(con.credito.opciones[0].cuota).toBe(112000)
  })

  it('suma extras cuando se piden', () => {
    const c = cotizar(conf, { precio: 1650000, conExtras: true })
    expect(c.contado.precio).toBe(1750000)
    expect(c.base).toBe(1750000)
  })

  it('arma el presupuesto solo con lo elegido', () => {
    const c = cotizar(conf, { precio: 1650000 })
    const t = textoPresupuesto({ cot: c, modelo: 'Keller Crono 110 Full', cliente: 'marcelo perez', vendedor: 'Mauricio Barbosa', elegidas: new Set(['naranja-6']), hoy: new Date(2026, 10, 27) })
    expect(t).toContain('¡Hola Marcelo!')
    expect(t).toContain('6 cuotas de $330.000')
    expect(t).not.toContain('Contado')
    expect(t).not.toContain('3 cuotas')
    expect(t).toContain('27/11')
  })

  it('encuentra la moto del lead', () => {
    expect(motoParaLead(conf, 'keller full')?.modelo).toBe('Keller Crono 110 Full')
    expect(motoParaLead(conf, 'wave')?.modelo).toBe('Honda Wave S 110')
    expect(motoParaLead(conf, '')).toBe(null)
  })

  it('no cotiza sin precio', () => {
    expect(cotizar(conf, { precio: '' })).toBe(null)
  })
})
