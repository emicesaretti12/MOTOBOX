import { useEffect, useRef, useState } from 'react'
import { Send, Bot, User, Headphones, Info, MessageSquare } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { estadoVentana } from '../lib/chatLead'

const hora = (f) => new Date(f).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

// Conversación del lead (WhatsApp o Instagram) y caja para contestarle desde el CRM.
// Los mensajes llegan por el webhook de SendPulse (agente_eventos); se envía con la función enviar-mensaje.
export default function ChatLead({ lead }) {
  const { addToast } = useToast()
  const [eventos, setEventos] = useState(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [reloj, setReloj] = useState(() => new Date())
  const finRef = useRef(null)
  const contacto = lead?.sendpulse_contact_id

  useEffect(() => {
    if (!lead?.id) return
    let activo = true
    let q = supabase.from('agente_eventos').select('id, created_at, canal, tipo, autor, texto')
      .in('tipo', ['mensaje_entrante', 'mensaje_saliente', 'dato']).order('created_at', { ascending: false }).limit(200)
    q = contacto ? q.or(`lead_id.eq.${lead.id},contact_id.eq.${contacto}`) : q.eq('lead_id', lead.id)
    q.then(({ data }) => { if (activo) setEventos((data ?? []).reverse()) })
    const canal = supabase.channel(`chat-lead-${lead.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agente_eventos', filter: contacto ? `contact_id=eq.${contacto}` : `lead_id=eq.${lead.id}` }, ({ new: e }) => {
        if (!['mensaje_entrante', 'mensaje_saliente', 'dato'].includes(e.tipo)) return
        setEventos((prev) => (prev && !prev.some((x) => x.id === e.id) ? [...prev, e] : prev))
      })
      .subscribe()
    const t = setInterval(() => setReloj(new Date()), 60000)
    return () => { activo = false; supabase.removeChannel(canal); clearInterval(t) }
  }, [lead?.id, contacto])

  useEffect(() => { finRef.current?.scrollIntoView({ block: 'nearest' }) }, [eventos?.length])

  if (!lead || eventos === null) return null
  if (!contacto && eventos.length === 0) return null

  const ventana = estadoVentana(eventos, reloj)

  async function enviar(e) {
    e.preventDefault()
    const t = texto.trim()
    if (!t) return
    setEnviando(true)
    const { data, error } = await supabase.functions.invoke('enviar-mensaje', { body: { lead_id: lead.id, texto: t } })
    setEnviando(false)
    if (error || data?.error) {
      let msj = data?.error
      if (!msj && error?.context?.json) { try { msj = (await error.context.json()).error } catch { /* sin cuerpo */ } }
      addToast(msj || 'No se pudo enviar el mensaje', 'error')
      return
    }
    setTexto('')
  }

  return (
    <div className="card chat-lead">
      <div className="card-header">
        <h3><MessageSquare size={16} /> Conversación</h3>
        {contacto && <span className={`chat-ventana ${ventana.abierta ? 'abierta' : ''}`}>{ventana.texto}</span>}
      </div>
      <div className="chat-lead-cuerpo">
        {eventos.length === 0 && <p className="chat-lead-vacio">Todavía no hay mensajes guardados de este cliente.</p>}
        {eventos.map((e) => {
          if (e.tipo === 'dato') return <div key={e.id} className="vivo-dato"><Info size={12} /> {e.texto} <span>{hora(e.created_at)}</span></div>
          const lado = e.autor === 'cliente' ? 'cliente' : e.autor === 'humano' ? 'humano' : 'agente'
          const Icono = lado === 'cliente' ? User : lado === 'humano' ? Headphones : Bot
          return (
            <div key={e.id} className={`vivo-msj ${lado}`}>
              <div className="vivo-msj-autor"><Icono size={12} /> {lado === 'cliente' ? 'Cliente' : lado === 'humano' ? 'Asesor' : 'Valen'} · {hora(e.created_at)}</div>
              <div className="vivo-msj-texto">{e.texto || '—'}</div>
            </div>
          )
        })}
        <div ref={finRef} />
      </div>
      {contacto && (
        <form className="chat-lead-enviar" onSubmit={enviar}>
          <textarea
            className="form-input"
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) enviar(e) }}
            placeholder={ventana.abierta ? 'Escribile al cliente…' : 'Pasaron más de 24 h: escribile desde tu WhatsApp'}
            disabled={enviando || !ventana.abierta}
          />
          <button className="btn btn-primary" disabled={enviando || !texto.trim() || !ventana.abierta}><Send size={16} /> {enviando ? 'Enviando…' : 'Enviar'}</button>
        </form>
      )}
    </div>
  )
}
