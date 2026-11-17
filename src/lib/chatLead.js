// Ventana de 24 h de WhatsApp/Instagram: solo se puede escribir texto libre si el cliente escribió en las últimas 24 h.

export function estadoVentana(eventos, ahora = new Date()) {
  const ultimo = [...(eventos ?? [])].reverse().find((e) => e.tipo === 'mensaje_entrante')
  if (!ultimo) return { abierta: true, texto: 'Sin mensajes del cliente registrados' }
  const horas = (ahora - new Date(ultimo.created_at)) / 36e5
  if (horas >= 24) return { abierta: false, texto: 'Cerrado: más de 24 h sin mensajes del cliente' }
  const quedan = Math.max(0, 24 - horas)
  return { abierta: true, texto: quedan >= 1 ? `Podés escribirle ${Math.floor(quedan)} h más` : `Podés escribirle ${Math.round(quedan * 60)} min más` }
}
