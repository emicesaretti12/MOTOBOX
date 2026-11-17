import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { estadoVentana } from '../lib/chatLead'
import { horaCorta, diaSeparador } from './formato'

const TIPOS = ['mensaje_entrante', 'mensaje_saliente', 'dato']

// Mensajes del lead (WhatsApp/Instagram) en vivo.
export function useChatLead(lead) {
  const [eventos, setEventos] = useState(null)
  const contacto = lead?.sendpulse_contact_id
  useEffect(() => {
    if (!lead?.id) return
    let activo = true
    const cargar = () => {
      let q = supabase.from('agente_eventos').select('id, created_at, canal, tipo, autor, texto')
        .in('tipo', TIPOS).order('created_at', { ascending: false }).limit(300)
      q = contacto ? q.or(`lead_id.eq.${lead.id},contact_id.eq.${contacto}`) : q.eq('lead_id', lead.id)
      q.then(({ data }) => { if (activo && data) setEventos([...data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)) })
    }
    cargar()
    const canal = supabase.channel(`mv-chat-${lead.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agente_eventos', filter: contacto ? `contact_id=eq.${contacto}` : `lead_id=eq.${lead.id}` }, ({ new: e }) => {
        if (!TIPOS.includes(e.tipo)) return
        setEventos((prev) => (prev && !prev.some((x) => x.id === e.id) ? [...prev, e] : prev))
      })
      .subscribe()
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { activo = false; supabase.removeChannel(canal); document.removeEventListener('visibilitychange', alVolver) }
  }, [lead?.id, contacto])
  return eventos
}

// Burbujas estilo WhatsApp: cliente a la izquierda, Valen y el asesor a la derecha.
export function Burbujas({ eventos, vacio }) {
  if (!eventos) return <div className="mv-chat-cargando"><span className="mv-spinner" /></div>
  if (eventos.length === 0) return <div className="mv-chat-vacio">{vacio}</div>
  let diaPrevio = null
  return eventos.map((e) => {
    const dia = diaSeparador(e.created_at)
    const sep = dia !== diaPrevio ? <div className="mv-chat-dia" key={`d-${e.id}`}><span>{dia}</span></div> : null
    diaPrevio = dia
    if (e.tipo === 'dato') {
      return [sep, <div key={e.id} className="mv-chat-dato"><Info size={12} /> {e.texto}</div>]
    }
    const lado = e.autor === 'cliente' ? 'cliente' : e.autor === 'humano' ? 'humano' : 'agente'
    return [
      sep,
      <div key={e.id} className={`mv-burbuja ${lado}`}>
        {lado !== 'cliente' && <span className="mv-burbuja-autor">{lado === 'humano' ? 'Asesor' : 'Valen'}</span>}
        <span className="mv-burbuja-texto">{e.texto || '—'}</span>
        <span className="mv-burbuja-hora">{horaCorta(e.created_at)}</span>
      </div>,
    ]
  })
}

// Chat completo: mensajes + caja para escribir abajo (como WhatsApp).
export default function Conversacion({ lead, eventos }) {
  const { addToast } = useToast()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [reloj, setReloj] = useState(() => new Date())
  const cuerpo = useRef(null)
  const area = useRef(null)
  const contacto = lead?.sendpulse_contact_id

  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60000); return () => clearInterval(t) }, [])
  useLayoutEffect(() => { const c = cuerpo.current; if (c) c.scrollTop = c.scrollHeight }, [eventos?.length])
  // Si el chat se achica (abre el teclado) se queda mirando el último mensaje, como WhatsApp.
  useEffect(() => {
    const c = cuerpo.current
    if (!c || typeof ResizeObserver === 'undefined') return
    let alto = c.clientHeight
    const ro = new ResizeObserver(() => {
      const antes = alto; alto = c.clientHeight
      const cercaDelFinal = c.scrollHeight - c.scrollTop - antes < 80
      if (cercaDelFinal) c.scrollTop = c.scrollHeight
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [])
  useLayoutEffect(() => {
    const a = area.current; if (!a) return
    a.style.height = 'auto'; a.style.height = `${Math.min(120, a.scrollHeight)}px`
  }, [texto])

  const ventana = estadoVentana(eventos ?? [], reloj)

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
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
    <div className="mv-chat">
      <div className="mv-chat-cuerpo" ref={cuerpo} onTouchMove={() => { if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur() }}>
        <Burbujas eventos={eventos} vacio={contacto ? 'Todavía no hay mensajes guardados con este cliente.' : 'Este lead no escribió por el bot. Usá el botón de WhatsApp para hablarle.'} />
      </div>
      {contacto && (
        ventana.abierta ? (
          <div className="mv-chat-escribir">
            <textarea
              ref={area}
              rows={1}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Mensaje"
              disabled={enviando}
            />
            <button aria-label="Enviar" className="mv-chat-enviar" disabled={enviando || !texto.trim()} onClick={enviar}>
              {enviando ? <span className="mv-spinner blanco" /> : <ArrowUp size={20} strokeWidth={2.6} />}
            </button>
          </div>
        ) : (
          <div className="mv-chat-cerrado">Pasaron más de 24 h desde su último mensaje. Escribile desde tu WhatsApp.</div>
        )
      )}
    </div>
  )
}
