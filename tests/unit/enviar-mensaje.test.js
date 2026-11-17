import { describe, it, expect } from 'vitest'
import { ventanaAbierta, validarTexto, canalDelLead } from '../../supabase/functions/enviar-mensaje/logica.ts'

describe('enviar mensaje desde el CRM', () => {
  const ahora = new Date('2026-11-17T15:00:00Z')
  it('ventana de 24 h', () => {
    expect(ventanaAbierta({ created_at: '2026-11-17T01:00:00Z' }, ahora)).toBe(true)
    expect(ventanaAbierta({ created_at: '2026-11-16T14:00:00Z' }, ahora)).toBe(false)
    expect(ventanaAbierta(null, ahora)).toBe(false)
  })
  it('valida el texto', () => {
    expect(validarTexto('  hola ')).toBe('hola')
    expect(() => validarTexto('   ')).toThrow('Escribí')
    expect(() => validarTexto('x'.repeat(1001))).toThrow('largo')
  })
  it('usa el canal del último mensaje', () => {
    expect(canalDelLead('instagram', 'whatsapp')).toBe('whatsapp')
    expect(canalDelLead('instagram', null)).toBe('instagram')
    expect(canalDelLead('presencial', null)).toBe('whatsapp')
  })
})
