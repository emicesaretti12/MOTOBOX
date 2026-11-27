// Avisos push con la app cerrada: suscribe este dispositivo y guarda la suscripción en push_suscripciones.
import { supabase } from './supabase'

export function pushSoportado(win = typeof window !== 'undefined' ? window : undefined) {
  return !!(win && 'serviceWorker' in win.navigator && 'PushManager' in win && 'Notification' in win)
}

// En iPhone los avisos solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4+).
export function necesitaInstalar(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false
  const ios = /iphone|ipad|ipod/i.test(win.navigator.userAgent)
  const instalada = win.matchMedia?.('(display-mode: standalone)').matches || win.navigator.standalone === true
  return ios && !instalada
}

export function claveABytes(base64) {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4)
  const b = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export async function clavePublica() {
  const { data } = await supabase.from('crm_config').select('valor').eq('clave', 'push_vapid_publica').maybeSingle()
  const v = data?.valor
  return typeof v === 'string' && v.length > 40 ? v : null
}

async function registro() {
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.ready
}

export async function estadoAvisos() {
  if (!pushSoportado()) return 'no_soportado'
  if (Notification.permission === 'denied') return 'bloqueado'
  const reg = await registro()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'activos' : 'apagados'
}

export async function activarAvisos(userId) {
  const clave = await clavePublica()
  if (!clave) throw new Error('Los avisos todavía no están habilitados en el servidor.')
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') throw new Error('Tenés que permitir las notificaciones para recibir avisos.')
  const reg = await registro()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(clave) })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_suscripciones').upsert({
    endpoint: j.endpoint, user_id: userId, p256dh: j.keys.p256dh, auth: j.keys.auth,
    dispositivo: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' })
  if (error) throw new Error('No se pudo guardar el aviso en el servidor.')
}

export async function apagarAvisos() {
  const reg = await registro()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_suscripciones').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
