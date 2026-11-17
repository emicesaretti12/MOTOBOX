// Reglas para mandar un mensaje desde el CRM. Funciones puras para testear con Vitest.

export const VENTANA_HORAS = 24
export const LARGO_MAXIMO = 1000

export type UltimoEntrante = { created_at: string } | null

// Meta solo deja escribir texto libre dentro de las 24 h desde el último mensaje del cliente.
export function ventanaAbierta(ultimo: UltimoEntrante, ahora: Date): boolean {
  if (!ultimo) return false
  return (ahora.getTime() - Date.parse(ultimo.created_at)) / 36e5 < VENTANA_HORAS
}

export function validarTexto(texto: unknown): string {
  const t = typeof texto === 'string' ? texto.trim() : ''
  if (!t) throw new Error('Escribí el mensaje')
  if (t.length > LARGO_MAXIMO) throw new Error(`El mensaje es muy largo (máximo ${LARGO_MAXIMO} caracteres)`)
  return t
}

export function canalDelLead(origen: string | null, canalUltimoEvento: string | null): 'whatsapp' | 'instagram' {
  if (canalUltimoEvento === 'instagram' || canalUltimoEvento === 'whatsapp') return canalUltimoEvento
  return origen === 'instagram' ? 'instagram' : 'whatsapp'
}
