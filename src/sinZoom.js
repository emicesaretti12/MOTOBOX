// En el celular la app no se puede agrandar con dos dedos ni con doble toque, como una app nativa.
// El meta viewport (user-scalable=no) lo respetan Android y la app instalada; Safari en iPhone lo ignora,
// así que además se cancelan los gestos de pellizco y el doble toque. En computadoras no hace nada.
const esTactil = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

if (esTactil) {
  const cancelar = (e) => e.preventDefault()
  // Pellizco en Safari (iOS)
  document.addEventListener('gesturestart', cancelar, { passive: false })
  document.addEventListener('gesturechange', cancelar, { passive: false })
  document.addEventListener('gestureend', cancelar, { passive: false })
  // Pellizco con dos dedos (resto de los navegadores)
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })
  // Doble toque rápido
  let ultimoToque = 0
  document.addEventListener('touchend', (e) => {
    const ahora = Date.now()
    if (ahora - ultimoToque < 300 && !e.target.closest('input, textarea, select, [contenteditable]')) e.preventDefault()
    ultimoToque = ahora
  }, { passive: false })
}
