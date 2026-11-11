import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { FORMA_PAGO_LABELS } from '../lib/verificacion'
import { ordenarCalientes } from '../lib/calientes'
import { Flame, BellRing } from 'lucide-react'

// Alerta arriba de todo el CRM: leads calientes (contado, tarjeta, anticipo o BCRA apto) que nadie contactó.
// Se actualiza sola (tiempo real), suena y manda una notificación del navegador cuando entra uno nuevo.
// Desaparece cuando el vendedor toca "Listo" o el lead cambia de estado. Un lead sin atender sigue
// en la lista hasta 14 días: antes se ocultaba a las 48 h y se perdía sin que nadie le escribiera.
const HORAS = 14 * 24

function motivo(l) {
  if (l.caliente_motivo === 'asesor') return 'Pidió hablar con un asesor'
  return FORMA_PAGO_LABELS[l.forma_pago] || 'BCRA apto'
}

function sonar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination)
      g.gain.setValueAtTime(0.2, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2)
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2)
    })
  } catch { /* sin audio */ }
}

export default function AlertaCalientes() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [leads, setLeads] = useState([])
  const [permiso, setPermiso] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'denied'))
  const vistos = useRef(null)

  useEffect(() => {
    if (!profile?.id) return
    let activo = true
    async function cargar() {
      let q = supabase.from('leads')
        .select('id, nombre, telefono, notas, modelo_interes, forma_pago, bcra_resultado, caliente_at, caliente_motivo, estado, origen, vendedor:profiles!vendedor_asignado(full_name)')
        .gte('caliente_at', new Date(Date.now() - HORAS * 36e5).toISOString())
        .in('estado', ['nuevo', 'contactado'])
        .is('caliente_atendido_at', null)
        .is('duplicado_de', null)
        .order('caliente_at', { ascending: false })
        .limit(200)
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      const { data } = await q
      if (!activo || !data) return
      const nuevos = vistos.current ? data.filter((l) => !vistos.current.has(l.id)) : []
      vistos.current = new Set(data.map((l) => l.id))
      setLeads(ordenarCalientes(data))
      if (nuevos.length) {
        sonar()
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const l = nuevos[0]
          const n = new Notification('🔥 Lead caliente', { body: `${l.nombre} — ${motivo(l)}. Escribile ya.`, tag: l.id })
          n.onclick = () => { window.focus(); navigate('/hoy') }
        }
      }
    }
    cargar()
    const canal = supabase.channel(`alerta-calientes-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => cargar())
      .subscribe()
    const reloj = setInterval(cargar, 120000)
    return () => { activo = false; supabase.removeChannel(canal); clearInterval(reloj) }
  }, [profile?.id, isAdmin])

  // En "Para vender hoy" ya está la lista completa: acá solo avisamos y llevamos ahí.
  if (leads.length === 0 || location.pathname === '/hoy') return null

  return (
    <div className="alerta-calientes compacta">
      <span className="alerta-calientes-titulo">
        <Flame size={16} /> {leads.length === 1 ? '1 lead listo para comprar sin contactar' : `${leads.length} leads listos para comprar sin contactar`}
      </span>
      {permiso === 'default' && (
        <button className="btn-link" onClick={() => Notification.requestPermission().then(setPermiso)}>
          <BellRing size={14} /> Activar avisos
        </button>
      )}
      <button className="btn btn-sm btn-primary" onClick={() => navigate('/hoy')}>Atender ahora</button>
    </div>
  )
}
