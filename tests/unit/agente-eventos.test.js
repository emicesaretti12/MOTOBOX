import { describe, it, expect } from 'vitest'
import { normalizar, eventosDelBody, textoDe } from '../../supabase/functions/sendpulse-eventos/eventos.ts'

describe('eventos del webhook de SendPulse', () => {
  it('mensaje entrante de WhatsApp', () => {
    const e = normalizar({
      service: 'whatsapp', title: 'incoming_message',
      contact: { id: 'c1', name: 'Diego', phone: '5493511234567' },
      info: { message: { channel_data: { message: { type: 'text', text: { body: 'Hola, precio de la Wave?' } } } } },
    })
    expect(e).toEqual({ canal: 'whatsapp', tipo: 'mensaje_entrante', autor: 'cliente', contact_id: 'c1', telefono: '5493511234567', nombre: 'Diego', texto: 'Hola, precio de la Wave?' })
  })

  it('mensaje saliente del bot en Instagram', () => {
    const e = normalizar({ service: 'instagram', title: 'outgoing_message', contact: { id: 'c2', username: 'juan_ok' }, info: { message: { text: '¡Hola! Soy Valen' } } })
    expect(e).toMatchObject({ canal: 'instagram', tipo: 'mensaje_saliente', autor: 'agente', nombre: 'juan_ok', texto: '¡Hola! Soy Valen' })
  })

  it('mensaje saliente escrito por una persona', () => {
    const e = normalizar({ service: 'whatsapp', title: 'outgoing_message', contact: { id: 'c3' }, info: { message: { text: 'te habla Mauricio' }, operator: 'u-123' } })
    expect(e.autor).toBe('humano')
  })

  it('audio sin texto', () => {
    const e = normalizar({ service: 'whatsapp', title: 'incoming_message', contact: { id: 'c4' }, info: { message: { channel_data: { message: { type: 'audio', audio: { id: 'x' } } } } } })
    expect(e.texto).toBe('[Audio]')
  })

  it('acepta un evento suelto o una lista', () => {
    expect(eventosDelBody([{ title: 'a' }, null, { title: 'b' }])).toHaveLength(2)
    expect(eventosDelBody({ title: 'a' })).toHaveLength(1)
    expect(eventosDelBody('x')).toHaveLength(0)
  })

  it('no toma el nombre del contacto como texto del mensaje', () => {
    expect(textoDe({ contact: { name: 'Ana' }, message: { text: 'Hola' } })).toBe('Hola')
  })
})
