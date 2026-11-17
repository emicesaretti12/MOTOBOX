import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { useLeads } from './datos'
import { Pantalla, Avatar, Fila, Seccion, Pastilla, Vacio, Esqueleto } from './ui'
import { horaCorta } from './formato'

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const clave = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export default function AgendaMovil() {
  const navigate = useNavigate()
  const { leads, cargar } = useLeads()
  const hoy = inicioDia(new Date())
  const [elegido, setElegido] = useState(hoy)

  // Dos semanas desde el lunes de esta semana.
  const dias = useMemo(() => {
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
    return Array.from({ length: 14 }, (_, i) => { const d = new Date(lunes); d.setDate(lunes.getDate() + i); return d })
  }, [hoy.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  const { porDia, vencidas } = useMemo(() => {
    const porDia = new Map()
    const vencidas = []
    for (const l of leads ?? []) {
      if (!l.fecha_agenda) continue
      const f = new Date(l.fecha_agenda)
      const abierta = !['venta_cerrada', 'perdido'].includes(l.estado)
      if (abierta && f < hoy && f > new Date(hoy.getTime() - 30 * 864e5)) vencidas.push(l)
      const k = clave(f)
      if (!porDia.has(k)) porDia.set(k, [])
      porDia.get(k).push(l)
    }
    for (const lista of porDia.values()) lista.sort((a, b) => new Date(a.fecha_agenda) - new Date(b.fecha_agenda))
    vencidas.sort((a, b) => new Date(b.fecha_agenda) - new Date(a.fecha_agenda))
    return { porDia, vencidas }
  }, [leads]) // eslint-disable-line react-hooks/exhaustive-deps

  const delDia = porDia.get(clave(elegido)) ?? []
  const titulo = elegido.getTime() === hoy.getTime() ? 'Hoy' : elegido.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const mes = elegido.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

  return (
    <Pantalla titulo="Agenda" subtitulo={mes.charAt(0).toUpperCase() + mes.slice(1)} onRefrescar={cargar}>
      <div className="mv-semana">
        {dias.map((d) => {
          const k = clave(d)
          const sel = k === clave(elegido)
          const n = porDia.get(k)?.length ?? 0
          return (
            <button key={k} className={`${sel ? 'sel' : ''} ${k === clave(hoy) ? 'hoy' : ''}`} onClick={() => setElegido(d)}>
              <span>{DIAS_CORTOS[d.getDay()]}</span>
              <strong>{d.getDate()}</strong>
              <i className={n ? 'con' : ''} />
            </button>
          )
        })}
      </div>

      {!leads && <Esqueleto filas={3} />}
      {leads && (
        <Seccion titulo={titulo}>
          {delDia.length === 0 ? (
            <Vacio icono={CalendarDays} titulo="Sin visitas" texto="Cuando agendes una visita desde un lead aparece acá." />
          ) : delDia.map((l) => (
            <Fila
              key={l.id}
              onClick={() => navigate(`/leads/${l.id}`)}
              izq={<span className="mv-hora-grande">{horaCorta(l.fecha_agenda)}</span>}
              titulo={l.nombre || 'Sin nombre'}
              sub={l.modelo_interes || 'Sin moto elegida'}
              der={l.estado === 'venta_cerrada' ? <Pastilla tono="verde">Vendido</Pastilla> : l.estado === 'perdido' ? <Pastilla>Perdido</Pastilla> : null}
              chevron
            />
          ))}
        </Seccion>
      )}

      {vencidas.length > 0 && (
        <Seccion titulo={`Visitas pasadas sin cerrar (${vencidas.length})`} pie="Clientes que tenían visita y siguen abiertos: conviene escribirles.">
          {vencidas.slice(0, 20).map((l) => (
            <Fila
              key={l.id}
              onClick={() => navigate(`/leads/${l.id}`)}
              izq={<Avatar nombre={l.nombre} tam={36} />}
              titulo={l.nombre || 'Sin nombre'}
              sub={new Date(l.fecha_agenda).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}
              chevron
            />
          ))}
        </Seccion>
      )}
    </Pantalla>
  )
}
