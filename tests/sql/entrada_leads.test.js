import { describe, it, expect, beforeEach } from 'vitest'
import { crearBase, comoServicio, rpc, crearLead, lead, historial, leerSql, U } from './helpers.js'

const sinDni = { estado_dni: null, dni: null, dni_intentos: 0, sendpulse_contact_id: null }
const prender = (db, clave) => db.query(`UPDATE public.crm_config SET valor = 'true' WHERE clave = $1`, [clave])

describe('entrada de leads (010)', () => {
  let db
  beforeEach(async () => { db = await crearBase() })

  it('se puede correr dos veces, crea el índice por teléfono y arranca con el reingreso apagado', async () => {
    await db.exec(leerSql('supabase/migrations/010_entrada_leads.sql'))
    const { rows: idx } = await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'leads_telefono_clave_idx'`)
    expect(idx[0].indexdef).toContain('crm_clave_telefono(telefono)')
    const { rows } = await db.query(`SELECT valor FROM public.crm_config WHERE clave = 'reingreso_perdidos_activo'`)
    expect(rows[0].valor).toBe(false)
  })

  it('emails vacíos, inválidos o de relleno no sirven para buscar', async () => {
    const util = async (e) => (await db.query('SELECT public.crm_email_util($1) AS r', [e])).rows[0].r
    expect(await util(null)).toBeNull()
    expect(await util('')).toBeNull()
    expect(await util(' X@Gmail.com ')).toBeNull()
    expect(await util('no-es-un-email')).toBeNull()
    expect(await util(' Juan.Perez@Mail.com ')).toBe('juan.perez@mail.com')
    await db.query(`UPDATE public.crm_config SET valor = '["x@gmail.com", "sin@email.com"]' WHERE clave = 'emails_relleno'`)
    expect(await util('sin@email.com')).toBeNull()
  })

  describe('búsqueda segura (Instagram)', () => {
    const buscar = (db, tel, email) => comoServicio(db, () => rpc(db, 'lead_buscar_existente', [tel, email]))

    it('encuentra por teléfono en cualquier formato y no falla con duplicados', async () => {
      await crearLead(db, { ...sinDni, nombre: 'Viejo', telefono: '0351 15 555-1234', created_at: '2026-08-01T00:00:00Z' })
      const reciente = await crearLead(db, { ...sinDni, nombre: 'Reciente', telefono: '+54 9 351 555 1234', created_at: '2026-10-01T00:00:00Z' })
      expect(await buscar(db, '3515551234', null)).toMatchObject({ id: reciente.id, estado: 'nuevo' })
    })

    it('si hay duplicados marcados, devuelve el principal', async () => {
      const principal = await crearLead(db, { ...sinDni, telefono: '3515551234', created_at: '2026-08-01T00:00:00Z' })
      const copia = await crearLead(db, { ...sinDni, telefono: '5493515551234', created_at: '2026-10-01T00:00:00Z' })
      await db.query('INSERT INTO public.leads_duplicados (lead_id, principal_id) VALUES ($1, $2)', [copia.id, principal.id])
      expect((await buscar(db, '3515551234', null)).id).toBe(principal.id)
    })

    it('por email solo si es real, sin importar mayúsculas', async () => {
      const conEmail = await crearLead(db, { ...sinDni, telefono: null, email: 'Ana@Mail.com' })
      await crearLead(db, { ...sinDni, telefono: null, email: 'x@gmail.com' })
      expect((await buscar(db, null, 'ana@mail.com')).id).toBe(conEmail.id)
      expect(await buscar(db, null, 'x@gmail.com')).toBeNull()
      expect(await buscar(db, null, '')).toBeNull()
    })
  })

  describe('leads perdidos que vuelven a escribir', () => {
    it('con el interruptor apagado no cambia nada', async () => {
      const l = await crearLead(db, { ...sinDni, estado: 'perdido', vendedor_asignado: U.vendedor1 })
      expect(await comoServicio(db, () => rpc(db, 'lead_registrar_reingreso', [l.id, 'Instagram']))).toBe(false)
      expect((await lead(db, l.id)).estado).toBe('perdido')
    })

    it('prendido: pasa a nuevo, mantiene el vendedor y queda registrado', async () => {
      await prender(db, 'reingreso_perdidos_activo')
      const l = await crearLead(db, { ...sinDni, estado: 'perdido', vendedor_asignado: U.vendedor1 })
      expect(await comoServicio(db, () => rpc(db, 'lead_registrar_reingreso', [l.id, 'Instagram']))).toBe(true)
      const despues = await lead(db, l.id)
      expect(despues).toMatchObject({ estado: 'nuevo', vendedor_asignado: U.vendedor1 })
      expect(despues.reingreso_at).not.toBeNull()
      expect(despues.notas).toMatch(/Volvió a escribir por Instagram \(estaba perdido\)/)
      const h = await historial(db, l.id)
      expect(h).toContainEqual({ campo: 'Volvió a escribir', valor_anterior: 'perdido', valor_nuevo: 'nuevo (por Instagram)', usuario_id: null })
      expect(h).toContainEqual({ campo: 'Estado', valor_anterior: 'perdido', valor_nuevo: 'nuevo', usuario_id: null })
      // Un lead que no está perdido no se toca
      expect(await comoServicio(db, () => rpc(db, 'lead_registrar_reingreso', [l.id, 'Instagram']))).toBe(false)
    })

    it('si un perdido manda su DNI por WhatsApp, vuelve a nuevo y queda pendiente de verificar', async () => {
      await prender(db, 'reingreso_perdidos_activo')
      const l = await crearLead(db, { ...sinDni, estado: 'perdido', telefono: '3515559999', vendedor_asignado: U.vendedor2 })
      const r = await comoServicio(db, () => rpc(db, 'dni_webhook_recibido', ['sp-9', '+5493515559999', 'X', '30111222', 'titular']))
      expect(r).toMatchObject({ lead_id: l.id, estado: 'actualizado', reingreso: true })
      expect(await lead(db, l.id)).toMatchObject({ estado: 'nuevo', estado_dni: 'pendiente', vendedor_asignado: U.vendedor2, dni_intentos: 1 })
    })
  })

  describe('propuesta de unificación de duplicados', () => {
    async function armar() {
      const ids = {}
      // Grupo A: contactado con vendedor + perdido sin vendedor -> sin revisión, principal = contactado
      ids.aPrincipal = (await crearLead(db, { ...sinDni, telefono: '3510000001', estado: 'contactado', vendedor_asignado: U.vendedor1, created_at: '2026-09-01T00:00:00Z' })).id
      ids.aCopia = (await crearLead(db, { ...sinDni, telefono: '+5493510000001', estado: 'perdido', created_at: '2026-08-01T00:00:00Z' })).id
      // Grupo B: vendedores distintos -> revisar a mano
      ids.b1 = (await crearLead(db, { ...sinDni, telefono: '3510000002', vendedor_asignado: U.vendedor1 })).id
      ids.b2 = (await crearLead(db, { ...sinDni, telefono: '03510000002', vendedor_asignado: U.vendedor2 })).id
      // Grupo C: una venta cerrada gana aunque sea más nueva
      ids.cVenta = (await crearLead(db, { ...sinDni, telefono: '3510000003', estado: 'venta_cerrada', created_at: '2026-10-01T00:00:00Z' })).id
      ids.cViejo = (await crearLead(db, { ...sinDni, telefono: '3510000003', estado: 'nuevo', created_at: '2026-08-01T00:00:00Z' })).id
      // Teléfono corto: no se agrupa
      await crearLead(db, { ...sinDni, telefono: '1234567' })
      await crearLead(db, { ...sinDni, telefono: '1234567' })
      return ids
    }

    it('elige el principal según la regla y marca los grupos dudosos', async () => {
      const ids = await armar()
      const { rows } = await db.query('SELECT lead_id, principal_id, es_principal, revisar_a_mano FROM public.leads_duplicados_propuesta()')
      const de = id => rows.find(r => r.lead_id === id)
      expect(rows).toHaveLength(6)
      expect(de(ids.aCopia)).toEqual({ lead_id: ids.aCopia, principal_id: ids.aPrincipal, es_principal: false, revisar_a_mano: false })
      expect(de(ids.aPrincipal).es_principal).toBe(true)
      expect(de(ids.b2).revisar_a_mano).toBe(true)
      expect(de(ids.b1).revisar_a_mano).toBe(true)
      expect(de(ids.cViejo)).toMatchObject({ principal_id: ids.cVenta, revisar_a_mano: false })
    })

    it('aplicar solo anota en leads_duplicados (los leads no cambian) y no repite', async () => {
      const ids = await armar()
      const antes = await db.query('SELECT id, updated_at, estado, notas FROM public.leads ORDER BY id')
      const aplicar = `INSERT INTO public.leads_duplicados (lead_id, principal_id, clave_telefono)
                       SELECT lead_id, principal_id, clave_telefono FROM public.leads_duplicados_propuesta()
                        WHERE NOT es_principal AND NOT revisar_a_mano ON CONFLICT (lead_id) DO NOTHING`
      await db.exec(aplicar)
      const { rows } = await db.query('SELECT lead_id FROM public.leads_duplicados ORDER BY lead_id')
      expect(rows.map(r => r.lead_id).sort()).toEqual([ids.aCopia, ids.cViejo].sort())
      expect((await db.query('SELECT id, updated_at, estado, notas FROM public.leads ORDER BY id')).rows).toEqual(antes.rows)
      // Volver a correrlo no agrega nada y los grupos resueltos ya no aparecen en la propuesta
      await db.exec(aplicar)
      expect((await db.query('SELECT count(*)::int AS n FROM public.leads_duplicados')).rows[0].n).toBe(2)
      const { rows: quedan } = await db.query('SELECT DISTINCT clave_telefono FROM public.leads_duplicados_propuesta()')
      expect(quedan.map(r => r.clave_telefono)).toEqual(['3510000002'])
    })
  })
})
