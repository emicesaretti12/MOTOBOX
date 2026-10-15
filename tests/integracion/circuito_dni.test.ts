// Circuito completo contra la base en memoria (esquema de producción + 008), con SendPulse simulado:
// el cliente manda su DNI por WhatsApp -> aparece en la cola -> el operador resuelve -> el bot avisa
// -> el flujo de SendPulse confirma por el webhook sin duplicar nada.
import { describe, it, expect, beforeEach } from 'vitest'
import { crearBase, como, comoServicio, lead, historial, U } from '../sql/helpers.js'
import { handleRequest as webhook } from '../../supabase/functions/sendpulse-whatsapp-webhook/handler.v3.ts'
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
  const depsWebhook = { secreto: 's', rpc: (funcion: string, args: Record<string, unknown>) => comoServicio(db, () => llamar(db, funcion, args)) }

  const enviarWebhook = async (body: unknown) => {
    const res = await webhook(new Request('https://x/wh', { method: 'POST', headers: { 'x-webhook-secret': 's' }, body: JSON.stringify(body) }), depsWebhook)
    return { status: res.status, body: await res.json() }
  }
  const usarResolver = async (usuario: string, body: unknown) => {
    const res = await resolver(new Request('https://x/r', { method: 'POST', headers: { authorization: `Bearer ${usuario}` }, body: JSON.stringify(body) }), depsResolver)
    return { status: res.status, body: await res.json() }
  }
  const cola = (usuario: string) => como(db, usuario, async () => (await db.query<Record<string, any>>('SELECT * FROM public.dni_cola_listar()')).rows)
  return { flujosEjecutados, enviarWebhook, usarResolver, cola }
}

describe('circuito completo de verificación de DNI', () => {
  let db: Db
  beforeEach(async () => { db = await crearBase() })

  it('titular rechazado, familiar aprobado, sin doble registro', async () => {
    const c = armar(db, () => true)

    // 1. El bot manda nombre y DNI del titular
    const r1 = await c.enviarWebhook({ accion: 'dni_recibido', contact_id: 'sp-77', telefono: '5493515557777', nombre: 'Ana Gómez', dni: '33444555' })
    expect(r1.body).toMatchObject({ message: 'Lead creado', is_new: true })
    const leadId = r1.body.lead_id

    // 2. Aparece en la cola del verificador
    const cola1 = await c.cola(U.vendedor1)
    expect(cola1).toHaveLength(1)
    expect(cola1[0]).toMatchObject({ lead_id: leadId, nombre: 'Ana Gómez', dni: '33444555', relacion: 'titular', intento: 1 })

    // 3. Lo rechaza: se ejecuta el flujo de rechazo en SendPulse
    const res1 = await c.usarResolver(U.vendedor1, { accion: 'resolver', lead_id: leadId, intento: 1, resultado: 'rechazado' })
    expect(res1).toMatchObject({ status: 200, body: { ok: true, resultado: 'rechazado', aviso: { estado: 'enviado' } } })
    expect(c.flujosEjecutados).toEqual([['sp-77', 'flujo-rechazado']])

    // 4. El flujo "DNI rechazado" avisa al webhook: no duplica
    const conf1 = await c.enviarWebhook({ accion: 'resultado', contact_id: 'sp-77', resultado: 'rechazado' })
    expect(conf1.body.estado).toBe('ya_registrado')
    expect(await c.cola(U.vendedor1)).toHaveLength(0)

    // 5. El cliente manda el DNI de un familiar: nuevo intento del mismo lead
    const r2 = await c.enviarWebhook({ accion: 'dni_recibido', contact_id: 'sp-77', telefono: '5493515557777', dni: '20111222', relacion: 'familiar' })
    expect(r2.body).toMatchObject({ lead_id: leadId, is_new: false, estado: 'actualizado' })
    const cola2 = await c.cola(U.vendedor2)
    expect(cola2[0]).toMatchObject({ lead_id: leadId, relacion: 'familiar', intento: 2 })

    // 6. Otro operador aprueba con monto: flujo de aprobación
    const res2 = await c.usarResolver(U.vendedor2, { accion: 'resolver', lead_id: leadId, intento: 2, resultado: 'aprobado', monto: 2000000 })
    expect(res2.body).toMatchObject({ ok: true, resultado: 'aprobado', monto_aprobado: 2000000, aviso: { estado: 'enviado' } })
    expect(c.flujosEjecutados[1]).toEqual(['sp-77', 'flujo-aprobado'])

    // 7. El flujo "DNI aprobado" avisa al webhook sin monto: no lo borra
    const conf2 = await c.enviarWebhook({ accion: 'resultado', contact_id: 'sp-77', resultado: 'aprobado' })
    expect(conf2.body.estado).toBe('ya_registrado')

    const final = await lead(db, leadId)
    expect(final).toMatchObject({ estado_dni: 'aprobado', dni_intentos: 2, dni_titular_relacion: 'familiar', estado: 'nuevo' })
    expect(Number(final.monto_aprobado)).toBe(2000000)
    expect(final.notas).not.toMatch(/33444555|20111222/)

    const { rows } = await db.query('SELECT intento, resultado, operador_id, aviso_estado FROM public.dni_resoluciones WHERE lead_id = $1 ORDER BY intento', [leadId])
    expect(rows).toEqual([
      { intento: 1, resultado: 'rechazado', operador_id: U.vendedor1, aviso_estado: 'enviado' },
      { intento: 2, resultado: 'aprobado', operador_id: U.vendedor2, aviso_estado: 'enviado' },
    ])
    const campos = (await historial(db, leadId)).map(h => `${h.campo}: ${h.valor_nuevo}`)
    expect(campos).toEqual(expect.arrayContaining([
      'DNI recibido: Intento 1 (titular)',
      'Verificación DNI: rechazado',
      'DNI recibido: Intento 2 (familiar)',
      'Verificación DNI: aprobado ($2.000.000)',
      'Aviso al cliente: Enviado por WhatsApp (SendPulse)',
    ]))
  })

  it('si SendPulse no responde, el resultado queda guardado y se puede reintentar el aviso', async () => {
    let sendpulseAnda = false
    const c = armar(db, () => sendpulseAnda)
    const { body } = await c.enviarWebhook({ contact_id: 'sp-88', telefono: '5493515558888', nombre: 'Luis', dni: '31222333' })

    const res = await c.usarResolver(U.admin, { accion: 'resolver', lead_id: body.lead_id, intento: 1, resultado: 'aprobado' })
    expect(res.body).toMatchObject({ ok: true, aviso: { estado: 'fallido', error: 'SendPulse respondió HTTP 503' } })
    expect((await lead(db, body.lead_id)).estado_dni).toBe('aprobado')

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
    const { body } = await c.enviarWebhook({ contact_id: 'sp-99', telefono: '5493515559999', dni: '32333444' })
    const primero = await c.usarResolver(U.vendedor1, { accion: 'resolver', lead_id: body.lead_id, intento: 1, resultado: 'aprobado' })
    const segundo = await c.usarResolver(U.vendedor2, { accion: 'resolver', lead_id: body.lead_id, intento: 1, resultado: 'rechazado' })
    expect(primero.status).toBe(200)
    expect(segundo).toMatchObject({ status: 409, body: { ok: false, motivo: 'YA_RESUELTO', resultado: 'aprobado', por: 'Vendedor 1' } })
    expect(c.flujosEjecutados).toEqual([['sp-99', 'flujo-aprobado']])
  })
})
