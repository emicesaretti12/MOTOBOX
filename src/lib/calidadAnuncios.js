// Orden y formato de la tabla "Calidad por anuncio".

export function porcentaje(parte, total) {
  if (!total) return ''
  return `${Math.round((parte / total) * 100)}%`
}

// Primero los que más venden; después los que más leads listos para comprar traen en proporción
// (con al menos 5 conversaciones para que un anuncio con 1 de 1 no quede arriba de todo).
export function ordenarPorCalidad(filas) {
  const tasa = (f) => (f.conversaciones >= 5 ? f.listos_para_comprar / f.conversaciones : -1)
  return [...filas].sort((a, b) => (b.ventas - a.ventas) || (tasa(b) - tasa(a)) || (b.conversaciones - a.conversaciones))
}
