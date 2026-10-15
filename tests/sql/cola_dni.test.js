import { describe, it, expect, beforeEach } from 'vitest'
import { crearBase, como, comoServicio, comoAnonimo, rpc, crearLead, lead, historial, leerSql, U } from './helpers.js'

describe('migraciones', () => {
  it('la 008 se puede correr dos veces y la 007 no cambia nada sobre producción', async () => {
    const db = await crearBase()
    await db.exec(leerSql('supabase/migrations/008_cola_verificacion_dni.sql'))
    await db.exec(leerSql('supabase/migrations/007_leads_verificacion_dni.sql'))
    const { rows } = await db.query(`SELECT clave, valor FROM public.crm_config ORDER BY clave`)
    expect(rows.map(r => r.clave)).toEqual(expect.arrayContaining(['alerta_espera_minutos', 'aviso_sendpulse_activo', 'cola_dni_activa', 'toma_expira_minutos']))
  })

  it('arranca todo apagado', async () => {
    const db = await crearBase()
    await db.exec(`DELETE FROM public.crm_config`)
    await db.exec(leerSql('supabase/migrations/008_cola_verificacion_dni.sql'))
    const { rows } = await db.query(`SELECT clave, valor FROM public.crm_config WHERE clave IN ('cola_dni_activa', 'aviso_sendpulse_activo')`)
    expect(rows.every(r => r.valor === false)).toBe(true)
  })

  it('los perfiles existentes quedan sin permiso de verificar', async () => {
    const db = await crearBase()
    await db.query(`INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000d1')`)
    await db.query(`INSERT INTO public.profiles (id, dni, full_name) VALUES ('00000000-0000-0000-0000-0000000000d1', '40000001', 'Nuevo')`)
    const { rows } = await db.query(`SELECT verifica_dni FROM public.profiles WHERE dni = '40000001'`)
    expect(rows[0].verifica_dni).toBe(false)
  })
})

describe('cola de verificación', () => {
  let db
  beforeEach(async () => { db = await crearBase() })

  it('con la cola apagada no lista ni resuelve', async () => {
    await db.query(`UPDATE public.crm_config SET valor = 'false' WHERE clave = 'cola_dni_activa'`)
    const l = await crearLead(db)
    await expect(como(db, U.admin, () => db.query('SELECT * FROM public.dni_cola_listar()'))).rejects.toThrow('COLA_DESACTIVADA')
    await expect(como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', null]))).rejects.toThrow('COLA_DESACTIVADA')
  })

  it('solo admin y verificadores pueden usarla', async () => {
    await crearLead(db)
    await expect(como(db, U.sinPermiso, () => db.query('SELECT * FROM public.dni_cola_listar()'))).rejects.toThrow('SIN_PERMISO')
    await expect(comoAnonimo(db, () => db.query('SELECT * FROM public.dni_cola_listar()'))).rejects.toThrow(/permission denied/)
    const admin = await como(db, U.admin, () => db.query('SELECT * FROM public.dni_cola_listar()'))
    const vendedor = await como(db, U.vendedor1, () => db.query('SELECT * FROM public.dni_cola_listar()'))
    expect(admin.rows).toHaveLength(1)
    expect(vendedor.rows).toHaveLength(1)
  })

  it('lista solo pendientes, los más viejos primero', async () => {
    const viejo = await crearLead(db, { nombre: 'Viejo', dni_actualizado_at: '2026-10-16T10:00:00Z' })
    const nuevo = await crearLead(db, { nombre: 'Nuevo', telefono: '5493510000002', dni_actualizado_at: '2026-10-16T11:00:00Z' })
    await crearLead(db, { nombre: 'Aprobado', telefono: '5493510000003', estado_dni: 'aprobado' })
    await crearLead(db, { nombre: 'Sin DNI', telefono: '5493510000004', estado_dni: null, dni: null })
    const { rows } = await como(db, U.vendedor1, () => db.query('SELECT * FROM public.dni_cola_listar()'))
    expect(rows.map(r => r.lead_id)).toEqual([viejo.id, nuevo.id])
    expect(rows[0]).toMatchObject({ nombre: 'Viejo', dni: '30111222', relacion: 'titular', intento: 1, tiene_contacto: true, tomado_por_mi: false })
  })

  it('aprobar: actualiza el lead, deja nota sin el DNI completo y queda en el historial con el operador', async () => {
    const l = await crearLead(db, { notas: 'Nota previa' })
    const r = await como(db, U.vendedor1, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', 1500000]))
    expect(r).toMatchObject({ ok: true, resultado: 'aprobado', monto_aprobado: 1500000, aviso_estado: 'pendiente', sendpulse_contact_id: 'sp-contacto-1' })

    const despues = await lead(db, l.id)
    expect(despues.estado_dni).toBe('aprobado')
    expect(Number(despues.monto_aprobado)).toBe(1500000)
    expect(new Date(despues.dni_actualizado_at).getTime()).toBeGreaterThan(new Date(l.dni_actualizado_at).getTime() - 1)
    expect(despues.notas).toMatch(/^Nota previa\n\[\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}\] CRM: DNI aprobado por Vendedor 1, monto \$1\.500\.000 \(intento 1, titular \*\*\*222\)$/)
    expect(despues.notas).not.toContain('30111222')

    const { rows: res } = await db.query('SELECT * FROM public.dni_resoluciones WHERE lead_id = $1', [l.id])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ intento: 1, resultado: 'aprobado', operador_id: U.vendedor1, origen: 'crm', aviso_estado: 'pendiente' })

    const h = await historial(db, l.id)
    expect(h).toContainEqual({ campo: 'Verificación DNI', valor_anterior: 'pendiente', valor_nuevo: 'aprobado ($1.500.000)', usuario_id: U.vendedor1 })
    // El trigger de auditoría existente registra el cambio de notas a nombre del operador.
    expect(h.find(x => x.campo === 'Notas').usuario_id).toBe(U.vendedor1)
  })

  it('rechazar: no guarda monto aunque llegue uno', async () => {
    const l = await crearLead(db)
    const r = await como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'rechazado', 500000]))
    expect(r).toMatchObject({ ok: true, resultado: 'rechazado', monto_aprobado: null })
    expect((await lead(db, l.id)).monto_aprobado).toBeNull()
  })

  it('el segundo que resuelve recibe YA_RESUELTO con quién lo hizo, y no cambia nada', async () => {
    const l = await crearLead(db)
    await como(db, U.vendedor1, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', 1000000]))
    const notasAntes = (await lead(db, l.id)).notas
    const r = await como(db, U.vendedor2, () => rpc(db, 'dni_resolver', [l.id, 1, 'rechazado', null]))
    expect(r).toMatchObject({ ok: false, motivo: 'YA_RESUELTO', resultado: 'aprobado', por: 'Vendedor 1', origen: 'crm' })
    const despues = await lead(db, l.id)
    expect(despues.estado_dni).toBe('aprobado')
    expect(despues.notas).toBe(notasAntes)
  })

  it('si llegó un DNI nuevo mientras el operador miraba el anterior, no lo deja resolver', async () => {
    const l = await crearLead(db, { dni_intentos: 2 })
    const r = await como(db, U.vendedor1, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', null]))
    expect(r).toMatchObject({ ok: false, motivo: 'INTENTO_CAMBIO', intento_actual: 2 })
    expect((await lead(db, l.id)).estado_dni).toBe('pendiente')
  })

  it('reserva: si otro la tomó, no la puede resolver hasta que venza', async () => {
    const l = await crearLead(db)
    expect(await como(db, U.vendedor1, () => rpc(db, 'dni_tomar', [l.id, 1]))).toEqual({ ok: true })

    const tomarOtro = await como(db, U.vendedor2, () => rpc(db, 'dni_tomar', [l.id, 1]))
    expect(tomarOtro).toMatchObject({ ok: false, motivo: 'TOMADO_POR_OTRO', por: 'Vendedor 1' })
    const resolverOtro = await como(db, U.vendedor2, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', null]))
    expect(resolverOtro).toMatchObject({ ok: false, motivo: 'TOMADO_POR_OTRO' })

    const vista = await como(db, U.vendedor2, () => db.query('SELECT tomado_por_nombre, tomado_por_mi FROM public.dni_cola_listar()'))
    expect(vista.rows[0]).toEqual({ tomado_por_nombre: 'Vendedor 1', tomado_por_mi: false })

    // Vence la reserva (5 minutos por defecto)
    await db.query(`UPDATE public.dni_tomas SET tomado_at = now() - INTERVAL '6 minutes'`)
    const r = await como(db, U.vendedor2, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', null]))
    expect(r.ok).toBe(true)
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.dni_tomas')
    expect(rows[0].n).toBe(0)
  })

  it('el que tomó la consulta la puede soltar', async () => {
    const l = await crearLead(db)
    await como(db, U.vendedor1, () => rpc(db, 'dni_tomar', [l.id, 1]))
    expect(await como(db, U.vendedor1, () => rpc(db, 'dni_soltar', [l.id]))).toBe(true)
    expect(await como(db, U.vendedor2, () => rpc(db, 'dni_tomar', [l.id, 1]))).toEqual({ ok: true })
  })

  it('estado del aviso: sin contacto de SendPulse o con el aviso apagado', async () => {
    const sinContacto = await crearLead(db, { sendpulse_contact_id: null })
    const r1 = await como(db, U.admin, () => rpc(db, 'dni_resolver', [sinContacto.id, 1, 'aprobado', null]))
    expect(r1).toMatchObject({ aviso_estado: 'sin_contacto', sendpulse_contact_id: null })

    await db.query(`UPDATE public.crm_config SET valor = 'false' WHERE clave = 'aviso_sendpulse_activo'`)
    const conContacto = await crearLead(db, { telefono: '5493510000009' })
    const r2 = await como(db, U.admin, () => rpc(db, 'dni_resolver', [conContacto.id, 1, 'rechazado', null]))
    expect(r2).toMatchObject({ aviso_estado: 'desactivado', sendpulse_contact_id: null })
  })

  it('valida resultado y monto', async () => {
    const l = await crearLead(db)
    await expect(como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'quizas', null]))).rejects.toThrow('RESULTADO_INVALIDO')
    await expect(como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', -5]))).rejects.toThrow('MONTO_INVALIDO')
    await expect(como(db, U.admin, () => rpc(db, 'dni_resolver', ['00000000-0000-0000-0000-000000000999', 1, 'aprobado', null]))).rejects.toThrow('LEAD_NO_ENCONTRADO')
  })

  it('nadie escribe las tablas nuevas por fuera de las funciones', async () => {
    const l = await crearLead(db)
    await expect(como(db, U.vendedor1, () => db.query('SELECT * FROM public.dni_tomas'))).rejects.toThrow(/permission denied/)
    await expect(como(db, U.admin, () => db.query(
      `INSERT INTO public.dni_resoluciones (lead_id, intento, resultado) VALUES ($1, 1, 'aprobado')`, [l.id]
    ))).rejects.toThrow(/permission denied/)
    // Un vendedor no puede prender interruptores; el admin sí.
    const v = await como(db, U.vendedor1, () => db.query(`UPDATE public.crm_config SET valor = 'false' WHERE clave = 'cola_dni_activa' RETURNING clave`))
    expect(v.rows).toHaveLength(0)
    const a = await como(db, U.admin, () => db.query(`UPDATE public.crm_config SET valor = 'false' WHERE clave = 'cola_dni_activa' RETURNING clave`))
    expect(a.rows).toHaveLength(1)
  })

  it('un vendedor ve las resoluciones de sus leads y las que hizo él, no las demás', async () => {
    const suyo = await crearLead(db, { vendedor_asignado: U.vendedor2 })
    const ajeno = await crearLead(db, { telefono: '5493510000005' })
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [suyo.id, 1, 'aprobado', null]))
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [ajeno.id, 1, 'aprobado', null]))
    const { rows } = await como(db, U.vendedor2, () => db.query('SELECT lead_id FROM public.dni_resoluciones'))
    expect(rows.map(r => r.lead_id)).toEqual([suyo.id])
  })

  it('las reglas actuales de leads no cambian: cada vendedor sigue viendo solo los suyos', async () => {
    await crearLead(db, { vendedor_asignado: U.vendedor1 })
    await crearLead(db, { telefono: '5493510000006' })
    const { rows } = await como(db, U.vendedor1, () => db.query('SELECT id FROM public.leads'))
    expect(rows).toHaveLength(1)
  })
})

describe('aviso al cliente', () => {
  let db
  beforeEach(async () => { db = await crearBase() })

  it('solo la clave de servicio registra el resultado del aviso, sin guardar números largos', async () => {
    const l = await crearLead(db)
    const { resolucion_id: id } = await como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', null]))

    await expect(como(db, U.admin, () => rpc(db, 'dni_registrar_aviso', [id, true, 1, null]))).rejects.toThrow(/permission denied/)

    expect(await comoServicio(db, () => rpc(db, 'dni_registrar_aviso', [id, false, 3, 'HTTP 500 contacto 30111222']))).toBe(true)
    const { rows } = await db.query('SELECT aviso_estado, aviso_intentos, aviso_error FROM public.dni_resoluciones WHERE id = $1', [id])
    expect(rows[0]).toEqual({ aviso_estado: 'fallido', aviso_intentos: 3, aviso_error: 'HTTP 500 contacto ***' })

    expect(await comoServicio(db, () => rpc(db, 'dni_registrar_aviso', [id, true, 1, null]))).toBe(true)
    const { rows: ok } = await db.query('SELECT aviso_estado, aviso_intentos, aviso_error FROM public.dni_resoluciones WHERE id = $1', [id])
    expect(ok[0]).toEqual({ aviso_estado: 'enviado', aviso_intentos: 4, aviso_error: null })
    expect(await historial(db, l.id)).toContainEqual(
      { campo: 'Aviso al cliente', valor_anterior: null, valor_nuevo: 'Enviado por WhatsApp (SendPulse)', usuario_id: null }
    )
  })

  it('lista los no avisados, permite reintentar y marcar como avisado a mano', async () => {
    const fallido = await crearLead(db)
    const sinContacto = await crearLead(db, { telefono: '5493510000007', sendpulse_contact_id: null })
    const enviado = await crearLead(db, { telefono: '5493510000008', sendpulse_contact_id: 'sp-2' })
    const r1 = await como(db, U.admin, () => rpc(db, 'dni_resolver', [fallido.id, 1, 'aprobado', null]))
    const r2 = await como(db, U.admin, () => rpc(db, 'dni_resolver', [sinContacto.id, 1, 'rechazado', null]))
    const r3 = await como(db, U.admin, () => rpc(db, 'dni_resolver', [enviado.id, 1, 'aprobado', null]))
    await comoServicio(db, () => rpc(db, 'dni_registrar_aviso', [r1.resolucion_id, false, 3, 'timeout']))
    await comoServicio(db, () => rpc(db, 'dni_registrar_aviso', [r3.resolucion_id, true, 1, null]))

    const { rows } = await como(db, U.vendedor1, () => db.query('SELECT resolucion_id, aviso_estado FROM public.dni_avisos_pendientes()'))
    expect(rows).toEqual(expect.arrayContaining([
      { resolucion_id: r1.resolucion_id, aviso_estado: 'fallido' },
      { resolucion_id: r2.resolucion_id, aviso_estado: 'sin_contacto' },
    ]))
    expect(rows).toHaveLength(2)

    expect(await como(db, U.vendedor1, () => rpc(db, 'dni_preparar_reintento', [r1.resolucion_id])))
      .toEqual({ ok: true, resolucion_id: r1.resolucion_id, resultado: 'aprobado', sendpulse_contact_id: 'sp-contacto-1' })
    expect(await como(db, U.vendedor1, () => rpc(db, 'dni_preparar_reintento', [r2.resolucion_id])))
      .toMatchObject({ ok: false, motivo: 'NO_REINTENTABLE' })

    expect(await como(db, U.vendedor1, () => rpc(db, 'dni_marcar_avisado_manual', [r2.resolucion_id]))).toBe(true)
    const despues = await como(db, U.vendedor1, () => db.query('SELECT resolucion_id FROM public.dni_avisos_pendientes()'))
    expect(despues.rows).toEqual([{ resolucion_id: r1.resolucion_id }])
  })

  it('no reintenta avisar un resultado viejo si llegó un DNI nuevo', async () => {
    const l = await crearLead(db)
    const r = await como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'rechazado', null]))
    await comoServicio(db, () => rpc(db, 'dni_registrar_aviso', [r.resolucion_id, false, 3, 'timeout']))
    await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-contacto-1', null, null, '28999888', 'familiar']))
    expect(await como(db, U.admin, () => rpc(db, 'dni_preparar_reintento', [r.resolucion_id])))
      .toMatchObject({ ok: false, motivo: 'DESACTUALIZADO' })
  })
})
