import { describe, it, expect, beforeEach } from 'vitest'
import { crearBase, como, comoServicio, rpc, crearLead, lead, U } from './helpers.js'

const hoyCordoba = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
const metricas = (db, desde, hasta, uid = U.admin) =>
  como(db, uid, async () => (await db.query('SELECT * FROM public.metricas_dni($1, $2)', [desde, hasta])).rows)
const sumar = (filas, campo) => filas.reduce((s, f) => s + Number(f[campo]), 0)

describe('métricas de verificación (011)', () => {
  let db
  beforeEach(async () => {
    db = await crearBase({ asignacion: true })
    await db.query('UPDATE public.profiles SET recibe_leads = true WHERE id = $1', [U.vendedor1])
  })

  it('registra un evento por cada DNI recibido y cada resultado', async () => {
    const r1 = await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-1', '3515551111', 'Ana', '30111222', 'titular']))
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [r1.lead_id, 1, 'rechazado', null]))
    await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-1', '3515551111', 'Ana', '20111222', 'familiar']))
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [r1.lead_id, 2, 'aprobado', 900000]))
    // Repetir el mismo DNI pendiente no genera evento (no suma intento)
    const { rows } = await db.query('SELECT tipo, intento, relacion FROM public.dni_eventos ORDER BY id')
    expect(rows).toEqual([
      { tipo: 'enviado', intento: 1, relacion: 'titular' },
      { tipo: 'rechazado', intento: 1, relacion: 'titular' },
      { tipo: 'enviado', intento: 2, relacion: 'familiar' },
      { tipo: 'aprobado', intento: 2, relacion: 'familiar' },
    ])
  })

  it('agrega por día y origen todo lo pedido', async () => {
    const hoy = hoyCordoba()
    // Lead de Instagram cargado hoy, sin DNI
    await crearLead(db, { origen: 'instagram', telefono: '3515550001', estado_dni: null, dni: null, dni_intentos: 0, sendpulse_contact_id: null })
    // WhatsApp: titular aprobado en el primer intento
    const a = await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-a', '3515550002', 'A', '30000001', 'titular']))
    // WhatsApp: titular rechazado, familiar aprobado
    const b = await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-b', '3515550003', 'B', '30000002', 'titular']))
    await db.query(`UPDATE public.dni_eventos SET created_at = now() - INTERVAL '10 minutes' WHERE lead_id = $1`, [a.lead_id])
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [a.lead_id, 1, 'aprobado', null]))
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [b.lead_id, 1, 'rechazado', null]))
    await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-b', '3515550003', 'B', '20000002', 'familiar']))
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [b.lead_id, 2, 'aprobado', null]))
    // Una venta cerrada hoy
    await db.query(`UPDATE public.leads SET estado = 'venta_cerrada' WHERE id = $1`, [a.lead_id])

    const filas = await metricas(db, hoy, hoy)
    const wa = filas.find(f => f.origen === 'whatsapp')
    const ig = filas.find(f => f.origen === 'instagram')
    expect(ig).toMatchObject({ leads_nuevos: 1, dnis_enviados: 0 })
    expect(wa).toMatchObject({
      leads_nuevos: 2, dnis_enviados: 3, aprobados: 2, rechazados: 1,
      aprobados_primer_intento: 1, aprobados_con_familiar: 1, asignados: 2, ventas_cerradas: 1,
    })
    expect(wa.verificaciones_medidas).toBe(3)
    // El primer DNI esperó ~10 minutos
    expect(Number(wa.verificacion_segundos)).toBeGreaterThanOrEqual(600)
    expect(new Date(wa.dia).toISOString().slice(0, 10)).toBe(hoy)
  })

  it('cuenta por día de Córdoba, no de UTC', async () => {
    // 16/10 01:30 UTC = 15/10 22:30 en Córdoba
    await crearLead(db, { origen: 'presencial', telefono: '3515550009', estado_dni: null, dni: null, dni_intentos: 0, created_at: '2026-10-16T01:30:00Z' })
    const filas = await metricas(db, '2026-10-15', '2026-10-15')
    expect(sumar(filas, 'leads_nuevos')).toBe(1)
    expect(sumar(await metricas(db, '2026-10-16', '2026-10-16'), 'leads_nuevos')).toBe(0)
  })

  it('solo para admin y con un rango válido', async () => {
    await expect(metricas(db, '2026-10-01', '2026-10-15', U.vendedor1)).rejects.toThrow('SIN_PERMISO')
    await expect(metricas(db, '2026-10-15', '2026-10-01')).rejects.toThrow('RANGO_INVALIDO')
    await expect(metricas(db, '2024-01-01', '2026-10-15')).rejects.toThrow('RANGO_INVALIDO')
  })

  it('si registrar el evento falla, el lead se guarda igual', async () => {
    await db.exec('ALTER TABLE public.dni_eventos ADD CONSTRAINT falla_a_proposito CHECK (false) NOT VALID')
    const l = await crearLead(db)
    const r = await como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', null]))
    expect(r.ok).toBe(true)
    expect((await lead(db, l.id)).estado_dni).toBe('aprobado')
  })
})
