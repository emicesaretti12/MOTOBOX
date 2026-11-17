import { describe, it, expect } from 'vitest'
import { leerPrecio, precioSugerido, modeloSugerido, metodoDesdeFormaPago } from '../../src/lib/venta'

describe('registrar venta', () => {
  it('lee el precio como lo escribe un vendedor', () => {
    expect(leerPrecio('1.600.000')).toBe(1600000)
    expect(leerPrecio('$ 1600000')).toBe(1600000)
    expect(leerPrecio('1,6 millones')).toBe(1600000)
    expect(leerPrecio('3.4M')).toBe(3400000)
    expect(leerPrecio('2.180.000,50')).toBe(2180000)
    expect(leerPrecio('abc')).toBe(null)
    expect(leerPrecio('')).toBe(null)
  })
  it('sugiere modelo y precio de contado', () => {
    expect(modeloSugerido('keller full')).toBe('Keller Crono Full')
    expect(precioSugerido('Keller Crono Full', 'contado')).toBe(1600000)
    expect(precioSugerido('Honda Wave S 110', 'tarjeta')).toBe(null)
    expect(precioSugerido('Gilera Smash', 'contado')).toBe(null)
  })
  it('forma de pago del lead a la de la venta', () => {
    expect(metodoDesdeFormaPago('anticipo_cuotas')).toBe('anticipo_tarjeta')
    expect(metodoDesdeFormaPago(null)).toBe('contado')
  })
})
