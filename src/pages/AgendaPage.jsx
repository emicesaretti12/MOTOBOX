import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Calendar, Clock, ChevronLeft, ChevronRight, Phone, MessageCircle } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
function getWa(ph) { if (!ph) return null; const c = ph.replace(/\D/g, ''); return 'https://wa.me/' + (c.startsWith('54') ? c : '54' + c) }

function getWeekRange(offset) {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7
  const start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59)
  return { start, end }
}

function isToday(d) { const t = new Date(); return d.toDateString() === t.toDateString() }
function isPast(d) { return d < new Date() && !isToday(d) }
function fmtWeekday(d) { return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) }
function fmtTime(d) { return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) }
function fmtShortDate(d) { return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) }

export default function AgendaPage() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [allLeadsCount, setAllLeadsCount] = useState(0)
  const [sinAgendarCount, setSinAgendarCount] = useState(0)
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterVendedor, setFilterVendedor] = useState('')
  const [filterEstado, setFilterEstado] = useState('')

  const week = useMemo(() => getWeekRange(weekOffset), [weekOffset])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    try {
      let q = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(id, full_name)')
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      const { data } = await q
      const all = data || []
      setAllLeadsCount(all.length)
      setLeads(all.filter(l => l.fecha_agenda))
      setSinAgendarCount(all.filter(l => !l.fecha_agenda && !['venta_cerrada', 'perdido'].includes(l.estado)).length)
      if (isAdmin) {
        const { data: v } = await supabase.from('profiles').select('id, full_name').order('full_name')
        setVendedores(v || [])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const today = new Date()
  const todayStr = today.toDateString()

  const stats = useMemo(() => {
    const hoy = leads.filter(l => l.fecha_agenda && new Date(l.fecha_agenda).toDateString() === todayStr).length
    const semana = leads.filter(l => { const d = new Date(l.fecha_agenda); return d >= week.start && d <= week.end }).length
    const pendientes = leads.filter(l => { const d = new Date(l.fecha_agenda); return isPast(d) && !['venta_cerrada', 'perdido'].includes(l.estado) }).length
    return { hoy, semana, pendientes }
  }, [leads, week, todayStr])

  const filteredAndGrouped = useMemo(() => {
    let f = leads.filter(l => {
      const d = new Date(l.fecha_agenda)
      if (d < week.start || d > week.end) return false
      if (filterVendedor && l.vendedor_asignado !== filterVendedor) return false
      if (filterEstado && l.estado !== filterEstado) return false
      return true
    }).sort((a, b) => new Date(a.fecha_agenda) - new Date(b.fecha_agenda))

    const groups = {}
    f.forEach(l => {
      const key = new Date(l.fecha_agenda).toDateString()
      if (!groups[key]) groups[key] = []
      groups[key].push(l)
    })
    return groups
  }, [leads, week, filterVendedor, filterEstado])

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Calendar size={20} /></div></div>
          <div className="stat-card-value">{stats.hoy}</div>
          <div className="stat-card-label">Citas Hoy</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Clock size={20} /></div></div>
          <div className="stat-card-value">{stats.semana}</div>
          <div className="stat-card-label">Esta Semana</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><Calendar size={20} /></div></div>
          <div className="stat-card-value">{stats.pendientes}</div>
          <div className="stat-card-label">Vencidas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon yellow"><Calendar size={20} /></div></div>
          <div className="stat-card-value">{sinAgendarCount}</div>
          <div className="stat-card-label">Sin Agendar</div>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="filters-bar">
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(w => w - 1)}><ChevronLeft size={16} /></button>
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(0)}>Hoy</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(w => w + 1)}><ChevronRight size={16} /></button>
        <span className="results-count" style={{ marginLeft: 8, fontWeight: 600, color: '#18181B' }}>
          {fmtShortDate(week.start)} — {fmtShortDate(week.end)}
        </span>
        {isAdmin && (
          <select className="filter-select" value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}>
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
          </select>
        )}
        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Agenda Table */}
      <div className="card">
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr><th>Hora</th><th>Nombre</th><th>Modelo</th><th>Teléfono</th><th>Estado</th>{isAdmin && <th>Vendedor</th>}<th>Acciones</th></tr>
            </thead>
            <tbody>
              {Object.keys(filteredAndGrouped).length === 0 ? (
                <tr><td colSpan={isAdmin ? 7 : 6}><div className="empty-state"><p>No hay citas esta semana</p></div></td></tr>
              ) : Object.entries(filteredAndGrouped).map(([dateStr, items]) => {
                const d = new Date(dateStr)
                const today = isToday(d)
                const past = isPast(d)
                return [
                  <tr key={`h-${dateStr}`}>
                    <td colSpan={isAdmin ? 7 : 6} className={today ? 'table-cell-primary' : 'table-cell-secondary'}
                      style={{ background: today ? 'rgba(220,38,38,0.04)' : past ? '#fafafa' : 'transparent', textTransform: 'capitalize', fontWeight: 600, fontSize: '0.8125rem' }}>
                      {today ? '📍 ' : ''}{fmtWeekday(d)}
                    </td>
                  </tr>,
                  ...items.map(l => (
                    <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)} style={past ? { opacity: 0.6 } : {}}>
                      <td className="table-cell-primary">{fmtTime(new Date(l.fecha_agenda))}</td>
                      <td className="table-cell-primary">{l.nombre}</td>
                      <td>{l.modelo_interes || '-'}</td>
                      <td>{l.telefono || '-'}</td>
                      <td><span className={`badge badge-${l.estado}`}>{STATUS_LABELS[l.estado]}</span></td>
                      {isAdmin && <td className="table-cell-secondary">{l.vendedor?.full_name || '-'}</td>}
                      <td>
                        <div className="table-actions" onClick={e => e.stopPropagation()}>
                          {l.telefono && getWa(l.telefono) && <a href={getWa(l.telefono)} target="_blank" rel="noopener" className="btn-icon whatsapp"><MessageCircle size={16} /></a>}
                          {l.telefono && <a href={`tel:${l.telefono}`} className="btn-icon phone"><Phone size={16} /></a>}
                        </div>
                      </td>
                    </tr>
                  ))
                ]
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
