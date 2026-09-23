// Supabase Edge Function: sendpulse-lead-webhook
// Recibe leads capturados por el bot de SendPulse (Instagram/Facebook) desde
// un nodo "Solicitud API" del flujo, y los guarda en la tabla `leads`.
// Autenticación: header x-webhook-secret comparado contra SENDPULSE_WEBHOOK_SECRET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-webhook-secret, content-type',
}

// SendPulse manda "" cuando una variable de contacto nunca se completó, y deja
// el {{placeholder}} literal si la variable no existe.
function esValorInvalido(texto: string): boolean {
  return texto === '' || texto === '-' || texto.startsWith('{{')
}

function pick(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string') {
      const texto = value.trim()
      if (!esValorInvalido(texto)) return texto
    }
  }
  return undefined
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido' }, 405)
  }

  try {
    const expectedSecret = Deno.env.get('SENDPULSE_WEBHOOK_SECRET')
    const receivedSecret = req.headers.get('x-webhook-secret')

    if (!expectedSecret || receivedSecret !== expectedSecret) {
      return json({ error: 'No autorizado' }, 401)
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body inválido: no es JSON válido' }, 400)
    }

    const nombre = pick(body, ['nombre', 'name', 'full_name'])
    const telefono = pick(body, ['telefono', 'phone', 'whatsapp', 'phone_number'])
    const email = pick(body, ['email', 'mail'])
    const modeloInteres = pick(body, ['modelo_interes', 'producto', 'interest', 'model'])
    const campana = pick(body, ['campana', 'campaign', 'campaign_name', 'ad_name'])
    const notas = pick(body, ['notas', 'message', 'comentario'])

    if (!nombre || (!telefono && !email)) {
      console.warn('Lead rechazado por datos incompletos', {
        tieneNombre: !!nombre,
        tieneTelefono: !!telefono,
        tieneEmail: !!email,
      })
      return json({ error: 'Se requiere nombre y al menos teléfono o email' }, 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Buscar lead existente por teléfono o email para no duplicar
    let existingLead = null
    if (telefono) {
      const { data } = await supabaseAdmin.from('leads').select('id, notas').eq('telefono', telefono).maybeSingle()
      existingLead = data
    }
    if (!existingLead && email) {
      const { data } = await supabaseAdmin.from('leads').select('id, notas').eq('email', email).maybeSingle()
      existingLead = data
    }

    const campanaNota = campana ? `Campaña Instagram: ${campana}` : 'Nuevo contacto vía Instagram'
    const notaCompleta = [campanaNota, notas].filter(Boolean).join(' — ')

    if (existingLead) {
      const notasActualizadas = [existingLead.notas, `[${new Date().toISOString()}] ${notaCompleta}`]
        .filter(Boolean)
        .join('\n')

      const { data: updated, error: updateError } = await supabaseAdmin
        .from('leads')
        .update({ notas: notasActualizadas, modelo_interes: modeloInteres })
        .eq('id', existingLead.id)
        .select('id')
        .single()

      if (updateError) {
        console.error('Error updating lead:', updateError)
        return json({ error: updateError.message }, 400)
      }

      return json({ message: 'Lead existente actualizado', lead_id: updated.id, is_new: false }, 200)
    }

    const { data: created, error: insertError } = await supabaseAdmin
      .from('leads')
      .insert({
        nombre,
        telefono,
        email,
        modelo_interes: modeloInteres,
        origen: 'instagram',
        estado: 'nuevo',
        notas: notaCompleta,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Error creating lead:', insertError)
      return json({ error: insertError.message }, 400)
    }

    return json({ message: 'Lead creado correctamente', lead_id: created.id, is_new: true }, 200)
  } catch (err) {
    console.error('Unexpected error:', err)
    return json({ error: 'Error interno del servidor' }, 500)
  }
})
