import { describe, it, expect, beforeEach } from 'vitest'
import { crearBase, como, comoServicio, rpc, crearLead, lead, historial, U } from './helpers.js'

const recibido = (db, contacto, telefono, nombre, dni, relacion) =>
  comoServicio(db, () => rpc(db, 'dni_webhook_recibido', [contacto, telefono, nombre, dni, relacion]))
const resultado = (db, contacto, telefono, res, monto) =>
  comoServicio(db, () => rpc(db, 'dni_webhook_resultado', [contacto, telefono, res, monto]))

describe('webhook WhatsApp: dni_recibido', () => {
  let db
  beforeEach(async () => { db = await crearBase() })

  it('crea el lead nuevo igual que antes, pero sin el DNI completo en las notas', async () => {
    const r = await recibido(db, 'sp-1', '+54 9 351 555-1234', 'Juan Pérez', '30.111.222', null)
    expect(r).toMatchObject({ is_new: true, estado: 'creado' })
    const l = await lead(db, r.lead_id)
    expect(l).toMatchObject({
      nombre: 'Juan Pérez', telefono: '+54 9 351 555-1234', origen: 'whatsapp', estado: 'nuevo', dni: '30111222',
      estado_dni: 'pendiente', dni_titular_relacion: 'titular', dni_intentos: 1, sendpulse_contact_id: 'sp-1',
    })
    expect(l.notas).toMatch(/^Nuevo contacto vía WhatsApp \(bot SendPulse\)\n\[.+\] WhatsApp: DNI \*\*\*222 \(titular\) enviado para verificar$/)
    expect(await historial(db, r.lead_id)).toContainEqual({ campo: 'DNI recibido', valor_anterior: null, valor_nuevo: 'Intento 1 (titular)', usuario_id: null })
  })

  it('si SendPulse repite la misma llamada no suma otro intento', async () => {
    const r1 = await recibido(db, 'sp-1', '3515551234', 'Juan', '30111222', 'titular')
    const r2 = await recibido(db, 'sp-1', '3515551234', 'Juan', '30111222', 'titular')
    expect(r2).toMatchObject({ lead_id: r1.lead_id, estado: 'ya_pendiente' })
    expect((await lead(db, r1.lead_id)).dni_intentos).toBe(1)
  })

  it('el DNI de un familiar es un nuevo intento del mismo lead', async () => {
    const r1 = await recibido(db, 'sp-1', '3515551234', 'Juan', '30111222', 'titular')
    await resultado(db, 'sp-1', null, 'rechazado', null)
    const r2 = await recibido(db, 'sp-1', '3515551234', 'Juan', '28999888', 'familiar')
    expect(r2).toMatchObject({ lead_id: r1.lead_id, estado: 'actualizado', is_new: false })
    expect(await lead(db, r1.lead_id)).toMatchObject({ dni: '28999888', estado_dni: 'pendiente', dni_titular_relacion: 'familiar', dni_intentos: 2 })
  })

  it('encuentra el lead por teléfono aunque esté escrito distinto, y no falla con duplicados', async () => {
    await crearLead(db, { nombre: 'Viejo', telefono: '0351 15 555-1234', sendpulse_contact_id: null, estado_dni: null, dni: null, dni_intentos: 0, created_at: '2026-09-01T00:00:00Z' })
    const reciente = await crearLead(db, { nombre: 'Reciente', telefono: '351-5551234', sendpulse_contact_id: null, estado_dni: null, dni: null, dni_intentos: 0, created_at: '2026-10-01T00:00:00Z' })
    const r = await recibido(db, 'sp-nuevo', '5493515551234', 'Juan', '30111222', 'titular')
    expect(r).toMatchObject({ lead_id: reciente.id, estado: 'actualizado' })
    expect((await lead(db, reciente.id)).sendpulse_contact_id).toBe('sp-nuevo')
  })

  it('un lead con DNI aprobado no vuelve a pendiente', async () => {
    const l = await crearLead(db, { estado_dni: 'aprobado', monto_aprobado: 900000 })
    const r = await recibido(db, 'sp-contacto-1', null, 'Juan', '27000111', 'familiar')
    expect(r).toMatchObject({ lead_id: l.id, estado: 'ya_aprobado' })
    const despues = await lead(db, l.id)
    expect(despues).toMatchObject({ estado_dni: 'aprobado', dni: '30111222', dni_intentos: 1 })
    expect(despues.notas).toMatch(/llegó otro DNI \(\*\*\*111, familiar\) pero el lead ya tiene un DNI aprobado/)
  })

  it('valida DNI y contacto', async () => {
    await expect(recibido(db, 'sp-1', null, 'Juan', '123', null)).rejects.toThrow('DNI_INVALIDO')
    await expect(recibido(db, null, null, 'Juan', '30111222', null)).rejects.toThrow('FALTA_CONTACTO')
  })

  it('el CRM no puede llamar a las funciones del webhook', async () => {
    await expect(como(db, U.admin, () => rpc(db, 'dni_webhook_recibido', ['sp', null, 'x', '30111222', null]))).rejects.toThrow(/permission denied/)
    await expect(como(db, U.admin, () => rpc(db, 'dni_webhook_resultado', ['sp', null, 'aprobado', null]))).rejects.toThrow(/permission denied/)
  })
})

describe('webhook WhatsApp: resultado (sin doble registro)', () => {
  let db
  beforeEach(async () => { db = await crearBase() })

  it('si el lead está pendiente, lo registra (resultado disparado a mano desde Chats)', async () => {
    const l = await crearLead(db)
    const r = await resultado(db, 'sp-contacto-1', null, 'aprobado', 1200000)
    expect(r).toEqual({ lead_id: l.id, estado: 'registrado', estado_dni: 'aprobado' })
    const despues = await lead(db, l.id)
    expect(despues.estado_dni).toBe('aprobado')
    expect(Number(despues.monto_aprobado)).toBe(1200000)
    const { rows } = await db.query('SELECT origen, aviso_estado, operador_id FROM public.dni_resoluciones WHERE lead_id = $1', [l.id])
    expect(rows).toEqual([{ origen: 'sendpulse', aviso_estado: 'externo', operador_id: null }])
  })

  it('después de resolver en el CRM, el aviso del flujo no duplica nada ni borra el monto', async () => {
    const l = await crearLead(db)
    await como(db, U.vendedor1, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', 1500000]))
    const antes = await lead(db, l.id)
    const historialAntes = await historial(db, l.id)

    const r = await resultado(db, 'sp-contacto-1', null, 'aprobado', null)
    expect(r).toEqual({ lead_id: l.id, estado: 'ya_registrado', estado_dni: 'aprobado' })

    const despues = await lead(db, l.id)
    expect(Number(despues.monto_aprobado)).toBe(1500000)
    expect(despues.notas).toBe(antes.notas)
    expect(despues.dni_actualizado_at).toEqual(antes.dni_actualizado_at)
    expect(await historial(db, l.id)).toHaveLength(historialAntes.length)
  })

  it('si el flujo informa lo contrario de lo que registró el CRM, no pisa nada y deja nota', async () => {
    const l = await crearLead(db)
    await como(db, U.vendedor1, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', 1500000]))
    const r = await resultado(db, 'sp-contacto-1', null, 'rechazado', null)
    expect(r).toEqual({ lead_id: l.id, estado: 'conflicto', estado_dni: 'aprobado' })
    const despues = await lead(db, l.id)
    expect(despues.estado_dni).toBe('aprobado')
    expect(Number(despues.monto_aprobado)).toBe(1500000)
    expect(despues.notas).toMatch(/SendPulse informó DNI rechazado, pero el CRM ya tenía aprobado/)
  })

  it('lead inexistente', async () => {
    expect(await resultado(db, 'no-existe', null, 'aprobado', null)).toEqual({ estado: 'no_encontrado' })
    await expect(resultado(db, 'sp', null, 'tal vez', null)).rejects.toThrow('RESULTADO_INVALIDO')
  })
})
