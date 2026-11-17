import { describe, it, expect } from 'vitest'
import { ordenarPorCalidad, porcentaje } from '../../src/lib/calidadAnuncios'

describe('calidad por anuncio', () => {
  it('ordena por ventas y después por proporción de listos', () => {
    const f = (id, conversaciones, listos, ventas = 0) => ({ anuncio_id: id, conversaciones, listos_para_comprar: listos, ventas })
    const orden = ordenarPorCalidad([f('a', 40, 10), f('b', 20, 10), f('c', 1, 1), f('d', 10, 0, 1)]).map((x) => x.anuncio_id)
    expect(orden).toEqual(['d', 'b', 'a', 'c'])
  })
  it('porcentaje sin dividir por cero', () => {
    expect(porcentaje(3, 12)).toBe('25%')
    expect(porcentaje(0, 0)).toBe('')
  })
})
