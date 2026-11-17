import { useEffect, useRef } from 'react'
import { debeRefrescar } from '../lib/refresco'

// Vuelve a cargar los datos solo, sin tocar nada:
//   * cada `cadaMs` mientras la pantalla está a la vista (en segundo plano no gasta datos ni batería);
//   * apenas la app vuelve al frente (en el celular la conexión en vivo se corta al bloquear la pantalla);
//   * cuando vuelve internet.
export function useRefrescoAuto(cargar, cadaMs = 60000) {
  const fn = useRef(cargar)
  fn.current = cargar
  const ultimo = useRef(Date.now())

  useEffect(() => {
    const correr = (forzar = false) => {
      if (!debeRefrescar({ visible: document.visibilityState === 'visible', ahora: Date.now(), ultimo: ultimo.current, forzar })) return
      ultimo.current = Date.now()
      try { fn.current?.() } catch { /* la pantalla maneja sus errores */ }
    }
    const reloj = setInterval(() => correr(), cadaMs)
    const alVolver = () => { if (document.visibilityState === 'visible') correr(true) }
    const online = () => correr(true)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    window.addEventListener('online', online)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
      window.removeEventListener('online', online)
    }
  }, [cadaMs])
}
