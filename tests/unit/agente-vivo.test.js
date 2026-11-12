import { describe, it, expect } from 'vitest'
import { agruparConversaciones, estadoConversacion, resumenDelDia, claveConversacion, vistaPrevia } from '../../src/lib/agenteVivo'

const ahora = new Date('2026-11-12T15:00:00Z')
const hace = (min) => new Date(ahora.getTime() - min * 60000).toISOString()
let id = 0
const ev = (x) => ({ id: ++id, canal: 'whatsapp', tipo: 'mensaje_entrante', autor: 'cliente', contact_id: 'c1', created_at: hace(1), texto: 'hola', ...x })

describe('agente en vivo', () => {
  it('agrupa por contacto y ordena por última actividad', () => {
    const lista = agruparConversaciones([
      ev({ contact_id: 'a', created_at: hace(30) }),
      ev({ contact_id: 'b', created_at: hace(10) }),
      ev({ contact_id: 'a', created_at: hace(2), tipo: 'mensaje_saliente', autor: 'agente' }),
    ], ahora)
    expect(lista.map((c) => c.clave)).toEqual(['c:a', 'c:b'])
    expect(lista[0].eventos).toHaveLength(2)
  })

  it('une por teléfono cuando no hay contact_id', () => {
    expect(claveConversacion({ telefono: '+54 9 351 123-4567' })).toBe(claveConversacion({ telefono: '3511234567' }))
  })

  it('marca esperando si el cliente escribió y nadie respondió', () => {
    const [c] = agruparConversaciones([ev({ created_at: hace(20) }), ev({ created_at: hace(8) })], ahora)
    expect(c.estado).toBe('esperando')
  })

  it('no marca esperando si ya respondió una persona', () => {
    const [c] = agruparConversaciones([ev({ created_at: hace(20) }), ev({ created_at: hace(19), tipo: 'mensaje_saliente', autor: 'humano' })], ahora)
    expect(c.estado).toBe('humano')
  })

  it('un dato no cuenta como respuesta', () => {
    const c = { ultimoMensaje: ev({ created_at: hace(9) }), ultimo: ev({ tipo: 'dato', autor: 'agente', created_at: hace(1) }), eventos: [] }
    expect(estadoConversacion(c, ahora)).toBe('esperando')
  })

  it('resume el día', () => {
    const desde = new Date(hace(60))
    const r = resumenDelDia([
      ev({ contact_id: 'a' }),
      ev({ contact_id: 'a', tipo: 'mensaje_saliente', autor: 'agente' }),
      ev({ contact_id: 'b', created_at: hace(200) }),
      ev({ tipo: 'dato', autor: 'agente', texto: 'Nuevo lead · Forma de pago: cuotas' }),
      ev({ tipo: 'dato', autor: 'agente', texto: 'Mandó DNI · Precalificación: apto' }),
      ev({ tipo: 'dato', autor: 'agente', texto: 'Listo para comprar' }),
    ], desde)
    expect(r).toEqual({ conversaciones: 1, respuestasAgente: 1, nuevos: 1, dnis: 1, listos: 1 })
  })

  it('vista previa con autor', () => {
    expect(vistaPrevia({ autor: 'agente', texto: 'Hola!' })).toBe('Valen: Hola!')
    expect(vistaPrevia({ autor: 'cliente', texto: 'precio?' })).toBe('precio?')
  })
})
