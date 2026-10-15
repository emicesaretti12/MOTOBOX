import { describe, it, expect, vi } from 'vitest'
import { handleRequest, origenDelPayload, type Dependencias } from '../../supabase/functions/sendpulse-lead-webhook/handler.ts'

function pedido(body: unknown, secreto = 's') {
  return new Request('https://x/sendpulse-lead-webhook', {
    method: 'POST',
    headers: { 'x-webhook-secret': secreto, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function deps({ existente = null as unknown, errorBusqueda = null as unknown, reingreso = true } = {}) {
  const log = { error: vi.fn(), warn: vi.fn() }
  const d: Dependencias = {
    secreto: 's',
    rpc: vi.fn(async (funcion: string) => {
      if (funcion === 'lead_buscar_existente') return { data: existente, error: errorBusqueda as never }
      if (funcion === 'lead_registrar_reingreso') return { data: reingreso, error: null }
      return { data: null, error: null }
    }),
    insertarLead: vi.fn(async () => ({ data: { id: 'nuevo-1' }, error: null })),
    actualizarLead: vi.fn(async () => ({ data: { id: 'L1' }, error: null })),
    ahoraIso: () => '2026-10-16T12:00:00.000Z',
    log,
  }
  return { d, log }
}

describe('Instagram v8 (propuesta)', () => {
  it('lead nuevo: igual que v7 cuando no se indica el origen', async () => {
    const { d } = deps()
    const res = await handleRequest(pedido({ nombre: 'Ana', telefono: '+54 9 351 555-1234', email: '', campana: 'Moto 110' }), d)
    expect(await res.json()).toEqual({ message: 'Lead creado correctamente', lead_id: 'nuevo-1', is_new: true })
    expect(d.rpc).toHaveBeenCalledWith('lead_buscar_existente', { p_telefono: '+54 9 351 555-1234', p_email: null })
    expect(d.insertarLead).toHaveBeenCalledWith({
      nombre: 'Ana', telefono: '+54 9 351 555-1234', email: undefined, modelo_interes: undefined,
      origen: 'instagram', estado: 'nuevo', notas: 'Campaña Instagram: Moto 110',
    })
  })

  it('lee el origen real del payload', async () => {
    expect(origenDelPayload({ origen: 'Facebook' })).toBe('facebook')
    expect(origenDelPayload({ canal: 'messenger' })).toBe('facebook')
    expect(origenDelPayload({ plataforma: 'WA' })).toBe('whatsapp')
    expect(origenDelPayload({ source: '{{source}}' })).toBe('instagram')
    expect(origenDelPayload({})).toBe('instagram')

    const { d } = deps()
    await handleRequest(pedido({ nombre: 'Ana', telefono: '3515551234', canal: 'facebook' }), d)
    expect(d.insertarLead).toHaveBeenCalledWith(expect.objectContaining({ origen: 'facebook', notas: 'Nuevo contacto vía Facebook' }))
  })

  it('lead existente: agrega la nota como v7 y no crea otro', async () => {
    const { d } = deps({ existente: { id: 'L1', notas: 'previa', estado: 'contactado' } })
    const res = await handleRequest(pedido({ nombre: 'Ana', telefono: '3515551234', notas: 'quiere la 150' }), d)
    expect(await res.json()).toEqual({ message: 'Lead existente actualizado', lead_id: 'L1', is_new: false, reingreso: false })
    expect(d.actualizarLead).toHaveBeenCalledWith('L1', {
      notas: 'previa\n[2026-10-16T12:00:00.000Z] Nuevo contacto vía Instagram — quiere la 150',
      modelo_interes: undefined,
    })
    expect(d.insertarLead).not.toHaveBeenCalled()
    expect(d.rpc).not.toHaveBeenCalledWith('lead_registrar_reingreso', expect.anything())
  })

  it('lead perdido que vuelve a escribir: pide el reingreso', async () => {
    const { d } = deps({ existente: { id: 'L1', notas: null, estado: 'perdido' } })
    const body = await (await handleRequest(pedido({ nombre: 'Ana', telefono: '3515551234' }), d)).json()
    expect(body.reingreso).toBe(true)
    expect(d.rpc).toHaveBeenCalledWith('lead_registrar_reingreso', { p_lead_id: 'L1', p_canal: 'Instagram' })
  })

  it('si la búsqueda falla, igual guarda el lead (como v7) y no loguea datos personales', async () => {
    const { d, log } = deps({ errorBusqueda: { message: 'falló 3515551234', code: '42883' } })
    const res = await handleRequest(pedido({ nombre: 'Ana', telefono: '3515551234' }), d)
    expect(res.status).toBe(200)
    expect(d.insertarLead).toHaveBeenCalled()
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('3515551234')
  })

  it('mantiene las validaciones de v7', async () => {
    const { d } = deps()
    expect((await handleRequest(pedido({ nombre: 'Ana' }, 'mal'), d)).status).toBe(401)
    const sinDatos = await handleRequest(pedido({ nombre: 'Ana' }), d)
    expect([sinDatos.status, await sinDatos.json()]).toEqual([400, { error: 'Se requiere nombre y al menos teléfono o email' }])
    expect((await handleRequest(pedido('no json'), d)).status).toBe(400)
    expect(d.rpc).not.toHaveBeenCalled()
  })
})
