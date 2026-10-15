// Base de datos de prueba en memoria (PGlite = Postgres 17 real dentro de Node).
// Carga: imitación de Supabase + esquema real de producción + la migración 008.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const leerSql = (rel) => readFileSync(path.join(raiz, rel), 'utf8')

export const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  vendedor1: '00000000-0000-0000-0000-0000000000b1',
  vendedor2: '00000000-0000-0000-0000-0000000000b2',
  sinPermiso: '00000000-0000-0000-0000-0000000000c1',
}

export async function crearBase({ cola = true, aviso = true } = {}) {
  const db = new PGlite()
  await db.exec(leerSql('tests/sql/fixtures/supabase_stub.sql'))
  await db.exec(leerSql('tests/sql/fixtures/esquema_produccion.sql'))
  await db.exec(leerSql('supabase/migrations/008_cola_verificacion_dni.sql'))

  const perfiles = [
    [U.admin, '20000001', 'Admin Uno', 'admin', false],
    [U.vendedor1, '30000001', 'Vendedor 1', 'empleado', true],
    [U.vendedor2, '30000002', 'Vendedor 2', 'empleado', true],
    [U.sinPermiso, '30000003', 'Empleado Sin Permiso', 'empleado', false],
  ]
  for (const [id, dni, nombre, rol, verifica] of perfiles) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
    await db.query(
      'INSERT INTO public.profiles (id, dni, full_name, role, verifica_dni) VALUES ($1, $2, $3, $4, $5)',
      [id, dni, nombre, rol, verifica]
    )
  }
  await db.query(`UPDATE public.crm_config SET valor = $1::jsonb WHERE clave = 'cola_dni_activa'`, [JSON.stringify(cola)])
  await db.query(`UPDATE public.crm_config SET valor = $1::jsonb WHERE clave = 'aviso_sendpulse_activo'`, [JSON.stringify(aviso)])
  return db
}

async function conRol(db, rol, uid, fn) {
  await db.exec(`SET ROLE ${rol}`)
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  try {
    return await fn()
  } finally {
    await db.exec('RESET ROLE')
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`)
  }
}

// Ejecuta como un usuario logueado del CRM (rol authenticated + JWT con su id).
export const como = (db, uid, fn) => conRol(db, 'authenticated', uid, fn)
// Ejecuta como las edge functions (clave de servicio, sin usuario).
export const comoServicio = (db, fn) => conRol(db, 'service_role', null, fn)
export const comoAnonimo = (db, fn) => conRol(db, 'anon', null, fn)

// Llama a una función que devuelve un único valor (jsonb, boolean...).
export async function rpc(db, funcion, args = []) {
  const marcas = args.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await db.query(`SELECT public.${funcion}(${marcas}) AS r`, args)
  return rows[0].r
}

export async function crearLead(db, campos = {}) {
  const base = {
    nombre: 'Cliente Prueba',
    telefono: '5493510000001',
    origen: 'whatsapp',
    estado: 'nuevo',
    dni: '30111222',
    estado_dni: 'pendiente',
    dni_titular_relacion: 'titular',
    dni_intentos: 1,
    sendpulse_contact_id: 'sp-contacto-1',
    dni_actualizado_at: new Date().toISOString(),
    notas: null,
    ...campos,
  }
  const columnas = Object.keys(base)
  const { rows } = await db.query(
    `INSERT INTO public.leads (${columnas.join(', ')}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(base)
  )
  return rows[0]
}

export async function lead(db, id) {
  const { rows } = await db.query('SELECT * FROM public.leads WHERE id = $1', [id])
  return rows[0]
}

export async function historial(db, leadId) {
  const { rows } = await db.query(
    'SELECT campo, valor_anterior, valor_nuevo, usuario_id FROM public.historial_cambios WHERE lead_id = $1 ORDER BY created_at, campo',
    [leadId]
  )
  return rows
}
