import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts'
import { Users, TrendingUp, Target, Award, DollarSign, Clock, Phone, AlertCircle, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const STATUS_COLORS = {
  nuevo: '#3B82F6',
  contactado: '#F59E0B',
  en_negociacion: '#8B5CF6',
  venta_cerrada: '#10B981',
  perdido: '#6B7280',
}

const STATUS_LABELS = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  en_negociacion: 'En Negociación',
  venta_cerrada: 'Venta Cerrada',
  perdido: 'Perdido',
}

const ORIGEN_LABELS = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  presencial: 'Presencial',
  referido: 'Referido',
  otro: 'Otro'
}

export default function DashboardPage() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [interacciones, setInteracciones] = useState([])

  useEffect(() => {
    fetchDashboardData()
  }, [])

  async function fetchDashboardData() {
    setLoading(true)
    try {
      let leadsQuery = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)')
      let intQuery = supabase.from('interacciones')
        .select('*, lead:leads!inner(id, nombre, apellido, modelo_interes), usuario:profiles!inner(full_name)')
        .order('created_at', { ascending: false })
      
      if (!isAdmin) {
        leadsQuery = leadsQuery.eq('vendedor_asignado', profile.id)
        intQuery = intQuery.eq('lead.vendedor_asignado', profile.id)
      }

      const [leadsRes, intRes] = await Promise.all([leadsQuery, intQuery])
      
      if (leadsRes.error) throw leadsRes.error
      if (intRes.error) throw intRes.error
      
      setLeads(leadsRes.data || [])
      setInteracciones(intRes.data || [])
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  
  const recentLeadsCount = leads.filter(l => new Date(l.created_at) >= sevenDaysAgo).length
  
  const ventasCerradasList = leads.filter(l => l.estado === 'venta_cerrada')
  const enNegociacionList = leads.filter(l => l.estado === 'en_negociacion')
  
  const totalLeads = leads.length
  const ventasCerradas = ventasCerradasList.length
  const enNegociacion = enNegociacionList.length
  const tasaConversion = totalLeads > 0 ? ((ventasCerradas / totalLeads) * 100).toFixed(1) : '0'

  const ventasCerradasRecent = ventasCerradasList.filter(l => new Date(l.created_at) >= sevenDaysAgo).length
  const enNegociacionRecent = enNegociacionList.filter(l => new Date(l.created_at) >= sevenDaysAgo).length

  const revenueValue = ventasCerradasList.reduce((acc, l) => acc + (Number(l.presupuesto_estimado) || 0), 0)
  const pipelineValue = enNegociacionList.reduce((acc, l) => acc + (Number(l.presupuesto_estimado) || 0), 0)

  const formatMoney = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val)

  const funnelSteps = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada']
  const funnelData = funnelSteps.map(step => ({
    status: step,
    count: leads.filter(l => l.estado === step).length
  }))
  const maxFunnelCount = Math.max(...funnelData.map(d => d.count), 1)

  const activeLeads = leads.filter(l => l.estado !== 'perdido' && l.estado !== 'venta_cerrada')
  
  const followupItems = activeLeads.map(lead => {
    const leadInteractions = interacciones.filter(i => i.lead_id === lead.id)
    if (leadInteractions.length === 0) {
      return { lead, days: null, noContact: true }
    }
    const latestInt = leadInteractions[0]
    const daysSince = Math.floor((now - new Date(latestInt.created_at)) / (1000 * 60 * 60 * 24))
    return { lead, days: daysSince, noContact: false }
  }).filter(item => item.noContact || item.days >= 7)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5)

  const recentActivities = interacciones.slice(0, 8)
  
  const statusData = Object.entries(
    leads.reduce((acc, lead) => {
      acc[lead.estado] = (acc[lead.estado] || 0) + 1
      return acc
    }, {})
  ).map(([estado, count]) => ({
    name: STATUS_LABELS[estado] || estado,
    value: count,
    color: STATUS_COLORS[estado] || '#888',
  }))

  const originData = Object.entries(
    leads.reduce((acc, lead) => {
      const orig = lead.origen || 'otro'
      acc[orig] = (acc[orig] || 0) + 1
      return acc
    }, {})
  ).map(([origen, count]) => ({
    name: ORIGEN_LABELS[origen] || origen,
    value: count
  })).sort((a, b) => b.value - a.value)

  const vendorMap = {}
  leads.forEach(l => {
    const vendorName = l.vendedor?.full_name || 'Sin asignar'
    if (!vendorMap[vendorName]) {
      vendorMap[vendorName] = { name: vendorName, total: 0, cerradas: 0, revenue: 0 }
    }
    vendorMap[vendorName].total += 1
    if (l.estado === 'venta_cerrada') {
      vendorMap[vendorName].cerradas += 1
      vendorMap[vendorName].revenue += (Number(l.presupuesto_estimado) || 0)
    }
  })
  
  const leaderboard = Object.values(vendorMap).map(v => ({
    ...v,
    conversion: v.total > 0 ? ((v.cerradas / v.total) * 100).toFixed(1) : '0'
  })).sort((a, b) => b.cerradas - a.cerradas)

  const timeAgo = (dateStr) => {
    const diff = Math.floor((new Date() - new Date(dateStr)) / 60000)
    if (diff < 60) return `Hace ${diff} min`
    const hours = Math.floor(diff / 60)
    if (hours < 24) return `Hace ${hours} hs`
    return `Hace ${Math.floor(hours / 24)} días`
  }

  const getActivityIcon = (tipo) => {
    switch (tipo) {
      case 'llamada': return <Phone size={16} />
      case 'whatsapp': return <Phone size={16} />
      case 'email': return <Clock size={16} />
      default: return <Clock size={16} />
    }
  }

  if (loading) {
    return (
      <div className="spinner-overlay">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-grid stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-card-icon blue">
            <Users size={22} />
          </div>
          <div className="stat-card-value">{totalLeads}</div>
          <div className="stat-card-label">Total de Leads</div>
          <div className="stat-card-trend">+{recentLeadsCount} esta semana</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon green">
            <Award size={22} />
          </div>
          <div className="stat-card-value">{ventasCerradas}</div>
          <div className="stat-card-label">Ventas Cerradas</div>
          <div className="stat-card-trend">+{ventasCerradasRecent} esta semana</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon purple">
            <Target size={22} />
          </div>
          <div className="stat-card-value">{enNegociacion}</div>
          <div className="stat-card-label">En Negociación</div>
          <div className="stat-card-trend">+{enNegociacionRecent} esta semana</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon orange">
            <TrendingUp size={22} />
          </div>
          <div className="stat-card-value">{tasaConversion}%</div>
          <div className="stat-card-label">Tasa de Conversión</div>
          <div className="stat-card-trend">-</div>
        </div>
      </div>

      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="revenue-cards" style={{ display: 'flex', gap: '1rem' }}>
            <div className="revenue-item stat-card" style={{ flex: 1 }}>
              <div className="stat-card-icon green"><DollarSign size={20} /></div>
              <div className="revenue-value stat-card-value">{formatMoney(revenueValue)}</div>
              <div className="revenue-label stat-card-label">Ingresos (Cerradas)</div>
            </div>
            <div className="revenue-item stat-card" style={{ flex: 1 }}>
              <div className="stat-card-icon purple"><TrendingUp size={20} /></div>
              <div className="revenue-value stat-card-value">{formatMoney(pipelineValue)}</div>
              <div className="revenue-label stat-card-label">Pipeline (En Negociación)</div>
            </div>
          </div>

          <div className="funnel-container" style={{ flex: 1, padding: '0 1rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>Embudo de Conversión</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {funnelData.map(step => {
                const widthPercent = maxFunnelCount > 0 ? (step.count / maxFunnelCount) * 100 : 0
                return (
                  <div key={step.status} className="funnel-step" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div className="funnel-label" style={{ width: '110px', fontSize: '0.85rem' }}>{STATUS_LABELS[step.status]}</div>
                    <div className="funnel-bar-track" style={{ flex: 1, height: '24px', backgroundColor: '#F3F4F6', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                      <div className="funnel-bar-fill" style={{ width: `${widthPercent}%`, height: '100%', backgroundColor: STATUS_COLORS[step.status], transition: 'width 0.5s ease' }}></div>
                    </div>
                    <div className="funnel-count" style={{ width: '40px', textAlign: 'right', fontWeight: 'bold' }}>{step.count}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.25rem' }}>
          <div>
            <h3 className="followup-alert" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={18} color="#EF4444" /> Requieren Seguimiento
            </h3>
            <div className="followup-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {followupItems.length > 0 ? followupItems.map((item, idx) => (
                <div key={idx} className="followup-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', backgroundColor: '#FEF2F2', borderRadius: '6px', border: '1px solid #FEE2E2' }}>
                  <div className="followup-info">
                    <div style={{ fontWeight: 'bold', color: '#991B1B' }}>{item.lead.nombre} {item.lead.apellido}</div>
                    <div style={{ fontSize: '0.85rem', color: '#B91C1C' }}>{item.lead.modelo_interes || 'Sin modelo'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="followup-days" style={{ fontSize: '0.85rem', color: '#991B1B', fontWeight: '600' }}>
                      {item.noContact ? 'Sin contacto' : `Hace ${item.days} días`}
                    </span>
                    <button onClick={() => navigate(`/leads/${item.lead.id}`)} style={{ background: 'white', border: '1px solid #FECACA', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#991B1B' }}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )) : (
                <p style={{ color: '#6B7280', fontSize: '0.9rem' }}>Todos los leads activos están al día.</p>
              )}
            </div>
          </div>

          <div>
            <h3 style={{ marginBottom: '1rem' }}>Actividad Reciente</h3>
            <div className="activity-feed" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {recentActivities.map(act => (
                <div key={act.id} className="activity-item" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', paddingBottom: '0.75rem', borderBottom: '1px solid #F3F4F6' }}>
                  <div className="activity-icon" style={{ padding: '0.5rem', backgroundColor: '#F3F4F6', borderRadius: '50%', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {getActivityIcon(act.tipo)}
                  </div>
                  <div className="activity-info" style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.9rem' }}>
                      <strong>{act.usuario?.full_name}</strong> {act.tipo === 'nota' ? 'agregó una nota en' : `registró ${act.tipo} con`} <span className="activity-lead-name" style={{ fontWeight: '500', color: '#2563EB' }}>{act.lead?.nombre} {act.lead?.apellido}</span>
                    </div>
                    <div className="activity-time" style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '0.2rem' }}>
                      {timeAgo(act.created_at)}
                    </div>
                  </div>
                </div>
              ))}
              {recentActivities.length === 0 && (
                <p style={{ color: '#6B7280', fontSize: '0.9rem' }}>No hay actividad reciente.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="charts-grid dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h3>Leads por Estado</h3>
          </div>
          <div className="card-body">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                    {statusData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="empty-state"><p>No hay datos</p></div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Leads por Origen</h3>
          </div>
          <div className="card-body">
            {originData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={originData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} name="Leads" barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="empty-state"><p>No hay datos</p></div>}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="card-header">
            <h3>Rendimiento por Vendedor</h3>
          </div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            <table className="leaderboard-table data-table" style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', color: '#374151', fontWeight: '600' }}>Vendedor</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#374151', fontWeight: '600' }}>Total Leads</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#374151', fontWeight: '600' }}>Ventas Cerradas</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#374151', fontWeight: '600' }}>Tasa Conversión</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#374151', fontWeight: '600' }}>Ingresos Estimados</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((v, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: '500' }}>{v.name}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{v.total}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ backgroundColor: '#D1FAE5', color: '#065F46', padding: '0.2rem 0.5rem', borderRadius: '1rem', fontSize: '0.85rem', fontWeight: '600' }}>
                        {v.cerradas}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>{v.conversion}%</td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#10B981' }}>{formatMoney(v.revenue)}</td>
                  </tr>
                ))}
                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ padding: '1.5rem', textAlign: 'center', color: '#6B7280' }}>
                      No hay datos disponibles.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
