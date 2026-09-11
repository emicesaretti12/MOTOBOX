import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Users, TrendingUp, Target, Award, DollarSign, ChevronRight, Phone, MessageCircle, Calendar, AlertTriangle, Flame, Snowflake, Clock, Zap, CalendarDays, ChevronDown, ChevronUp } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const STATUS_COLORS = { nuevo: '#2563EB', contactado: '#D97706', en_negociacion: '#7C3AED', venta_cerrada: '#16A34A', perdido: '#71717A' }
const FUNNEL_ORDER = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada']
const TIPO_ICONS = { llamada: Phone, whatsapp: MessageCircle }

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000)
  if (s < 60) return 'Ahora'
  if (s < 3600) return `Hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} hs`
  return `Hace ${Math.floor(s / 86400)} días`
}

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '-' }
function fmtTime(d) { return new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) }

// Intelligent Lead Temperature
function getLeadTemp(lead, lastInteraction) {
  const now = Date.now()
  const created = new Date(lead.created_at).getTime()
  const daysSinceCreation = (now - created) / 86400000
  const daysSinceContact = lastInteraction ? (now - new Date(lastInteraction).getTime()) / 86400000 : daysSinceCreation
  const hasBudget = !!lead.presupuesto_estimado
  const hasAppointment = !!lead.fecha_agenda && new Date(lead.fecha_agenda) > new Date()

  let score = 0
  if (lead.estado === 'en_negociacion') score += 40
  else if (lead.estado === 'contactado') score += 20
  else if (lead.estado === 'nuevo') score += 10
  if (hasBudget) score += 15
  if (hasAppointment) score += 20
  if (daysSinceContact < 2) score += 25
  else if (daysSinceContact < 5) score += 10
  else if (daysSinceContact > 10) score -= 20

  if (score >= 60) return { temp: 'hot', label: '🔥 Caliente', color: '#DC2626' }
  if (score >= 30) return { temp: 'warm', label: '🟡 Tibio', color: '#D97706' }
  return { temp: 'cold', label: '🔵 Frío', color: '#2563EB' }
}

export default function DashboardPage() {
  const { profile, isAdmin, user } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [interacciones, setInteracciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDays, setExpandedDays] = useState({})
  const [daysRange, setDaysRange] = useState(30)

  useEffect(() => {
    fetchData()

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        fetchData()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interacciones' }, () => {
        fetchData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function fetchData() {
    try {
      let lq = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)')
      let iq = supabase.from('interacciones')
        .select('*, lead:leads!lead_id(id, nombre, modelo_interes), usuario:profiles!usuario_id(full_name)')
        .order('fecha', { ascending: false }).limit(15)
      if (!isAdmin) {
        lq = lq.eq('vendedor_asignado', profile.id)
        iq = iq.eq('usuario_id', profile.id)
      }
      const [lr, ir] = await Promise.all([lq, iq])
      setLeads(lr.data || [])
      setInteracciones(ir.data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Last interaction per lead
  const lastIntMap = useMemo(() => {
    const m = {}
    interacciones.forEach(i => {
      if (!m[i.lead_id] || new Date(i.fecha) > new Date(m[i.lead_id])) m[i.lead_id] = i.fecha
    })
    return m
  }, [interacciones])

  // Stats
  const stats = useMemo(() => {
    const total = leads.length
    const ventas = leads.filter(l => l.estado === 'venta_cerrada').length
    const negociacion = leads.filter(l => l.estado === 'en_negociacion').length
    const revenue = leads.filter(l => l.estado === 'venta_cerrada').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    const pipeline = leads.filter(l => l.estado === 'en_negociacion').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    const conversion = total > 0 ? ((ventas / total) * 100).toFixed(1) : '0'
    const week = new Date(Date.now() - 7 * 86400000)
    const nuevosEstaSemana = leads.filter(l => new Date(l.created_at) >= week).length
    return { total, ventas, negociacion, conversion, revenue, pipeline, nuevosEstaSemana }
  }, [leads])

  // Funnel data
  const funnelData = useMemo(() =>
    FUNNEL_ORDER.map(estado => ({
      estado, label: STATUS_LABELS[estado], color: STATUS_COLORS[estado],
      count: leads.filter(l => l.estado === estado).length,
      value: leads.filter(l => l.estado === estado).reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    })),
    [leads])
  const maxFunnel = Math.max(...funnelData.map(f => f.count), 1)

  // Pie chart
  const pieData = useMemo(() =>
    Object.entries(leads.reduce((a, l) => { a[l.estado] = (a[l.estado] || 0) + 1; return a }, {}))
      .map(([k, v]) => ({ name: STATUS_LABELS[k], value: v, color: STATUS_COLORS[k] })),
    [leads])

  // Intelligent Alerts
  const alerts = useMemo(() => {
    const a = []
    const activeLeads = leads.filter(l => !['venta_cerrada', 'perdido'].includes(l.estado))

    // Hot leads without appointment
    const hotNoAppt = activeLeads.filter(l => {
      const t = getLeadTemp(l, lastIntMap[l.id])
      return t.temp === 'hot' && !l.fecha_agenda
    })
    if (hotNoAppt.length > 0) a.push({ type: 'warning', icon: Flame, title: `${hotNoAppt.length} lead${hotNoAppt.length > 1 ? 's' : ''} caliente${hotNoAppt.length > 1 ? 's' : ''} sin cita agendada`, leads: hotNoAppt.slice(0, 3) })

    // Leads going cold (no contact >5 days)
    const goingCold = activeLeads.filter(l => {
      const days = lastIntMap[l.id] ? (Date.now() - new Date(lastIntMap[l.id])) / 86400000 : (Date.now() - new Date(l.created_at)) / 86400000
      return days > 5 && days < 15
    })
    if (goingCold.length > 0) a.push({ type: 'danger', icon: Snowflake, title: `${goingCold.length} lead${goingCold.length > 1 ? 's' : ''} enfriándose (>5 días sin contacto)`, leads: goingCold.slice(0, 3) })

    // Overdue appointments
    const overdue = leads.filter(l => l.fecha_agenda && new Date(l.fecha_agenda) < new Date() && !['venta_cerrada', 'perdido'].includes(l.estado))
    if (overdue.length > 0) a.push({ type: 'info', icon: Clock, title: `${overdue.length} cita${overdue.length > 1 ? 's' : ''} vencida${overdue.length > 1 ? 's' : ''} sin cerrar`, leads: overdue.slice(0, 3) })

    // High-value opportunities
    const highValue = activeLeads.filter(l => l.estado === 'en_negociacion' && Number(l.presupuesto_estimado) > 500000)
    if (highValue.length > 0) a.push({ type: 'success', icon: Zap, title: `${highValue.length} oportunidad${highValue.length > 1 ? 'es' : ''} de alto valor en negociación`, leads: highValue.slice(0, 3) })

    return a
  }, [leads, lastIntMap])

  // Today's appointments
  const citasHoy = useMemo(() => {
    const todayStr = new Date().toDateString()
    return leads.filter(l => l.fecha_agenda && new Date(l.fecha_agenda).toDateString() === todayStr)
      .sort((a, b) => new Date(a.fecha_agenda) - new Date(b.fecha_agenda))
  }, [leads])

  // Leads with temperature
  const leadsWithTemp = useMemo(() =>
    leads.filter(l => !['venta_cerrada', 'perdido'].includes(l.estado))
      .map(l => ({ ...l, tempData: getLeadTemp(l, lastIntMap[l.id]) }))
      .sort((a, b) => {
        const order = { hot: 0, warm: 1, cold: 2 }
        return (order[a.tempData.temp] || 3) - (order[b.tempData.temp] || 3)
      }).slice(0, 8),
    [leads, lastIntMap])

  // Vendor ranking
  const vendorRanking = useMemo(() => {
    if (!isAdmin) return []
    const map = {}
    leads.forEach(l => {
      const name = l.vendedor?.full_name || 'Sin asignar'
      if (!map[name]) map[name] = { name, leads: 0, ventas: 0, revenue: 0 }
      map[name].leads++
      if (l.estado === 'venta_cerrada') { map[name].ventas++; map[name].revenue += Number(l.presupuesto_estimado) || 0 }
    })
    return Object.values(map).sort((a, b) => b.ventas - a.ventas)
  }, [leads, isAdmin])

  // Leads per day (admin only)
  const leadsPerDay = useMemo(() => {
    if (!isAdmin) return []
    const map = {}
    leads.forEach(l => {
      const dateStr = new Date(l.created_at).toLocaleDateString('es-AR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      const sortKey = new Date(l.created_at).toISOString().slice(0, 10)
      if (!map[sortKey]) map[sortKey] = { sortKey, dateStr, leads: [], count: 0 }
      map[sortKey].leads.push(l)
      map[sortKey].count++
    })
    return Object.values(map)
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
  }, [leads, isAdmin])

  // Chart data for bar chart (last N days)
  const chartData = useMemo(() => {
    if (!isAdmin) return []
    const now = new Date()
    const days = []
    for (let i = daysRange - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const dayLabel = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      const found = leadsPerDay.find(p => p.sortKey === key)
      days.push({ date: dayLabel, count: found ? found.count : 0, sortKey: key })
    }
    return days
  }, [leadsPerDay, daysRange, isAdmin])

  // Total leads in selected range
  const totalInRange = useMemo(() => chartData.reduce((s, d) => s + d.count, 0), [chartData])
  const avgPerDay = useMemo(() => chartData.length > 0 ? (totalInRange / chartData.length).toFixed(1) : '0', [totalInRange, chartData])
  const bestDay = useMemo(() => chartData.reduce((best, d) => d.count > best.count ? d : best, { count: 0 }), [chartData])

  function toggleDay(sortKey) {
    setExpandedDays(prev => ({ ...prev, [sortKey]: !prev[sortKey] }))
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* KPIs */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Users size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">{isAdmin ? 'Total Leads' : 'Mis Leads'}</div>
          <div className="stat-card-trend up">+{stats.nuevosEstaSemana} esta semana</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><Award size={20} /></div></div>
          <div className="stat-card-value">{stats.ventas}</div>
          <div className="stat-card-label">Ventas Cerradas</div>
          <div className="stat-card-trend up">{stats.conversion}% conversión</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><Target size={20} /></div></div>
          <div className="stat-card-value">{stats.negociacion}</div>
          <div className="stat-card-label">En Negociación</div>
          <div className="stat-card-trend neutral">{fmt$(stats.pipeline)} pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><DollarSign size={20} /></div></div>
          <div className="stat-card-value">{fmt$(stats.revenue)}</div>
          <div className="stat-card-label">Revenue</div>
        </div>
      </div>

      {/* Smart Alerts */}
      {alerts.length > 0 && (
        <div className="alerts-grid">
          {alerts.map((alert, idx) => {
            const Icon = alert.icon
            return (
              <div key={idx} className={`alert-card alert-${alert.type}`}>
                <div className="alert-header"><Icon size={16} /> <strong>{alert.title}</strong></div>
                <div className="alert-leads">
                  {alert.leads.map(l => (
                    <div key={l.id} className="alert-lead" onClick={() => navigate(`/leads/${l.id}`)}>
                      <span>{l.nombre}</span>
                      <span className="alert-lead-model">{l.modelo_interes || ''}</span>
                      <ChevronRight size={14} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Funnel + Citas Hoy */}
      <div className="grid-2">
        {/* Conversion Funnel */}
        <div className="card">
          <div className="card-header"><h3>Embudo de Conversión</h3></div>
          <div className="card-body">
            {funnelData.map((f, i) => {
              const pct = (f.count / maxFunnel * 100).toFixed(0)
              const convNext = i < funnelData.length - 1 && funnelData[i].count > 0
                ? ((funnelData[i + 1].count / funnelData[i].count) * 100).toFixed(0) : null
              return (
                <div key={f.estado} className="funnel-row">
                  <div className="funnel-label">
                    <span className="funnel-name">{f.label}</span>
                    <span className="funnel-count">{f.count} {f.value > 0 ? `· ${fmt$(f.value)}` : ''}</span>
                  </div>
                  <div className="funnel-bar-track">
                    <div className="funnel-bar" style={{ width: `${pct}%`, background: f.color }}></div>
                  </div>
                  {convNext && <div className="funnel-conv">↓ {convNext}%</div>}
                </div>
              )
            })}
            <div className="funnel-row">
              <div className="funnel-label"><span className="funnel-name">Perdidos</span><span className="funnel-count">{leads.filter(l => l.estado === 'perdido').length}</span></div>
              <div className="funnel-bar-track"><div className="funnel-bar" style={{ width: `${(leads.filter(l => l.estado === 'perdido').length / maxFunnel * 100).toFixed(0)}%`, background: STATUS_COLORS.perdido }}></div></div>
            </div>
          </div>
        </div>

        {/* Citas Hoy / Temperature */}
        <div className="card">
          <div className="card-header">
            <h3>{citasHoy.length > 0 ? `📅 Citas Hoy (${citasHoy.length})` : '🌡️ Temperatura de Leads'}</h3>
            {citasHoy.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/agenda')}><Calendar size={14} /> Agenda</button>}
          </div>
          <div className="card-body">
            {citasHoy.length > 0 ? citasHoy.map(l => (
              <div key={l.id} className="followup-item" onClick={() => navigate(`/leads/${l.id}`)}>
                <div className="followup-dot" style={{ background: '#DC2626' }} />
                <div className="followup-info">
                  <div className="followup-name">{l.nombre}</div>
                  <div className="followup-sub">{l.modelo_interes || ''}</div>
                </div>
                <span className="followup-badge">{fmtTime(l.fecha_agenda)}</span>
                <ChevronRight size={16} className="followup-arrow" />
              </div>
            )) : leadsWithTemp.length > 0 ? leadsWithTemp.map(l => (
              <div key={l.id} className="followup-item" onClick={() => navigate(`/leads/${l.id}`)}>
                <div className="followup-dot" style={{ background: l.tempData.color }} />
                <div className="followup-info">
                  <div className="followup-name">{l.nombre}</div>
                  <div className="followup-sub">{l.modelo_interes || ''} · {STATUS_LABELS[l.estado]}</div>
                </div>
                <span className="followup-badge" style={{ color: l.tempData.color }}>{l.tempData.label}</span>
                <ChevronRight size={16} className="followup-arrow" />
              </div>
            )) : <div className="empty-state"><p>Sin leads activos</p></div>}
          </div>
        </div>
      </div>

      {/* Activity + Ranking/Chart */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>{isAdmin ? 'Actividad Reciente' : 'Mi Actividad'}</h3></div>
          <div className="card-body">
            {interacciones.length > 0 ? interacciones.slice(0, 8).map(a => {
              const Icon = TIPO_ICONS[a.tipo] || Phone
              return (
                <div key={a.id} className="feed-item" onClick={() => navigate(`/leads/${a.lead?.id}`)}>
                  <div className="feed-icon"><Icon size={14} /></div>
                  <div className="feed-body">
                    <div className="feed-text">
                      {isAdmin && <><strong>{a.usuario?.full_name}</strong> → {a.tipo} con </>}
                      {!isAdmin && <>Registraste {a.tipo} con </>}
                      <span className="highlight">{a.lead?.nombre}</span>
                    </div>
                    <div className="feed-time">{timeAgo(a.fecha)}</div>
                  </div>
                </div>
              )
            }) : <div className="empty-state"><p>Sin actividad</p></div>}
          </div>
        </div>

        {isAdmin && vendorRanking.length > 0 ? (
          <div className="card">
            <div className="card-header"><h3>Ranking Vendedores</h3></div>
            <div className="card-body-flush">
              <table className="data-table">
                <thead><tr><th>#</th><th>Vendedor</th><th>Leads</th><th>Ventas</th><th>Conv.</th><th>Revenue</th></tr></thead>
                <tbody>
                  {vendorRanking.map((v, i) => (
                    <tr key={i}>
                      <td><span className={`leaderboard-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}`}>{i + 1}</span></td>
                      <td className="table-cell-primary">{v.name}</td>
                      <td>{v.leads}</td>
                      <td>{v.ventas}</td>
                      <td>{v.leads > 0 ? ((v.ventas / v.leads) * 100).toFixed(0) : 0}%</td>
                      <td>{fmt$(v.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : !isAdmin && (
          <div className="card">
            <div className="card-header"><h3>Mi Rendimiento</h3></div>
            <div className="card-body">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}>
                      {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="empty-state"><p>Sin datos</p></div>}
            </div>
          </div>
        )}
      </div>

      {/* Leads por Día (admin only) */}
      {isAdmin && (
        <div className="card leads-per-day-section">
          <div className="card-header">
            <h3><CalendarDays size={18} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />Leads por Día</h3>
            <div className="leads-per-day-controls">
              <div className="leads-per-day-stats">
                <span className="lpd-stat"><strong>{totalInRange}</strong> leads en {daysRange} días</span>
                <span className="lpd-stat">Promedio: <strong>{avgPerDay}</strong>/día</span>
                {bestDay.count > 0 && <span className="lpd-stat">Mejor día: <strong>{bestDay.date}</strong> ({bestDay.count})</span>}
              </div>
              <select className="filter-select" value={daysRange} onChange={e => setDaysRange(Number(e.target.value))}>
                <option value={7}>Últimos 7 días</option>
                <option value={14}>Últimos 14 días</option>
                <option value={30}>Últimos 30 días</option>
                <option value={60}>Últimos 60 días</option>
                <option value={90}>Últimos 90 días</option>
              </select>
            </div>
          </div>
          <div className="card-body">
            {/* Bar Chart */}
            <div className="leads-per-day-chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--gray-500)' }}
                    interval={daysRange <= 14 ? 0 : daysRange <= 30 ? 2 : 6}
                    angle={daysRange > 14 ? -45 : 0}
                    textAnchor={daysRange > 14 ? 'end' : 'middle'}
                    height={daysRange > 14 ? 50 : 30}
                  />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--gray-500)' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}
                    formatter={(value) => [`${value} leads`, 'Cantidad']}
                    labelFormatter={(label) => `Fecha: ${label}`}
                  />
                  <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Daily table */}
            <div className="leads-per-day-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Fecha</th>
                    <th>Total Leads</th>
                    <th>Nuevos</th>
                    <th>Contactados</th>
                    <th>En Negociación</th>
                    <th>Ventas</th>
                    <th>Perdidos</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsPerDay.filter(day => {
                    const cutoff = new Date()
                    cutoff.setDate(cutoff.getDate() - daysRange)
                    return new Date(day.sortKey) >= cutoff
                  }).map(day => {
                    const isExpanded = expandedDays[day.sortKey]
                    const statusCounts = {
                      nuevo: day.leads.filter(l => l.estado === 'nuevo').length,
                      contactado: day.leads.filter(l => l.estado === 'contactado').length,
                      en_negociacion: day.leads.filter(l => l.estado === 'en_negociacion').length,
                      venta_cerrada: day.leads.filter(l => l.estado === 'venta_cerrada').length,
                      perdido: day.leads.filter(l => l.estado === 'perdido').length,
                    }
                    return (
                      <React.Fragment key={day.sortKey}>
                        <tr className="lpd-day-row clickable" onClick={() => toggleDay(day.sortKey)}>
                          <td>
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </td>
                          <td className="table-cell-primary">{day.dateStr}</td>
                          <td><span className="lpd-total-badge">{day.count}</span></td>
                          <td>{statusCounts.nuevo > 0 ? <span className="badge badge-nuevo">{statusCounts.nuevo}</span> : <span className="text-muted">-</span>}</td>
                          <td>{statusCounts.contactado > 0 ? <span className="badge badge-contactado">{statusCounts.contactado}</span> : <span className="text-muted">-</span>}</td>
                          <td>{statusCounts.en_negociacion > 0 ? <span className="badge badge-en_negociacion">{statusCounts.en_negociacion}</span> : <span className="text-muted">-</span>}</td>
                          <td>{statusCounts.venta_cerrada > 0 ? <span className="badge badge-venta_cerrada">{statusCounts.venta_cerrada}</span> : <span className="text-muted">-</span>}</td>
                          <td>{statusCounts.perdido > 0 ? <span className="badge badge-perdido">{statusCounts.perdido}</span> : <span className="text-muted">-</span>}</td>
                        </tr>
                        {isExpanded && day.leads.map(l => (
                          <tr key={l.id} className="lpd-lead-row clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                            <td></td>
                            <td className="table-cell-secondary" style={{ paddingLeft: 24 }}>{l.nombre}</td>
                            <td>{l.telefono || '-'}</td>
                            <td>{l.modelo_interes || '-'}</td>
                            <td><span className={`badge badge-${l.estado}`}>{STATUS_LABELS[l.estado]}</span></td>
                            <td>{fmt$(l.presupuesto_estimado)}</td>
                            <td className="table-cell-secondary">{l.vendedor?.full_name || '-'}</td>
                            <td className="table-cell-secondary">{new Date(l.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                  {leadsPerDay.filter(day => {
                    const cutoff = new Date()
                    cutoff.setDate(cutoff.getDate() - daysRange)
                    return new Date(day.sortKey) >= cutoff
                  }).length === 0 && (
                    <tr><td colSpan={8}><div className="empty-state"><p>No hay leads en este período</p></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
