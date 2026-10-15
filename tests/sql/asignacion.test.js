import { describe, it, expect, beforeEach } from 'vitest'
import { crearBase, como, comoServicio, rpc, crearLead, lead, historial, leerSql, U } from './helpers.js'

const vendedorDe = async (db, id) => (await lead(db, id)).vendedor_asignado
const aprobar = (db, l, operador = U.admin) => como(db, operador, () => rpc(db, 'dni_resolver', [l.id, l.dni_intentos, 'aprobado', 1000000]))

let telefono = 0
const nuevoLead = (db, campos = {}) => crearLead(db, { telefono: `54935120000${String(++telefono).padStart(2, '0')}`, ...campos })

describe('asignación automática por turnos', () => {
  let db
  beforeEach(async () => {
    db = await crearBase({ asignacion: true })
    await db.query('UPDATE public.profiles SET recibe_leads = true WHERE id IN ($1, $2)', [U.vendedor1, U.vendedor2])
  })

  it('la 009 se puede correr dos veces y arranca apagada', async () => {
    await db.exec(leerSql('supabase/migrations/009_asignacion_round_robin.sql'))
    const limpia = await crearBase()
    const { rows } = await limpia.query(`SELECT valor FROM public.crm_config WHERE clave = 'asignacion_automatica_activa'`)
    expect(rows[0].valor).toBe(false)
    const { rows: p } = await limpia.query('SELECT count(*)::int AS n FROM public.profiles WHERE recibe_leads')
    expect(p[0].n).toBe(0)
  })

  it('reparte por turnos solo entre vendedores activos', async () => {
    const asignados = []
    for (let i = 0; i < 4; i++) {
      const l = await nuevoLead(db)
      await aprobar(db, l)
      asignados.push(await vendedorDe(db, l.id))
    }
    expect(asignados).toEqual([U.vendedor1, U.vendedor2, U.vendedor1, U.vendedor2])
    // Ni el admin ni el empleado que no recibe leads entran en la rotación.
    expect(asignados).not.toContain(U.sinPermiso)
    expect(asignados).not.toContain(U.admin)
  })

  it('queda en el historial y en el registro de asignaciones', async () => {
    const l = await nuevoLead(db)
    await aprobar(db, l, U.vendedor2)
    const h = await historial(db, l.id)
    expect(h).toContainEqual({ campo: 'Asignación automática', valor_anterior: null, valor_nuevo: 'Vendedor 1 (por turno, DNI aprobado)', usuario_id: null })
    // El trigger de auditoría existente también anota el cambio de vendedor, a nombre de quien aprobó.
    expect(h).toContainEqual({ campo: 'Vendedor Asignado', valor_anterior: null, valor_nuevo: 'Vendedor 1', usuario_id: U.vendedor2 })
    const { rows } = await db.query('SELECT vendedor_id, motivo FROM public.asignaciones_lead WHERE lead_id = $1', [l.id])
    expect(rows).toEqual([{ vendedor_id: U.vendedor1, motivo: 'dni_aprobado' }])
  })

  it('si ya tiene vendedor, no lo cambia', async () => {
    const l = await nuevoLead(db, { vendedor_asignado: U.vendedor2 })
    await aprobar(db, l)
    expect(await vendedorDe(db, l.id)).toBe(U.vendedor2)
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.asignaciones_lead')
    expect(rows[0].n).toBe(0)
  })

  it('rechazado no asigna', async () => {
    const l = await nuevoLead(db)
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'rechazado', null]))
    expect(await vendedorDe(db, l.id)).toBeNull()
  })

  it('con el interruptor apagado no asigna', async () => {
    await db.query(`UPDATE public.crm_config SET valor = 'false' WHERE clave = 'asignacion_automatica_activa'`)
    const l = await nuevoLead(db)
    await aprobar(db, l)
    expect(await vendedorDe(db, l.id)).toBeNull()
  })

  it('sin vendedores activos la aprobación igual se guarda y el lead queda sin asignar', async () => {
    await db.query('UPDATE public.profiles SET recibe_leads = false')
    const l = await nuevoLead(db)
    const r = await aprobar(db, l)
    expect(r.ok).toBe(true)
    expect(await lead(db, l.id)).toMatchObject({ estado_dni: 'aprobado', vendedor_asignado: null })
  })

  it('si la asignación falla por cualquier motivo, la aprobación se guarda igual', async () => {
    // Simula una falla: el "siguiente vendedor" no existe (rompe la clave foránea).
    await db.exec(`CREATE OR REPLACE FUNCTION public.asignacion_siguiente_vendedor() RETURNS UUID LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000999'::uuid $$`)
    const l = await nuevoLead(db)
    const r = await aprobar(db, l)
    expect(r.ok).toBe(true)
    expect(await lead(db, l.id)).toMatchObject({ estado_dni: 'aprobado', vendedor_asignado: null })
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.asignaciones_lead')
    expect(rows[0].n).toBe(0)
  })

  it('también asigna cuando el resultado llega desde SendPulse', async () => {
    const l = await nuevoLead(db)
    await comoServicio(db, () => rpc(db, 'dni_webhook_resultado', ['sp-contacto-1', null, 'aprobado', null]))
    expect(await vendedorDe(db, l.id)).toBe(U.vendedor1)
  })

  it('un vendedor que se suma a la rotación recibe el próximo', async () => {
    await aprobar(db, await nuevoLead(db))
    await aprobar(db, await nuevoLead(db))
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', ['00000000-0000-0000-0000-0000000000b3'])
    await db.query(`INSERT INTO public.profiles (id, dni, full_name, role, recibe_leads) VALUES ($1, '30000009', 'Vendedor 3', 'empleado', true)`, ['00000000-0000-0000-0000-0000000000b3'])
    const l = await nuevoLead(db)
    await aprobar(db, l)
    expect(await vendedorDe(db, l.id)).toBe('00000000-0000-0000-0000-0000000000b3')
  })

  it('el vendedor ve el lead asignado y su registro; no ve los de otro', async () => {
    const l1 = await nuevoLead(db)
    const l2 = await nuevoLead(db)
    await aprobar(db, l1)
    await aprobar(db, l2)
    const visibles = await como(db, U.vendedor1, () => db.query('SELECT id FROM public.leads'))
    expect(visibles.rows.map(r => r.id)).toEqual([l1.id])
    const registro = await como(db, U.vendedor1, () => db.query('SELECT lead_id FROM public.asignaciones_lead'))
    expect(registro.rows.map(r => r.lead_id)).toEqual([l1.id])
  })

  it('editar otros campos de un lead aprobado no dispara la asignación', async () => {
    await db.query(`UPDATE public.crm_config SET valor = 'false' WHERE clave = 'asignacion_automatica_activa'`)
    const l = await nuevoLead(db)
    await aprobar(db, l)
    await db.query(`UPDATE public.crm_config SET valor = 'true' WHERE clave = 'asignacion_automatica_activa'`)
    await db.query(`UPDATE public.leads SET notas = 'cambio' WHERE id = $1`, [l.id])
    expect(await vendedorDe(db, l.id)).toBeNull()
  })
})
