import { registerSW } from 'virtual:pwa-register'
import { puedeRecargarAhora } from './lib/refresco'

// La app instalada se actualiza sola cuando publicamos una versión nueva, sin cerrarla:
//   * busca versión nueva cada 5 minutos y cada vez que la app vuelve al frente;
//   * la versión nueva se activa enseguida (skipWaiting) y la pantalla se recarga apenas no interrumpe:
//     sin formulario abierto ni texto a medio escribir, o cuando la app pasa a segundo plano.
const CADA_MS = 5 * 60 * 1000

function interfazOcupada() {
  const activo = document.activeElement
  const escribiendo = activo && /^(INPUT|TEXTAREA|SELECT)$/.test(activo.tagName) && String(activo.value ?? '').trim() !== ''
  return escribiendo || !!document.querySelector('.modal-overlay')
}

let pendiente = false
function intentar() {
  if (!pendiente) return
  if (puedeRecargarAhora({ visible: document.visibilityState === 'visible', ocupada: interfazOcupada() })) {
    pendiente = false
    window.location.reload()
  }
}

if ('serviceWorker' in navigator) {
  // Si la página ya estaba controlada por una versión anterior, un cambio de controlador = versión nueva.
  // (La primera instalación también cambia el controlador y ahí no hace falta recargar.)
  const habiaVersion = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaVersion) return
    pendiente = true
    intentar()
  })
  document.addEventListener('visibilitychange', intentar)
  setInterval(intentar, 15000)

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registro) {
      if (!registro) return
      const buscar = () => { if (navigator.onLine) registro.update().catch(() => {}) }
      setInterval(buscar, CADA_MS)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') buscar() })
    },
  })
}
