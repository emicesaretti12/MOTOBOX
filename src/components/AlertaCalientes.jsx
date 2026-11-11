import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { FORMA_PAGO_LABELS } from '../lib/verificacion'
import { ordenarCalientes, linkCaliente } from '../lib/calientes'
import { Flame, MessageCircle, BellRing, Check } from 'lucide-react'

// Alerta arriba de todo el CRM: leads calientes (contado, tarjeta, anticipo o BCRA apto) que nadie contactó.
// Se actualiza sola (tiempo real), suena y manda una notificación del navegador cuando entra uno nuevo.
// Desaparece cuando el vendedor toca "Listo" o el lead cambia de estado. Un lead sin atender sigue
// en la lista hasta 14 días: antes se ocultaba a las 48 h y se perdía sin que nadie le escribiera.
const HORAS = 14 * 24
const VISIBLES = 5

function hace(fecha) {
  const min = Math.max(1, Math.round((Date.now() - new Date(fecha).getTime()) / 60000))
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}

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
  const [leads, setLeads] = useState([])
  const [permiso, setPermiso] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'denied'))
  const vistos = useRef(null)
  const [verTodos, setVerTodos] = useState(false)

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
          n.onclick = () => { window.focus(); navigate(`/leads/${l.id}`) }
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

  async function atendido(l) {
    const nota = `[${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })}] CRM: lead caliente atendido por ${profile?.full_name || 'vendedor'}`
    const { error } = await supabase.from('leads')
      .update({ caliente_atendido_at: new Date().toISOString(), estado: 'contactado', notas: [l.notas, nota].filter(Boolean).join('\n') })
      .eq('id', l.id)
    if (!error) setLeads((prev) => prev.filter((x) => x.id !== l.id))
  }

  if (leads.length === 0) return null

  return (
    <div className="alerta-calientes">
      <div className="alerta-calientes-titulo">
        <Flame size={16} /> {leads.length === 1 ? '1 lead caliente sin contactar' : `${leads.length} leads calientes sin contactar`} — escribiles ya
        {permiso === 'default' && (
          <button className="btn-link" onClick={() => Notification.requestPermission().then(setPermiso)}>
            <BellRing size={14} /> Activar avisos
          </button>
        )}
      </div>
      {(verTodos ? leads : leads.slice(0, VISIBLES)).map((l) => {
        const wa = linkCaliente(l, profile?.full_name)
        return (
          <div key={l.id} className="alerta-calientes-fila">
            <button className="contactar-nombre" onClick={() => navigate(`/leads/${l.id}`)}>
              {l.nombre}
              <span className="aviso-detalle">
                {motivo(l)}{l.modelo_interes ? ` · ${l.modelo_interes}` : ''} · {hace(l.caliente_at)}
                {isAdmin && ` · ${l.vendedor?.full_name || 'Sin asignar'}`}
              </span>
            </button>
            <div className="recuperar-acciones">
              {wa && (
                <a className="btn btn-sm btn-whatsapp-contactar" href={wa} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={14} /> WhatsApp
                </a>
              )}
              <button className="btn btn-sm btn-secondary" onClick={() => atendido(l)} title="Ya le escribí">
                <Check size={14} /> Listo
              </button>
            </div>
          </div>
        )
      })}
      {leads.length > VISIBLES && (
        <button className="btn-link alerta-calientes-mas" onClick={() => setVerTodos((v) => !v)}>
          {verTodos ? 'Ver menos' : `Ver los ${leads.length} leads`}
        </button>
      )}
    </div>
  )
}
