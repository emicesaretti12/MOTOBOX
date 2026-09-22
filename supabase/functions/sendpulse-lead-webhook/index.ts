// Supabase Edge Function: sendpulse-lead-webhook
// Recibe leads capturados por el bot de SendPulse (Instagram/Facebook) desde
// una acción "Send HTTP request" del flujo, y los guarda en la tabla `leads`.
// Autenticación: header x-webhook-secret comparado contra SENDPULSE_WEBHOOK_SECRET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-webhook-secret, content-type',
}

function pick(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Método no permitido' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const expectedSecret = Deno.env.get('SENDPULSE_WEBHOOK_SECRET')
    const receivedSecret = req.headers.get('x-webhook-secret')

    if (!expectedSecret || receivedSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: 'No autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json().catch(() => ({}))

    const nombre = pick(body, ['nombre', 'name', 'full_name'])
    const telefono = pick(body, ['telefono', 'phone', 'whatsapp', 'phone_number'])
    const email = pick(body, ['email', 'mail'])
    const modeloInteres = pick(body, ['modelo_interes', 'producto', 'interest', 'model'])
    const campana = pick(body, ['campana', 'campaign', 'campaign_name', 'ad_name'])
    const notas = pick(body, ['notas', 'message', 'comentario'])

    if (!nombre || (!telefono && !email)) {
      return new Response(
        JSON.stringify({ error: 'Se requiere nombre y al menos teléfono o email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
        return new Response(
          JSON.stringify({ error: updateError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ message: 'Lead existente actualizado', lead_id: updated.id, is_new: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ message: 'Lead creado correctamente', lead_id: created.id, is_new: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
