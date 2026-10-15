// Supabase Edge Function: sendpulse-whatsapp-webhook
// Recibe eventos del bot de WhatsApp de SendPulse (flujo de verificación de DNI).
// Es una función NUEVA y separada: no reemplaza a sendpulse-lead-webhook (Instagram).
// Autenticación: header x-webhook-secret contra SENDPULSE_WEBHOOK_SECRET (mismo secreto).
//
// accion = "dni_recibido"  -> crea o actualiza el lead (origen whatsapp) con el DNI y estado_dni = pendiente
// accion = "resultado"     -> guarda el resultado de la verificación (aprobado | rechazado)

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
  return t === '' || t === '-' || t.startsWith('{{')
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
// Últimos 10 dígitos: característica + número, sin 54 ni 9 ni 0/15.
const claveTelefono = (s: string) => soloDigitos(s).slice(-10)

function ahoraAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
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

    const accion = pick(body, ['accion', 'action']) ?? 'dni_recibido'
    const contactId = pick(body, ['contact_id', 'sendpulse_contact_id'])
    const telefono = pick(body, ['telefono', 'phone', 'whatsapp'])

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Busca el lead más reciente por contact_id de SendPulse o por teléfono normalizado.
    async function buscarLead() {
      if (contactId) {
        const { data } = await db.from('leads').select('id, notas, dni_intentos, telefono')
          .eq('sendpulse_contact_id', contactId).order('created_at', { ascending: false }).limit(1)
        if (data && data.length) return data[0]
      }
      if (telefono) {
        const clave = claveTelefono(telefono)
        if (clave.length >= 8) {
          const { data } = await db.from('leads').select('id, notas, dni_intentos, telefono')
            .ilike('telefono', `%${clave.slice(-6)}%`).order('created_at', { ascending: false }).limit(50)
          const match = (data ?? []).find((l) => l.telefono && claveTelefono(l.telefono) === clave)
          if (match) return match
        }
      }
      return null
    }

    if (accion === 'resultado') {
      const resultado = (pick(body, ['resultado', 'estado_dni']) ?? '').toLowerCase()
      if (!['aprobado', 'rechazado'].includes(resultado)) {
        return json({ error: 'resultado debe ser aprobado o rechazado' }, 400)
      }
      const lead = await buscarLead()
      if (!lead) return json({ error: 'Lead no encontrado' }, 404)
      const montoTxt = pick(body, ['monto_aprobado', 'monto'])
      const monto = montoTxt ? Number(soloDigitos(montoTxt)) || null : null
      const nota = `[${ahoraAR()}] WhatsApp: DNI ${resultado}${monto ? ` (monto $${monto})` : ''}`
      const { error } = await db.from('leads').update({
        estado_dni: resultado,
        monto_aprobado: monto,
        dni_actualizado_at: new Date().toISOString(),
        notas: [lead.notas, nota].filter(Boolean).join('\n'),
      }).eq('id', lead.id)
      if (error) {
        console.error('Error guardando resultado', error)
        return json({ error: error.message }, 400)
      }
      return json({ message: 'Resultado guardado', lead_id: lead.id, estado_dni: resultado }, 200)
    }

    // accion = dni_recibido
    const nombre = pick(body, ['nombre', 'name', 'full_name'])
    const dni = soloDigitos(pick(body, ['dni', 'lead_dni']) ?? '')
    const relacion = pick(body, ['relacion', 'dni_titular_relacion']) ?? 'titular'

    if (!/^\d{7,8}$/.test(dni)) return json({ error: 'DNI inválido' }, 400)
    if (!telefono && !contactId) return json({ error: 'Se requiere teléfono o contact_id' }, 400)

    const lead = await buscarLead()
    const nota = `[${ahoraAR()}] WhatsApp: DNI ${dni} (${relacion}) enviado para verificar`

    if (lead) {
      const { error } = await db.from('leads').update({
        dni,
        estado_dni: 'pendiente',
        dni_titular_relacion: relacion,
        dni_intentos: (lead.dni_intentos ?? 0) + 1,
        sendpulse_contact_id: contactId ?? undefined,
        dni_actualizado_at: new Date().toISOString(),
        notas: [lead.notas, nota].filter(Boolean).join('\n'),
      }).eq('id', lead.id)
      if (error) {
        console.error('Error actualizando lead', error)
        return json({ error: error.message }, 400)
      }
      return json({ message: 'Lead existente actualizado', lead_id: lead.id, is_new: false }, 200)
    }

    const { data: creado, error } = await db.from('leads').insert({
      nombre: nombre ?? 'Sin nombre (WhatsApp)',
      telefono,
      origen: 'whatsapp',
      estado: 'nuevo',
      dni,
      estado_dni: 'pendiente',
      dni_titular_relacion: relacion,
      dni_intentos: 1,
      sendpulse_contact_id: contactId,
      dni_actualizado_at: new Date().toISOString(),
      notas: `Nuevo contacto vía WhatsApp (bot SendPulse)\n${nota}`,
    }).select('id').single()
    if (error) {
      console.error('Error creando lead', error)
      return json({ error: error.message }, 400)
    }
    return json({ message: 'Lead creado', lead_id: creado.id, is_new: true }, 200)
  } catch (err) {
    console.error('Error inesperado', err)
    return json({ error: 'Error interno del servidor' }, 500)
  }
})
