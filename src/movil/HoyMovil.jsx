import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, PartyPopper } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { colaDeHoy, avanceDeHoy, comoPaga, asunto } from '../lib/hoy'
import { mensajeCaliente } from '../lib/calientes'
import { useLeads, abrirWhatsApp } from './datos'
import { Pantalla, Avatar, Fila, Segmentos, Pastilla, Vacio, Esqueleto } from './ui'
import { HojaResultado } from './hojas'
import { cuandoCorto } from './formato'

const fechaHoy = () => {
  const t = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export default function HoyMovil() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { leads, error, cargar, actualizarLocal } = useLeads({ abiertos: true })
  const [pestana, setPestana] = useState(null)
  const [resultado, setResultado] = useState(null)

  const cola = useMemo(() => colaDeHoy(leads || []), [leads])
  const avance = useMemo(() => avanceDeHoy(leads || []), [leads])
  const grupo = cola.grupos.find((g) => g.clave === pestana) || cola.grupos[0] || null

  return (
    <Pantalla titulo="Hoy" subtitulo={fechaHoy()} onRefrescar={cargar}>
      <div className="mv-resumen">
        <div><strong className="naranja">{cola.total}</strong><span>por contactar</span></div>
        <div><strong>{avance.contactados}</strong><span>contactados</span></div>
        <div><strong>{avance.citasFuturas}</strong><span>visitas</span></div>
      </div>

      {error && <Vacio titulo="Sin conexión" texto={error} />}
      {!leads && !error && <Esqueleto />}

      {leads && cola.total === 0 && (
        <Vacio icono={PartyPopper} titulo="¡Todo al día!" texto="No queda nadie por contactar. Cuando entre un lead nuevo o toque un seguimiento, aparece acá." />
      )}

      {grupo && (
        <>
          <div className="mv-scroll-x">
            <Segmentos opciones={cola.grupos.map((g) => ({ valor: g.clave, texto: g.titulo, n: g.leads.length }))} valor={grupo.clave} onCambio={setPestana} />
          </div>
          <p className="mv-ayuda">{grupo.ayuda}</p>
          <div className="mv-grupo">
            {grupo.leads.map((l) => {
              const pago = comoPaga(l)
              return (
                <Fila
                  key={l.id}
                  onClick={() => navigate(`/leads/${l.id}`)}
                  izq={<Avatar nombre={l.nombre} />}
                  titulo={l.nombre || 'Sin nombre'}
                  sub={asunto(l)}
                  der={
                    <span className="mv-fila-der-col">
                      <span className="mv-hora">{cuandoCorto(grupo.clave === 'citas' ? l.fecha_agenda : (l.caliente_at || l.updated_at))}</span>
                      <button
                        className="mv-icono-boton wa"
                        aria-label="WhatsApp"
                        onClick={(e) => { e.stopPropagation(); abrirWhatsApp(l.telefono, mensajeCaliente(l, profile?.full_name)); setResultado(l) }}
                      >
                        <MessageCircle size={18} />
                      </button>
                    </span>
                  }
                >
                  <span className="mv-fila-pastillas"><Pastilla tono={pago.tono}>{pago.texto}</Pastilla></span>
                </Fila>
              )
            })}
          </div>
        </>
      )}

      <HojaResultado
        lead={resultado}
        abierta={!!resultado}
        onCerrar={() => setResultado(null)}
        onGuardado={(cambios) => resultado && actualizarLocal(resultado.id, cambios)}
      />
    </Pantalla>
  )
}
