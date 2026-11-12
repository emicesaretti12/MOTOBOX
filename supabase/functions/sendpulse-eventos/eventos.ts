// Traduce los eventos del webhook de SendPulse a filas de agente_eventos. Funciones puras (sin red).

export type Evento = {
  canal: string | null
  tipo: string
  autor: string | null
  contact_id: string | null
  telefono: string | null
  nombre: string | null
  texto: string | null
}

const soloDigitos = (s: string) => s.replace(/\D/g, '')
export const claveTelefono = (s: string) => soloDigitos(s).slice(-10)

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

// Busca el primer texto legible del mensaje sin depender de una estructura exacta,
// porque SendPulse arma el payload distinto según el canal y el tipo de mensaje.
const CLAVES_TEXTO = ['text', 'body', 'caption', 'title', 'payload']
export function textoDe(nodo: unknown, profundidad = 0): string | null {
  if (profundidad > 7 || nodo == null) return null
  if (typeof nodo === 'string') return null
  if (Array.isArray(nodo)) {
    for (const x of nodo) { const t = textoDe(x, profundidad + 1); if (t) return t }
    return null
  }
  if (typeof nodo === 'object') {
    const o = nodo as Record<string, unknown>
    for (const k of CLAVES_TEXTO) {
      const v = o[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (v && typeof v === 'object') { const t = textoDe(v, profundidad + 1); if (t) return t }
    }
    for (const [k, v] of Object.entries(o)) {
      if (CLAVES_TEXTO.includes(k) || k === 'contact' || k === 'bot') continue
      const t = textoDe(v, profundidad + 1)
      if (t) return t
    }
  }
  return null
}

// Tipo de adjunto cuando no hay texto (audio, imagen, etc.).
function adjuntoDe(info: unknown): string | null {
  const s = JSON.stringify(info ?? {}).toLowerCase()
  for (const [clave, nombre] of [['audio', 'Audio'], ['voice', 'Audio'], ['image', 'Imagen'], ['video', 'Video'], ['document', 'Documento'], ['sticker', 'Sticker'], ['location', 'Ubicación']]) {
    if (s.includes(`"${clave}"`) || s.includes(`"type":"${clave}"`)) return `[${nombre}]`
  }
  return null
}

// Señales de que un mensaje saliente lo mandó una persona desde el chat y no el bot.
function esHumano(ev: Record<string, unknown>): boolean {
  const s = JSON.stringify(ev.info ?? {}).toLowerCase()
  return /"(manual|operator|user_id|sent_by_user|from_operator)"\s*:\s*(true|"?[a-z0-9-]{3,})/.test(s) && !/"bot"\s*:\s*true/.test(s)
}

export function normalizar(ev: Record<string, unknown>): Evento {
  const titulo = String(ev.title ?? ev.event ?? ev.type ?? '').toLowerCase()
  const contacto = (ev.contact ?? {}) as Record<string, unknown>
  const bot = (ev.bot ?? {}) as Record<string, unknown>
  const servicio = String(ev.service ?? bot.channel ?? bot.service ?? '').toLowerCase()
  const canal = servicio.includes('whatsapp') ? 'whatsapp' : servicio.includes('instagram') ? 'instagram' : (servicio || null)

  let tipo = 'otro'
  let autor: string | null = 'sistema'
  if (titulo.includes('incoming')) { tipo = 'mensaje_entrante'; autor = 'cliente' }
  else if (titulo.includes('outgoing')) { tipo = 'mensaje_saliente'; autor = esHumano(ev) ? 'humano' : 'agente' }
  else if (titulo.includes('flow') || titulo.includes('chain')) tipo = 'flujo'

  let texto = textoDe(ev.info) ?? (tipo.startsWith('mensaje') ? adjuntoDe(ev.info) : null)
  if (tipo === 'flujo') texto = `Flujo: ${str((ev.info as Record<string, unknown>)?.flow_name) ?? str((ev.info as Record<string, unknown>)?.name) ?? texto ?? titulo}`
  if (tipo === 'otro') texto = texto ? `${titulo}: ${texto}` : titulo || null
  if (texto && texto.length > 4000) texto = texto.slice(0, 4000) + '…'

  return {
    canal,
    tipo,
    autor,
    contact_id: str(contacto.id),
    telefono: str(contacto.phone),
    nombre: str(contacto.name) ?? str(contacto.username),
    texto,
  }
}

export function eventosDelBody(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (body && typeof body === 'object') return [body as Record<string, unknown>]
  return []
}
