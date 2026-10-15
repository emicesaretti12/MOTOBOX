// Lógica de sendpulse-lead-webhook v8 (PROPUESTA: requiere OK antes de desplegar).
// Mismo contrato que v7 (mismos campos de entrada y respuestas). Cambios:
//   * Busca el lead existente por los últimos 10 dígitos del teléfono y, si no aparece, por email,
//     ignorando emails vacíos o de relleno (x@gmail.com). Nunca falla con duplicados
//     (v7 usaba maybeSingle(), que falla si hay más de uno y terminaba creando otro lead).
//   * Lee el origen real del payload (origen/canal/plataforma): instagram, facebook/messenger o whatsapp.
//     Si no viene, sigue siendo "instagram" como hoy.
//   * Si el lead estaba perdido y vuelve a escribir, pasa a nuevo y mantiene su vendedor
//     (solo con crm_config.reingreso_perdidos_activo prendido).
//   * Logs sin datos personales y comparación del secreto en tiempo constante.

type ErrorBase = { message: string; code?: string } | null
type Respuesta = { data: any; error: ErrorBase }

export interface Dependencias {
  secreto: string
  rpc: (funcion: string, args: Record<string, unknown>) => Promise<Respuesta>
  insertarLead: (datos: Record<string, unknown>) => Promise<Respuesta>
  actualizarLead: (id: string, cambios: Record<string, unknown>) => Promise<Respuesta>
  ahoraIso?: () => string
  log?: Pick<Console, 'error' | 'warn'>
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-webhook-secret, content-type',
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// SendPulse manda "" cuando una variable de contacto nunca se completó, y deja el {{placeholder}} si no existe.
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

export function secretoValido(recibido: string | null, esperado: string): boolean {
  if (!esperado || recibido === null) return false
  const a = new TextEncoder().encode(recibido)
  const b = new TextEncoder().encode(esperado)
  let diferencia = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diferencia |= (a[i] ?? 0) ^ b[i]
  return diferencia === 0
}

type Origen = 'instagram' | 'facebook' | 'whatsapp'
const ORIGENES: Record<string, Origen> = {
  instagram: 'instagram', ig: 'instagram',
  facebook: 'facebook', fb: 'facebook', messenger: 'facebook',
  whatsapp: 'whatsapp', wa: 'whatsapp',
}
const ETIQUETAS: Record<Origen, string> = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp' }

export function origenDelPayload(body: Record<string, unknown>): Origen {
  const valor = pick(body, ['origen', 'canal', 'plataforma', 'platform', 'channel', 'source'])?.toLowerCase()
  return (valor && ORIGENES[valor]) || 'instagram'
}

export async function handleRequest(req: Request, deps: Dependencias): Promise<Response> {
  const log = deps.log ?? console
  const ahoraIso = deps.ahoraIso ?? (() => new Date().toISOString())

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    if (!secretoValido(req.headers.get('x-webhook-secret'), deps.secreto)) {
      return json({ error: 'No autorizado' }, 401)
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body inválido: no es JSON válido' }, 400)
    }
    if (!body || typeof body !== 'object') return json({ error: 'Body inválido: no es JSON válido' }, 400)

    const nombre = pick(body, ['nombre', 'name', 'full_name'])
    const telefono = pick(body, ['telefono', 'phone', 'whatsapp', 'phone_number'])
    const email = pick(body, ['email', 'mail'])
    const modeloInteres = pick(body, ['modelo_interes', 'producto', 'interest', 'model'])
    const campana = pick(body, ['campana', 'campaign', 'campaign_name', 'ad_name'])
    const notas = pick(body, ['notas', 'message', 'comentario'])
    const origen = origenDelPayload(body)

    if (!nombre || (!telefono && !email)) {
      log.warn('Lead rechazado por datos incompletos', { tieneNombre: !!nombre, tieneTelefono: !!telefono, tieneEmail: !!email })
      return json({ error: 'Se requiere nombre y al menos teléfono o email' }, 400)
    }

    // Búsqueda segura. Si falla, se sigue como "no existe" (igual que v7): nunca se pierde un lead.
    const busqueda = await deps.rpc('lead_buscar_existente', { p_telefono: telefono ?? null, p_email: email ?? null })
    if (busqueda.error) log.error('No se pudo buscar el lead existente', busqueda.error.code ?? 'sin_codigo')
    const existente = busqueda.error ? null : busqueda.data as { id: string; notas: string | null; estado: string } | null

    const etiqueta = ETIQUETAS[origen]
    const campanaNota = campana ? `Campaña ${etiqueta}: ${campana}` : `Nuevo contacto vía ${etiqueta}`
    const notaCompleta = [campanaNota, notas].filter(Boolean).join(' — ')

    if (existente?.id) {
      const notasActualizadas = [existente.notas, `[${ahoraIso()}] ${notaCompleta}`].filter(Boolean).join('\n')
      const { error } = await deps.actualizarLead(existente.id, { notas: notasActualizadas, modelo_interes: modeloInteres })
      if (error) {
        log.error('Error actualizando lead', error.code ?? 'sin_codigo')
        return json({ error: 'No se pudo actualizar el lead' }, 400)
      }
      let reingreso = false
      if (existente.estado === 'perdido') {
        const r = await deps.rpc('lead_registrar_reingreso', { p_lead_id: existente.id, p_canal: etiqueta })
        if (r.error) log.error('No se pudo registrar el reingreso', r.error.code ?? 'sin_codigo')
        reingreso = r.data === true
      }
      return json({ message: 'Lead existente actualizado', lead_id: existente.id, is_new: false, reingreso }, 200)
    }

    const { data, error } = await deps.insertarLead({
      nombre,
      telefono,
      email,
      modelo_interes: modeloInteres,
      origen,
      estado: 'nuevo',
      notas: notaCompleta,
    })
    if (error) {
      log.error('Error creando lead', error.code ?? 'sin_codigo')
      return json({ error: 'No se pudo crear el lead' }, 400)
    }
    return json({ message: 'Lead creado correctamente', lead_id: data.id, is_new: true }, 200)
  } catch (e) {
    log.error('Error inesperado', e instanceof Error ? e.name : 'desconocido')
    return json({ error: 'Error interno del servidor' }, 500)
  }
}
