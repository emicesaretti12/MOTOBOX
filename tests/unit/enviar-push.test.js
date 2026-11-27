import { describe, it, expect } from 'vitest'
import { textoAviso, destinatarios } from '../../supabase/functions/enviar-push/logica.ts'

describe('avisos push', () => {
  it('arma el aviso según el motivo', () => {
    expect(textoAviso({ id: 'a', nombre: 'Marcelo Pérez', forma_pago: 'contado', modelo_interes: 'Keller Crono Full' }).body)
      .toBe('Marcelo quiere comprar de contado · Keller Crono Full. Escribile ahora.')
    expect(textoAviso({ id: 'b', nombre: 'Sin nombre (whatsapp)', caliente_motivo: 'asesor' }).body).toBe('Un cliente pidió hablar con un asesor. Escribile ahora.')
    expect(textoAviso({ id: 'c', nombre: 'Ana', bcra_resultado: 'apto' }).url).toBe('/leads/c')
  })
  it('avisa al vendedor o, si no hay, a los admins', () => {
    expect(destinatarios('v1', ['a1'])).toEqual(['v1'])
    expect(destinatarios(null, ['a1', 'a1', 'a2'])).toEqual(['a1', 'a2'])
  })
})
