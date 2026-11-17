import { describe, it, expect } from 'vitest'
import { iniciales, colorDe, cuandoCorto, grupoFecha, agruparPorFecha, telefonoWa, buscar } from '../../src/movil/formato'

describe('app móvil: formatos', () => {
  const ahora = new Date(2026, 10, 17, 13, 0)
  it('iniciales', () => {
    expect(iniciales('Germán López')).toBe('GL')
    expect(iniciales('mayra')).toBe('M')
    expect(iniciales('Sin nombre (whatsapp)')).toBe('?')
  })
  it('color estable', () => expect(colorDe('Ana')).toBe(colorDe('Ana')))
  it('cuándo', () => {
    expect(cuandoCorto(new Date(2026, 10, 17, 9, 5), ahora)).toBe('09:05')
    expect(cuandoCorto(new Date(2026, 10, 16, 9, 5), ahora)).toBe('Ayer')
    expect(cuandoCorto(new Date(2026, 9, 1), ahora)).toBe('01/10')
  })
  it('grupos por fecha', () => {
    expect(grupoFecha(new Date(2026, 10, 14), ahora)).toBe('Esta semana')
    const g = agruparPorFecha([{ f: new Date(2026, 10, 17) }, { f: new Date(2026, 5, 1) }], 'f', ahora)
    expect(g.map((x) => x.titulo)).toEqual(['Hoy', 'Antes'])
  })
  it('teléfono y búsqueda', () => {
    expect(telefonoWa('351 123-4567')).toBe('543511234567')
    expect(telefonoWa('12')).toBe(null)
    expect(buscar({ nombre: 'Mayra', telefono: '3511234567' }, '1234')).toBe(true)
    expect(buscar({ nombre: 'Mayra', modelo_interes: 'Wave' }, 'wave')).toBe(true)
    expect(buscar({ nombre: 'Mayra' }, 'pedro')).toBe(false)
  })
})
