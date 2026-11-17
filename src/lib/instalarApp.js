export const esIOS = (ua) => /iphone|ipad|ipod/i.test(ua ?? '')

export function estaInstalada(win) {
  try {
    return win.matchMedia?.('(display-mode: standalone)').matches || win.navigator?.standalone === true
  } catch {
    return false
  }
}
