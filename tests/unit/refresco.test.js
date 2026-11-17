import { describe, it, expect } from 'vitest'
import { debeRefrescar } from '../../src/lib/refresco'

describe('refresco automático', () => {
  it('no recarga en segundo plano', () => expect(debeRefrescar({ visible: false, ahora: 100000, ultimo: 0 })).toBe(false))
  it('no recarga dos veces seguidas', () => expect(debeRefrescar({ visible: true, ahora: 3000, ultimo: 0, forzar: true })).toBe(false))
  it('recarga al volver a la app', () => expect(debeRefrescar({ visible: true, ahora: 60000, ultimo: 0, forzar: true })).toBe(true))
})

import { puedeRecargarAhora } from '../../src/lib/refresco'
describe('actualización de la app', () => {
  it('espera si estás escribiendo', () => expect(puedeRecargarAhora({ visible: true, ocupada: true })).toBe(false))
  it('se aplica si no hay nada abierto', () => expect(puedeRecargarAhora({ visible: true, ocupada: false })).toBe(true))
  it('se aplica en segundo plano', () => expect(puedeRecargarAhora({ visible: false, ocupada: true })).toBe(true))
})
