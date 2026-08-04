import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Users, TrendingUp, Target, Award, DollarSign, ChevronRight, Phone, MessageCircle } from 'lucide-react'
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, timeAgo, formatCurrency } from '../lib/utils'

const TIPO_ICONS = { llamada: Phone, whatsapp: MessageCircle }

export default function DashboardPage() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [interacciones, setInteracciones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    try {
      let lq = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)')
      // IMPORTANTE: No limitar interacciones aqui, se usan para calcular seguimientos pendientes
      // El limite se aplica solo al feed de actividad reciente
      let iq = supabase.from('interacciones')
        .select('*, lead:leads!lead_id(id, nombre, modelo_interes), usuario:profiles!usuario_id(full_name)')
        .order('fecha', { ascending: false })

      if (!isAdmin) {
        lq = lq.eq('vendedor_asignado', profile.id)
        iq = iq.eq('usuario_id', profile.id)
      }

      const [lr, ir] = await Promise.all([lq, iq])
      setLeads(lr.data || [])
      // Limitar a 10 solo para el feed de actividad reciente en la UI
      setInteracciones((ir.data || []).slice(0, 10))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const stats = useMemo(() => {
    const total = leads.length
    const ventas = leads.filter(l => l.estado === 'venta_cerrada').length
    const negociacion = leads.filter(l => l.estado === 'en_negociacion').length
    const conversion = total > 0 ? ((ventas / total) * 100).toFixed(1) : '0'
    const revenue = leads.filter(l => l.estado === 'venta_cerrada').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    const pipeline = leads.filter(l => l.estado === 'en_negociacion').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    const week = new Date(Date.now() - 7 * 86400000)
    const nuevosEstaSemana = leads.filter(l => new Date(l.created_at) >= week).length
    return { total, ventas, negociacion, conversion, revenue, pipeline, nuevosEstaSemana }
  }, [leads])

  const pieData = useMemo(() =>
    Object.entries(leads.reduce((a, l) => { a[l.estado] = (a[l.estado] || 0) + 1; return a }, {}))
      .map(([k, v]) => ({ name: LEAD_STATUS_LABELS[k], value: v, color: LEAD_STATUS_COLORS[k] })),
    [leads])

  const followups = useMemo(() => {
    const activos = leads.filter(l => !['venta_cerrada', 'perdido'].includes(l.estado))
    const lastInt = {}
    interacciones.forEach(i => {
      if (!lastInt[i.lead_id] || new Date(i.fecha) > new Date(lastInt[i.lead_id])) lastInt[i.lead_id] = i.fecha
    })
    const sevenAgo = Date.now() - 7 * 86400000
    return activos
      .filter(l => !lastInt[l.id] || new Date(lastInt[l.id]).getTime() < sevenAgo)
      .map(l => ({ ...l, days: lastInt[l.id] ? Math.floor((Date.now() - new Date(lastInt[l.id])) / 86400000) : null }))
      .sort((a, b) => (a.days === null ? -1 : b.days === null ? 1 : b.days - a.days))
      .slice(0, 5)
  }, [leads, interacciones])

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

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* KPIs */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Users size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total Leads</div>
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
          <div className="stat-card-trend neutral">{formatCurrency(stats.pipeline)} pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><DollarSign size={20} /></div></div>
          <div className="stat-card-value">{formatCurrency(stats.revenue)}</div>
          <div className="stat-card-label">Revenue Total</div>
        </div>
      </div>

      {/* Charts + Followups */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Leads por Estado</h3></div>
          <div className="card-body">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}>
                    {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="empty-state"><p>Sin datos</p></div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Requieren Seguimiento</h3></div>
          <div className="card-body">
            {followups.length > 0 ? followups.map(l => (
              <div key={l.id} className="followup-item" onClick={() => navigate(`/leads/${l.id}`)}>
                <div className="followup-dot" />
                <div className="followup-info">
                  <div className="followup-name">{l.nombre}</div>
                  <div className="followup-sub">{l.modelo_interes || 'Sin modelo'}</div>
                </div>
                <span className="followup-badge">{l.days === null ? 'Sin contacto' : `${l.days}d sin contacto`}</span>
                <ChevronRight size={16} className="followup-arrow" />
              </div>
            )) : <div className="empty-state"><p>Todos al día ✓</p></div>}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Actividad Reciente</h3></div>
          <div className="card-body">
            {interacciones.length > 0 ? interacciones.slice(0, 8).map(a => {
              const Icon = TIPO_ICONS[a.tipo] || Phone
              return (
                <div key={a.id} className="feed-item">
                  <div className="feed-icon"><Icon size={14} /></div>
                  <div className="feed-body">
                    <div className="feed-text">
                      <strong>{a.usuario?.full_name}</strong> registró {a.tipo} con <span className="highlight">{a.lead?.nombre}</span>
                    </div>
                    <div className="feed-time">{timeAgo(a.fecha)}</div>
                  </div>
                </div>
              )
            }) : <div className="empty-state"><p>Sin actividad</p></div>}
          </div>
        </div>

        {/* Vendor Ranking (admin) */}
        {isAdmin && vendorRanking.length > 0 && (
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
                      <td>{formatCurrency(v.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
