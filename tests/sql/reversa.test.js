// Plan de vuelta atrás: las reversas dejan la base como estaba (producción hoy) sin tocar los leads.
import { describe, it, expect } from 'vitest'
import { crearBase, comoServicio, como, rpc, crearLead, leerSql, U } from './helpers.js'

const tablas = async (db) => (await db.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map(r => r.table_name)
const columnas = async (db, tabla) => (await db.query(
  `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY 1`, [tabla])).rows.map(r => r.column_name)
const funcionesNuevas = async (db) => (await db.query(
  `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (proname LIKE 'dni\\_%' OR proname LIKE 'crm\\_%' OR proname LIKE 'lead\\_%' OR proname LIKE 'leads\\_%'
          OR proname IN ('metricas_dni', 'puede_verificar_dni', 'asignacion_siguiente_vendedor'))`)).rows.map(r => r.proname)

describe('reversas', () => {
  it('011 → 010 → 009 → 008 dejan el esquema como producción y los leads intactos', async () => {
    const db = await crearBase({ asignacion: true })
    const original = await crearBase()  // referencia para comparar columnas de producción
    for (const r of ['011_metricas_dni_reversa', '010_entrada_leads_reversa', '009_asignacion_round_robin_reversa', '008_cola_verificacion_dni_reversa']) {
      await original.exec(leerSql(`supabase/rollback/${r}.sql`))
    }

    await db.query('UPDATE public.profiles SET recibe_leads = true WHERE id = $1', [U.vendedor1])
    const l = await crearLead(db)
    await como(db, U.admin, () => rpc(db, 'dni_resolver', [l.id, 1, 'aprobado', 500000]))
    const antes = (await db.query('SELECT * FROM public.leads ORDER BY id')).rows

    for (const r of ['011_metricas_dni_reversa', '010_entrada_leads_reversa', '009_asignacion_round_robin_reversa', '008_cola_verificacion_dni_reversa']) {
      await db.exec(leerSql(`supabase/rollback/${r}.sql`))
    }

    expect(await tablas(db)).toEqual(['historial_cambios', 'interacciones', 'leads', 'profiles'])
    expect(await columnas(db, 'profiles')).toEqual(['created_at', 'dni', 'full_name', 'id', 'role'])
    expect(await columnas(db, 'leads')).toEqual(await columnas(original, 'leads'))
    expect(await columnas(db, 'leads')).not.toContain('reingreso_at')
    expect(await funcionesNuevas(db)).toEqual([])

    // Los datos del lead quedan como estaban (incluido lo que se resolvió y asignó mientras estuvo activo)
    const despues = (await db.query('SELECT * FROM public.leads ORDER BY id')).rows
    const sinReingreso = antes.map(({ reingreso_at, ...resto }) => resto)
    expect(despues).toEqual(sinReingreso)

    // Se pueden volver a aplicar
    for (const m of ['008_cola_verificacion_dni', '009_asignacion_round_robin', '010_entrada_leads', '011_metricas_dni']) {
      await db.exec(leerSql(`supabase/migrations/${m}.sql`))
    }
  })

  it('revertir solo 010 deja el webhook de WhatsApp funcionando con la versión de 008', async () => {
    const db = await crearBase()
    await db.exec(leerSql('supabase/rollback/011_metricas_dni_reversa.sql'))
    await db.exec(leerSql('supabase/rollback/010_entrada_leads_reversa.sql'))
    const r = await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-1', '3515551234', 'Ana', '30111222', 'titular']))
    expect(r).toMatchObject({ is_new: true, estado: 'creado' })
    expect(r).not.toHaveProperty('reingreso')
    const r2 = await comoServicio(db, () => rpc(db, 'dni_webhook_resultado', ['sp-1', null, 'aprobado', null]))
    expect(r2.estado).toBe('registrado')
  })
})
