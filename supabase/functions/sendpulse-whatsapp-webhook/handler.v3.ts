// ARCHIVO: propuesta v3, NO desplegada. Quedó superada por la v4 que se desplegó en paralelo (index.ts).
// Se conserva por sus reglas (no sumar intento por el mismo DNI, no volver a pendiente un aprobado,
// DNI enmascarado en notas) para portarlas a la v4 más adelante. Sus tests siguen corriendo.

// Lógica del webhook de WhatsApp (v3), separada del arranque de Deno para poder testearla.
// Mismo contrato que v2 (mismos campos de entrada, mismas respuestas), con estos cambios:
//   * La búsqueda y la escritura del lead se hacen en una sola transacción en la base
//     (funciones dni_webhook_recibido / dni_webhook_resultado): sin duplicados si SendPulse repite la llamada.
//   * resultado: si el CRM ya registró ese resultado no hace nada (evita el doble registro y no borra el monto);
//     si informa lo contrario, no pisa nada y deja una nota.
//   * dni_recibido: el mismo DNI pendiente no suma otro intento; un lead aprobado no vuelve a pendiente.
//   * Notas con el DNI enmascarado (***123) y logs sin datos personales.

type ErrorBase = { message: string; code?: string } | null
type RespuestaRpc = { data: any; error: ErrorBase }

export interface Dependencias {
  secreto: string
  rpc: (funcion: string, args: Record<string, unknown>) => Promise<RespuestaRpc>
  log?: Pick<Console, 'error' | 'warn'>
}

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

// SendPulse manda "" o "-" cuando una variable no se completó, y deja el {{placeholder}} si no existe.
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

// Comparación en tiempo constante para no filtrar el secreto por tiempos de respuesta.
export function secretoValido(recibido: string | null, esperado: string): boolean {
  if (!esperado || recibido === null) return false
  const a = new TextEncoder().encode(recibido)
  const b = new TextEncoder().encode(esperado)
  let diferencia = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diferencia |= (a[i] ?? 0) ^ b[i]
  return diferencia === 0
}

export async function handleRequest(req: Request, deps: Dependencias): Promise<Response> {
  const log = deps.log ?? console
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

    const accion = pick(body, ['accion', 'action']) ?? 'dni_recibido'
    const contactId = pick(body, ['contact_id', 'sendpulse_contact_id']) ?? null
    const telefono = pick(body, ['telefono', 'phone', 'whatsapp']) ?? null

    if (accion === 'resultado') {
      const resultado = (pick(body, ['resultado', 'estado_dni']) ?? '').toLowerCase()
      if (!['aprobado', 'rechazado'].includes(resultado)) {
        return json({ error: 'resultado debe ser aprobado o rechazado' }, 400)
      }
      const montoTxt = pick(body, ['monto_aprobado', 'monto'])
      const monto = montoTxt ? Number(soloDigitos(montoTxt)) || null : null

      const { data, error } = await deps.rpc('dni_webhook_resultado', {
        p_contact_id: contactId,
        p_telefono: telefono,
        p_resultado: resultado,
        p_monto: monto,
      })
      if (error) {
        log.error('Error guardando resultado', error.code ?? 'sin_codigo')
        return json({ error: 'Error interno del servidor' }, 500)
      }
      if (data?.estado === 'no_encontrado') return json({ error: 'Lead no encontrado' }, 404)
      const mensajes: Record<string, string> = {
        registrado: 'Resultado guardado',
        ya_registrado: 'Resultado ya registrado',
        conflicto: 'El CRM tiene otro resultado: no se cambió nada',
      }
      return json({ message: mensajes[data?.estado] ?? 'Resultado procesado', lead_id: data?.lead_id, estado_dni: data?.estado_dni, estado: data?.estado }, 200)
    }

    // accion = dni_recibido
    const nombre = pick(body, ['nombre', 'name', 'full_name']) ?? null
    const dni = soloDigitos(pick(body, ['dni', 'lead_dni']) ?? '')
    const relacion = pick(body, ['relacion', 'dni_titular_relacion']) ?? 'titular'

    if (!/^\d{7,8}$/.test(dni)) return json({ error: 'DNI inválido' }, 400)
    if (!telefono && !contactId) return json({ error: 'Se requiere teléfono o contact_id' }, 400)

    const { data, error } = await deps.rpc('dni_webhook_recibido', {
      p_contact_id: contactId,
      p_telefono: telefono,
      p_nombre: nombre,
      p_dni: dni,
      p_relacion: relacion,
    })
    if (error) {
      log.error('Error guardando DNI recibido', error.code ?? 'sin_codigo')
      return json({ error: 'Error interno del servidor' }, 500)
    }
    if (data?.is_new) return json({ message: 'Lead creado', lead_id: data.lead_id, is_new: true }, 200)
    return json({ message: 'Lead existente actualizado', lead_id: data?.lead_id, is_new: false, estado: data?.estado }, 200)
  } catch (e) {
    log.error('Error inesperado', e instanceof Error ? e.name : 'desconocido')
    return json({ error: 'Error interno del servidor' }, 500)
  }
}
