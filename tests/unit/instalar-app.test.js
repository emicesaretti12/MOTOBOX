import { describe, it, expect } from 'vitest'
import { esIOS, estaInstalada } from '../../src/lib/instalarApp'

describe('instalar app', () => {
  it('detecta iPhone', () => {
    expect(esIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true)
    expect(esIOS('Mozilla/5.0 (Linux; Android 14)')).toBe(false)
  })
  it('sabe si ya está instalada', () => {
    expect(estaInstalada({ matchMedia: () => ({ matches: true }) })).toBe(true)
    expect(estaInstalada({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } })).toBe(true)
    expect(estaInstalada({ matchMedia: () => ({ matches: false }), navigator: {} })).toBe(false)
  })
})
