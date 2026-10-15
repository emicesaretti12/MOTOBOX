// Supabase Edge Function: sendpulse-whatsapp-webhook (v4)
// Recibe eventos de los bots de SendPulse (WhatsApp e Instagram) para el flujo de calificación.
// Función separada: NO reemplaza a sendpulse-lead-webhook (Instagram viejo).
// Autenticación: header x-webhook-secret contra SENDPULSE_WEBHOOK_SECRET.
//
// accion:
//   lead_calificado | dni_recibido | financia | contado -> crea/actualiza lead (forma de pago, DNI, anticipo, modelo, usada)
//   resultado                                         -> guarda aprobado | rechazado
//   derivar | asesor                                  -> el cliente pidió hablar con una persona (prioridad alta)
//   baja                                              -> el cliente dijo que no le interesa

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-webhook-secret, content-type',
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function esValorInvalido(t: string) {
  const x = t.trim().toLowerCase()
  return x === '' || x === '-' || x.startsWith('{{') || x === 'null' || x === 'undefined' || x === 'no' || x === 'ninguna' || x === 'n/a'
}

function pick(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = body[k]
    if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).trim()
      if (!esValorInvalido(t)) return t
    }
  }
  return undefined
}

const soloDigitos = (s: string) => s.replace(/\D/g, '')
const claveTelefono = (s: string) => soloDigitos(s).slice(-10)

function ahoraAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
}

function normalizarFormaPago(t?: string): 'cuotas' | 'anticipo_cuotas' | 'contado' | undefined {
  if (!t) return undefined
  const x = t.toLowerCase()
  if (x.includes('anticipo') || x.includes('parte') || x.includes('entrega') || x.includes('mitad')) return 'anticipo_cuotas'
  if (x.includes('contado') || x.includes('efectivo') || x.includes('cash') || x.includes('total')) return 'contado'
  if (x.includes('cuota') || x.includes('financ') || x.includes('credito') || x.includes('crédito') || x.includes('dni')) return 'cuotas'
  return undefined
}

function normalizarOrigen(t?: string): 'whatsapp' | 'instagram' | 'facebook' {
  const x = (t ?? '').toLowerCase()
  if (x.includes('insta')) return 'instagram'
  if (x.includes('face') || x.includes('messenger')) return 'facebook'
  return 'whatsapp'
}

const etiquetaForma: Record<string, string> = {
  cuotas: 'cuotas con DNI',
  anticipo_cuotas: 'anticipo + cuotas',
  contado: 'CONTADO',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const expected = Deno.env.get('SENDPULSE_WEBHOOK_SECRET')
    if (!expected || req.headers.get('x-webhook-secret') !== expected) {
      return json({ error: 'No autorizado' }, 401)
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body inválido: no es JSON válido' }, 400)
    }

    let accion = (pick(body, ['accion', 'action']) ?? 'lead_calificado').toLowerCase()
    let formaForzada: 'contado' | undefined
    if (accion === 'dni_recibido' || accion === 'financia') accion = 'lead_calificado'
    if (accion === 'contado') { accion = 'lead_calificado'; formaForzada = 'contado' }
    if (accion === 'asesor') accion = 'derivar'

    const contactId = pick(body, ['contact_id', 'sendpulse_contact_id'])
    const telefono = pick(body, ['telefono', 'phone', 'whatsapp'])
    const origen = normalizarOrigen(pick(body, ['origen', 'canal', 'channel']))
    const nombre = pick(body, ['nombre', 'name', 'full_name'])
    const detalleCanal = pick(body, ['detalle_canal', 'campana', 'campaign'])

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    async function buscarLead() {
      const cols = 'id, notas, dni_intentos, telefono, estado'
      if (contactId) {
        const { data } = await db.from('leads').select(cols)
          .eq('sendpulse_contact_id', contactId).order('created_at', { ascending: false }).limit(1)
        if (data && data.length) return data[0]
      }
      if (telefono) {
        const clave = claveTelefono(telefono)
        if (clave.length >= 8) {
          const { data } = await db.from('leads').select(cols)
            .ilike('telefono', `%${clave.slice(-6)}%`).order('created_at', { ascending: false }).limit(50)
          const match = (data ?? []).find((l) => l.telefono && claveTelefono(l.telefono) === clave)
          if (match) return match
        }
      }
      return null
    }

    const agregarNota = (notas: string | null, nota: string) => [notas, `[${ahoraAR()}] ${nota}`].filter(Boolean).join('\n')

    // ---------- resultado de la verificación ----------
    if (accion === 'resultado') {
      const resultado = (pick(body, ['resultado', 'estado_dni']) ?? '').toLowerCase()
      if (!['aprobado', 'rechazado'].includes(resultado)) {
        return json({ error: 'resultado debe ser aprobado o rechazado' }, 400)
      }
      const lead = await buscarLead()
      if (!lead) return json({ error: 'Lead no encontrado' }, 404)
      const montoTxt = pick(body, ['monto_aprobado', 'monto'])
      const monto = montoTxt ? Number(soloDigitos(montoTxt)) || null : null
      const { error } = await db.from('leads').update({
        estado_dni: resultado,
        monto_aprobado: monto,
        prioridad: resultado === 'aprobado' ? 'alta' : undefined,
        dni_actualizado_at: new Date().toISOString(),
        notas: agregarNota(lead.notas, `Bot: DNI ${resultado}${monto ? ` (monto $${monto})` : ''}`),
      }).eq('id', lead.id)
      if (error) return json({ error: error.message }, 400)
      return json({ message: 'Resultado guardado', lead_id: lead.id, estado_dni: resultado }, 200)
    }

    // ---------- derivar a una persona / baja ----------
    if (accion === 'derivar' || accion === 'baja') {
      const motivo = pick(body, ['motivo', 'mensaje', 'notas']) ?? ''
      const lead = await buscarLead()
      const nota = accion === 'derivar'
        ? `Bot: el cliente pidió hablar con un asesor${motivo ? ` (${motivo})` : ''}`
        : `Bot: el cliente dijo que no le interesa${motivo ? ` (${motivo})` : ''}`
      if (lead) {
        const { error } = await db.from('leads').update({
          prioridad: accion === 'derivar' ? 'alta' : 'baja',
          notas: agregarNota(lead.notas, nota),
          sendpulse_contact_id: contactId ?? undefined,
        }).eq('id', lead.id)
        if (error) return json({ error: error.message }, 400)
        return json({ message: 'Lead actualizado', lead_id: lead.id }, 200)
      }
      if (accion === 'baja') return json({ message: 'Sin lead previo, nada que hacer' }, 200)
      if (!telefono && !contactId) return json({ error: 'Se requiere teléfono o contact_id' }, 400)
      const { data: creado, error } = await db.from('leads').insert({
        nombre: nombre ?? `Sin nombre (${origen})`,
        telefono,
        origen,
        estado: 'nuevo',
        prioridad: 'alta',
        sendpulse_contact_id: contactId,
        notas: `Nuevo contacto vía ${origen} (bot SendPulse)\n[${ahoraAR()}] ${nota}`,
      }).select('id').single()
      if (error) return json({ error: error.message }, 400)
      return json({ message: 'Lead creado', lead_id: creado.id, is_new: true }, 200)
    }

    // ---------- lead calificado ----------
    const dniRaw = pick(body, ['dni', 'lead_dni'])
    const formaPago = formaForzada ?? normalizarFormaPago(pick(body, ['forma_pago', 'pago'])) ?? (dniRaw ? 'cuotas' : undefined)
    const dniDigitos = dniRaw ? soloDigitos(dniRaw) : undefined
    const dniValido = !!dniDigitos && /^\d{7,8}$/.test(dniDigitos)
    const relacion = pick(body, ['relacion', 'dni_titular_relacion']) ?? 'titular'
    const anticipo = pick(body, ['anticipo', 'lead_anticipo'])
    const modelo = pick(body, ['modelo', 'modelo_interes', 'lead_modelo'])
    const usada = pick(body, ['usada', 'usada_detalle', 'lead_usada'])

    if (!telefono && !contactId) return json({ error: 'Se requiere teléfono o contact_id' }, 400)
    const financia = formaPago !== 'contado'
    // Si financia pero el DNI no es válido, NO se pierde el lead: se guarda con alerta para revisión humana.
    const alertaDni = financia && !dniValido

    const partes = [
      `Bot ${origen}: forma de pago ${etiquetaForma[formaPago ?? 'cuotas']}`,
      dniValido ? `DNI ${dniDigitos} (${relacion}) para verificar` : null,
      alertaDni ? `ATENCIÓN: DNI no válido o faltante (${dniRaw ?? 'vacío'}), pedirlo de nuevo` : null,
      anticipo ? `anticipo ${anticipo}` : null,
      modelo ? `modelo ${modelo}` : null,
      usada ? `entrega usada: ${usada}` : null,
      detalleCanal ? `vía ${detalleCanal}` : null,
    ].filter(Boolean)
    const nota = partes.join(' — ')

    const campos: Record<string, unknown> = {
      forma_pago: formaPago ?? null,
      prioridad: formaPago === 'contado' || alertaDni ? 'alta' : 'media',
      sendpulse_contact_id: contactId ?? undefined,
    }
    if (anticipo) campos.anticipo = anticipo
    if (modelo) campos.modelo_interes = modelo
    if (usada) campos.usada_detalle = usada
    if (dniValido) {
      campos.dni = dniDigitos
      campos.estado_dni = 'pendiente'
      campos.dni_titular_relacion = relacion
      campos.dni_actualizado_at = new Date().toISOString()
    }

    const lead = await buscarLead()
    if (lead) {
      if (dniValido) campos.dni_intentos = (lead.dni_intentos ?? 0) + 1
      if (lead.estado === 'perdido') campos.estado = 'nuevo'
      campos.notas = agregarNota(lead.notas, nota + (lead.estado === 'perdido' ? ' — REACTIVADO (estaba perdido)' : ''))
      const { error } = await db.from('leads').update(campos).eq('id', lead.id)
      if (error) {
        console.error('Error actualizando lead', error)
        return json({ error: error.message }, 400)
      }
      return json({ message: 'Lead existente actualizado', lead_id: lead.id, is_new: false, alerta_dni: alertaDni }, 200)
    }

    const { data: creado, error } = await db.from('leads').insert({
      ...campos,
      nombre: nombre ?? `Sin nombre (${origen})`,
      telefono,
      origen,
      estado: 'nuevo',
      dni_intentos: dniValido ? 1 : 0,
      notas: `Nuevo contacto vía ${origen} (bot SendPulse)\n[${ahoraAR()}] ${nota}`,
    }).select('id').single()
    if (error) {
      console.error('Error creando lead', error)
      return json({ error: error.message }, 400)
    }
    return json({ message: 'Lead creado', lead_id: creado.id, is_new: true, alerta_dni: alertaDni }, 200)
  } catch (err) {
    console.error('Error inesperado', err)
    return json({ error: 'Error interno del servidor' }, 500)
  }
})
