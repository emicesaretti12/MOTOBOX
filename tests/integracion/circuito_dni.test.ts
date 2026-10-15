// Circuito completo como queda en producción, contra la base en memoria (esquema de producción + migraciones):
// el bot manda el DNI (como lo guarda la v4 del webhook) -> aparece en la cola -> el operador resuelve
// (dni-resolver) -> se asigna vendedor por turno -> SendPulse (simulado) ejecuta el flujo -> el flujo
// avisa el resultado al webhook (v5) sin duplicar nada.
import { describe, it, expect, beforeEach } from 'vitest'
import { crearBase, como, comoServicio, lead, historial, U } from '../sql/helpers.js'
import { registrarResultado } from '../../supabase/functions/sendpulse-whatsapp-webhook/resultado.ts'
import { handleRequest as resolver, type Dependencias } from '../../supabase/functions/dni-resolver/handler.ts'

type Db = Awaited<ReturnType<typeof crearBase>>

async function llamar(db: Db, funcion: string, args: Record<string, unknown>) {
  const claves = Object.keys(args)
  const sql = `SELECT public.${funcion}(${claves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`
  try {
    const { rows } = await db.query<{ r: unknown }>(sql, Object.values(args))
    return { data: rows[0].r, error: null }
  } catch (e) {
    return { data: null, error: { message: (e as Error).message, code: 'P0001' } }
  }
}

// Lo mismo que hace la v4 de sendpulse-whatsapp-webhook (accion dni_recibido / lead_calificado) con un DNI válido.
async function llegaDni(db: Db, contacto: string, telefono: string, nombre: string, dni: string, relacion = 'titular') {
  return comoServicio(db, async () => {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM public.leads WHERE sendpulse_contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contacto])
    if (rows[0]) {
      await db.query(
        `UPDATE public.leads SET dni = $2, estado_dni = 'pendiente', dni_titular_relacion = $3, dni_intentos = dni_intentos + 1,
                dni_actualizado_at = now(), forma_pago = 'cuotas', prioridad = 'media' WHERE id = $1`, [rows[0].id, dni, relacion])
      return rows[0].id
    }
    const ins = await db.query<{ id: string }>(
      `INSERT INTO public.leads (nombre, telefono, origen, estado, dni, estado_dni, dni_titular_relacion, dni_intentos,
                                 sendpulse_contact_id, dni_actualizado_at, forma_pago, prioridad)
       VALUES ($1, $2, 'whatsapp', 'nuevo', $3, 'pendiente', $4, 1, $5, now(), 'cuotas', 'media') RETURNING id`,
      [nombre, telefono, dni, relacion, contacto])
    return ins.rows[0].id
  })
}

function armar(db: Db, sendpulseOk: () => boolean) {
  const flujosEjecutados: Array<[string, string]> = []
  const depsResolver: Dependencias = {
    origenesPermitidos: [],
    // En el test el "JWT" es directamente el id del usuario.
    rpcComoUsuario: (authorization, funcion, args) => como(db, authorization.replace('Bearer ', ''), () => llamar(db, funcion, args)),
    rpcServicio: (funcion, args) => comoServicio(db, () => llamar(db, funcion, args)),
    sendpulse: {
      ejecutarFlujo: async (contactId, flowId) => {
        flujosEjecutados.push([contactId, flowId])
        return sendpulseOk() ? { ok: true, intentos: 1 } : { ok: false, intentos: 3, error: 'SendPulse respondió HTTP 503' }
      },
    },
    flujos: { aprobado: 'flujo-aprobado', rechazado: 'flujo-rechazado' },
    log: { error: () => {}, warn: () => {} },
  }
  // Lo que hace el flujo de SendPulse al terminar: avisa el resultado al webhook (v5).
  const flujoAvisaResultado = (contactId: string, resultado: string) => registrarResultado({
    rpc: (funcion, args) => comoServicio(db, () => llamar(db, funcion, args)),
    marcarPrioridadAlta: async (id) => { await db.query(`UPDATE public.leads SET prioridad = 'alta' WHERE id = $1`, [id]); return { error: null } },
    log: { error: () => {} },
  }, { contactId, resultado, monto: null })
  const usarResolver = async (usuario: string, body: unknown) => {
    const res = await resolver(new Request('https://x/r', { method: 'POST', headers: { authorization: `Bearer ${usuario}` }, body: JSON.stringify(body) }), depsResolver)
    return { status: res.status, body: await res.json() }
  }
  const cola = (usuario: string) => como(db, usuario, async () => (await db.query<Record<string, any>>('SELECT * FROM public.dni_cola_listar()')).rows)
  return { flujosEjecutados, flujoAvisaResultado, usarResolver, cola }
}

describe('circuito completo de verificación de DNI', () => {
  let db: Db
  beforeEach(async () => {
    db = await crearBase({ asignacion: true })
    await db.query('UPDATE public.profiles SET recibe_leads = true WHERE id IN ($1, $2)', [U.vendedor1, U.vendedor2])
  })

  it('titular rechazado, familiar aprobado, vendedor asignado y sin doble registro', async () => {
    const c = armar(db, () => true)

    // 1. El bot manda nombre y DNI del titular
    const leadId = await llegaDni(db, 'sp-77', '5493515557777', 'Ana Gómez', '33444555')

    // 2. Aparece en la cola del verificador
    const cola1 = await c.cola(U.vendedor1)
    expect(cola1).toHaveLength(1)
    expect(cola1[0]).toMatchObject({ lead_id: leadId, nombre: 'Ana Gómez', dni: '33444555', relacion: 'titular', intento: 1 })

    // 3. Lo rechaza: se ejecuta el flujo de rechazo en SendPulse y nadie queda asignado
    const res1 = await c.usarResolver(U.vendedor1, { accion: 'resolver', lead_id: leadId, intento: 1, resultado: 'rechazado' })
    expect(res1).toMatchObject({ status: 200, body: { ok: true, resultado: 'rechazado', aviso: { estado: 'enviado' } } })
    expect(c.flujosEjecutados).toEqual([['sp-77', 'flujo-rechazado']])
    expect((await lead(db, leadId)).vendedor_asignado).toBeNull()

    // 4. El flujo "DNI rechazado" avisa al webhook: no duplica
    expect((await c.flujoAvisaResultado('sp-77', 'rechazado')).body.estado).toBe('ya_registrado')
    expect(await c.cola(U.vendedor1)).toHaveLength(0)

    // 5. El cliente manda el DNI de un familiar: nuevo intento del mismo lead
    await llegaDni(db, 'sp-77', '5493515557777', 'Ana Gómez', '20111222', 'familiar')
    const cola2 = await c.cola(U.vendedor2)
    expect(cola2[0]).toMatchObject({ lead_id: leadId, relacion: 'familiar', intento: 2 })

    // 6. Otro operador aprueba con monto: flujo de aprobación y asignación por turno
    const res2 = await c.usarResolver(U.vendedor2, { accion: 'resolver', lead_id: leadId, intento: 2, resultado: 'aprobado', monto: 2000000 })
    expect(res2.body).toMatchObject({ ok: true, resultado: 'aprobado', monto_aprobado: 2000000, aviso: { estado: 'enviado' } })
    expect(c.flujosEjecutados[1]).toEqual(['sp-77', 'flujo-aprobado'])

    // 7. El flujo "DNI aprobado" avisa al webhook sin monto: no lo borra y deja prioridad alta (como v4)
    expect((await c.flujoAvisaResultado('sp-77', 'aprobado')).body.estado).toBe('ya_registrado')

    const final = await lead(db, leadId)
    expect(final).toMatchObject({ estado_dni: 'aprobado', dni_intentos: 2, dni_titular_relacion: 'familiar', estado: 'nuevo', prioridad: 'alta', vendedor_asignado: U.vendedor1 })
    expect(Number(final.monto_aprobado)).toBe(2000000)

    // 8. El vendedor asignado lo ve; el otro no
    const ve1 = await como(db, U.vendedor1, () => db.query('SELECT id FROM public.leads'))
    const ve2 = await como(db, U.vendedor2, () => db.query('SELECT id FROM public.leads'))
    expect(ve1.rows.map(r => r.id)).toEqual([leadId])
    expect(ve2.rows).toHaveLength(0)

    const { rows } = await db.query('SELECT intento, resultado, operador_id, aviso_estado FROM public.dni_resoluciones WHERE lead_id = $1 ORDER BY intento', [leadId])
    expect(rows).toEqual([
      { intento: 1, resultado: 'rechazado', operador_id: U.vendedor1, aviso_estado: 'enviado' },
      { intento: 2, resultado: 'aprobado', operador_id: U.vendedor2, aviso_estado: 'enviado' },
    ])
    const campos = (await historial(db, leadId)).map(h => `${h.campo}: ${h.valor_nuevo}`)
    expect(campos).toEqual(expect.arrayContaining([
      'Verificación DNI: rechazado',
      'Verificación DNI: aprobado ($2.000.000)',
      'Asignación automática: Vendedor 1 (por turno, DNI aprobado)',
      'Aviso al cliente: Enviado por WhatsApp (SendPulse)',
    ]))
    // Métricas: 2 DNIs enviados, 1 rechazado, 1 aprobado con familiar
    const { rows: ev } = await db.query('SELECT tipo, intento FROM public.dni_eventos WHERE lead_id = $1 ORDER BY id', [leadId])
    expect(ev).toEqual([
      { tipo: 'enviado', intento: 1 }, { tipo: 'rechazado', intento: 1 }, { tipo: 'enviado', intento: 2 }, { tipo: 'aprobado', intento: 2 },
    ])
  })

  it('si SendPulse no responde, el resultado queda guardado y se puede reintentar el aviso', async () => {
    let sendpulseAnda = false
    const c = armar(db, () => sendpulseAnda)
    const leadId = await llegaDni(db, 'sp-88', '5493515558888', 'Luis', '31222333')

    const res = await c.usarResolver(U.admin, { accion: 'resolver', lead_id: leadId, intento: 1, resultado: 'aprobado' })
    expect(res.body).toMatchObject({ ok: true, aviso: { estado: 'fallido', error: 'SendPulse respondió HTTP 503' } })
    expect((await lead(db, leadId)).estado_dni).toBe('aprobado')

    const pendientes = await como(db, U.vendedor1, async () => (await db.query<Record<string, any>>('SELECT * FROM public.dni_avisos_pendientes()')).rows)
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0]).toMatchObject({ nombre: 'Luis', aviso_estado: 'fallido', aviso_intentos: 3 })

    sendpulseAnda = true
    const reintento = await c.usarResolver(U.vendedor1, { accion: 'reintentar_aviso', resolucion_id: pendientes[0].resolucion_id })
    expect(reintento.body).toMatchObject({ ok: true, aviso: { estado: 'enviado' } })
    const despues = await como(db, U.vendedor1, async () => (await db.query('SELECT * FROM public.dni_avisos_pendientes()')).rows)
    expect(despues).toHaveLength(0)
  })

  it('dos operadores a la vez: el segundo se entera de que ya está resuelto y no se avisa dos veces', async () => {
    const c = armar(db, () => true)
    const leadId = await llegaDni(db, 'sp-99', '5493515559999', 'Eva', '32333444')
    const primero = await c.usarResolver(U.vendedor1, { accion: 'resolver', lead_id: leadId, intento: 1, resultado: 'aprobado' })
    const segundo = await c.usarResolver(U.vendedor2, { accion: 'resolver', lead_id: leadId, intento: 1, resultado: 'rechazado' })
    expect(primero.status).toBe(200)
    expect(segundo).toMatchObject({ status: 409, body: { ok: false, motivo: 'YA_RESUELTO', resultado: 'aprobado', por: 'Vendedor 1' } })
    expect(c.flujosEjecutados).toEqual([['sp-99', 'flujo-aprobado']])
  })
})
