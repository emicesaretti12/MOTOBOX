import { describe, it, expect } from 'vitest'
import {
  etiquetaRelacion, segundosDesde, formatEspera, parseMonto, formatMonto, leerConfig, puedeVerificar,
  mensajeMotivo, motivoDeErrorRpc, datosDeErrorFuncion, mensajeResultado, leadsParaContactar, enmascararDni,
} from '../../src/lib/verificacion.js'

describe('helpers de la cola de verificación', () => {
  it('tiempo de espera legible', () => {
    expect(formatEspera(45)).toBe('45 s')
    expect(formatEspera(16 * 60)).toBe('16 min')
    expect(formatEspera(2 * 3600)).toBe('2 h')
    expect(formatEspera(2 * 3600 + 5 * 60)).toBe('2 h 5 min')
    expect(formatEspera(27 * 3600)).toBe('1 d 3 h')
    expect(segundosDesde('2026-10-16T10:00:00Z', Date.parse('2026-10-16T10:15:30Z'))).toBe(930)
    expect(segundosDesde('fecha rota', 0)).toBe(0)
    expect(segundosDesde('2026-10-16T10:00:10Z', Date.parse('2026-10-16T10:00:00Z'))).toBe(0)
  })

  it('monto: acepta formatos argentinos y rechaza basura', () => {
    expect(parseMonto('')).toEqual({ ok: true, valor: null })
    expect(parseMonto('  ')).toEqual({ ok: true, valor: null })
    expect(parseMonto('1500000')).toEqual({ ok: true, valor: 1500000 })
    expect(parseMonto('1.500.000')).toEqual({ ok: true, valor: 1500000 })
    expect(parseMonto('$ 1.500.000')).toEqual({ ok: true, valor: 1500000 })
    expect(parseMonto('1,5 millones').ok).toBe(false)
    expect(parseMonto('-100').ok).toBe(false)
    expect(parseMonto('9999999999').ok).toBe(false)
    expect(formatMonto(1500000)).toBe('$1.500.000')
    expect(formatMonto(null)).toBe('-')
  })

  it('relación', () => {
    expect(etiquetaRelacion('titular')).toBe('Titular')
    expect(etiquetaRelacion('familiar')).toBe('Familiar')
    expect(etiquetaRelacion('padre')).toBe('Padre')
    expect(etiquetaRelacion(null)).toBe('Titular')
  })

  it('config: si no se pudo leer, todo apagado', () => {
    expect(leerConfig(null)).toEqual({ colaDniActiva: false, avisoSendpulseActivo: false, alertaEsperaMinutos: 15, tomaExpiraMinutos: 5 })
    expect(leerConfig([
      { clave: 'cola_dni_activa', valor: true },
      { clave: 'aviso_sendpulse_activo', valor: false },
      { clave: 'alerta_espera_minutos', valor: 20 },
    ])).toMatchObject({ colaDniActiva: true, avisoSendpulseActivo: false, alertaEsperaMinutos: 20 })
    expect(leerConfig([{ clave: 'cola_dni_activa', valor: 'true' }]).colaDniActiva).toBe(false)
  })

  it('quién puede verificar', () => {
    expect(puedeVerificar({ role: 'admin' })).toBe(true)
    expect(puedeVerificar({ role: 'empleado', verifica_dni: true })).toBe(true)
    expect(puedeVerificar({ role: 'empleado', verifica_dni: false })).toBe(false)
    expect(puedeVerificar({ role: 'empleado' })).toBe(false)
    expect(puedeVerificar(null)).toBe(false)
  })

  it('mensajes para el operador', () => {
    expect(mensajeMotivo({ motivo: 'YA_RESUELTO', por: 'Vendedor 2', resultado: 'aprobado' })).toBe('Ya estaba resuelto por Vendedor 2 (aprobado).')
    expect(mensajeMotivo({ motivo: 'YA_RESUELTO', origen: 'sendpulse', resultado: 'rechazado' })).toBe('Ya estaba resuelto desde SendPulse (rechazado).')
    expect(mensajeMotivo({ motivo: 'TOMADO_POR_OTRO', por: 'Vendedor 1' })).toBe('Lo está revisando Vendedor 1.')
    expect(mensajeMotivo({ motivo: 'DESCONOCIDO' })).toMatch(/Probá de nuevo/)
    expect(motivoDeErrorRpc({ message: 'COLA_DESACTIVADA' })).toBe('COLA_DESACTIVADA')
    expect(motivoDeErrorRpc({ message: 'otra cosa' })).toBeNull()
    expect(mensajeResultado('aprobado', { estado: 'enviado' })).toEqual({ tipo: 'success', texto: 'DNI aprobado. El cliente fue avisado por WhatsApp.' })
    expect(mensajeResultado('rechazado', { estado: 'fallido', error: 'HTTP 503' })).toEqual({
      tipo: 'warning', texto: 'DNI rechazado, pero el cliente NO fue avisado (HTTP 503). Quedó en "Sin avisar".',
    })
  })

  it('lee el motivo del error de la edge function', async () => {
    const error = { context: new Response(JSON.stringify({ ok: false, motivo: 'YA_RESUELTO' }), { status: 409 }) }
    expect(await datosDeErrorFuncion(error)).toEqual({ ok: false, motivo: 'YA_RESUELTO' })
    expect(await datosDeErrorFuncion({ context: new Response('no json') })).toEqual({ motivo: null })
    expect(await datosDeErrorFuncion(null)).toEqual({ motivo: null })
  })
})

describe('leads para contactar', () => {
  const ahora = Date.parse('2026-10-16T12:00:00Z')
  it('aprobados sin contactar y perdidos que volvieron, los más viejos primero', () => {
    const leads = [
      { id: 'a2', estado: 'nuevo', estado_dni: 'aprobado', dni_actualizado_at: '2026-10-16T11:00:00Z' },
      { id: 'a1', estado: 'nuevo', estado_dni: 'aprobado', dni_actualizado_at: '2026-10-16T09:00:00Z' },
      { id: 'contactado', estado: 'contactado', estado_dni: 'aprobado' },
      { id: 'pendiente', estado: 'nuevo', estado_dni: 'pendiente' },
      { id: 'v1', estado: 'nuevo', reingreso_at: '2026-10-15T12:00:00Z' },
      { id: 'viejo', estado: 'nuevo', reingreso_at: '2026-10-01T12:00:00Z' },
      { id: 'sigue-perdido', estado: 'perdido', reingreso_at: '2026-10-16T10:00:00Z' },
    ]
    const r = leadsParaContactar(leads, ahora)
    expect(r.aprobados.map(l => l.id)).toEqual(['a1', 'a2'])
    expect(r.volvieron.map(l => l.id)).toEqual(['v1'])
    expect(leadsParaContactar(null)).toEqual({ aprobados: [], volvieron: [] })
  })
})

describe('enmascarar DNI', () => {
  it('muestra solo los últimos 3 dígitos', () => {
    expect(enmascararDni('30111222')).toBe('***222')
    expect(enmascararDni(null)).toBe('-')
  })
})
