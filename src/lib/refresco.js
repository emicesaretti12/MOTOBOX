export const MINIMO_ENTRE_RECARGAS_MS = 5000

// Se recarga si la pantalla está a la vista y no se recargó hace un instante
// (al volver a la app llegan juntos "visibilitychange" y "focus").
export function debeRefrescar({ visible, ahora, ultimo, forzar }) {
  if (!visible) return false
  if (ahora - ultimo < MINIMO_ENTRE_RECARGAS_MS) return false
  return forzar || true
}

// Una versión nueva de la app se aplica si la pantalla no está a la vista, o si está a la vista pero el usuario
// no está en medio de algo (formulario abierto o texto escrito).
export function puedeRecargarAhora({ visible, ocupada }) {
  return !visible || !ocupada
}
