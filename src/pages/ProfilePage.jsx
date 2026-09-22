import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useToast } from '../contexts/ToastContext'
import {
  Phone, MessageCircle, Mail, MapPin, Target, Award, TrendingUp, Calendar,
  Users, Clock, Plus, ChevronRight, Flame, Zap, AlertTriangle,
  BarChart3, UserCheck, Eye, ArrowUpRight, CheckCircle, Sun, Moon, Monitor, Rows3, Rows4
} from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const STATUS_COLORS = { nuevo: '#2563EB', contactado: '#D97706', en_negociacion: '#7C3AED', venta_cerrada: '#16A34A', perdido: '#71717A' }
const ORIGEN_LABELS = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', presencial: 'Presencial', referido: 'Referido', otro: 'Otro' }

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '$0' }
function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000)
  if (s < 60) return 'Ahora'
  if (s < 3600) return `Hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} hs`
  return `Hace ${Math.floor(s / 86400)} días`
}
function getWaLink(ph) { if (!ph) return null; const c = ph.replace(/\D/g, ''); return 'https://wa.me/' + (c.startsWith('54') ? c : '54' + c) }

export default function ProfilePage() {
  const navigate = useNavigate()
  const { user, profile, isAdmin } = useAuth()
  const { mode, setMode, density, setDensity } = useTheme()
  const { addToast } = useToast()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState(null)
  const [leads, setLeads] = useState([])
  const [interacciones, setInteracciones] = useState([])
  const [vendedores, setVendedores] = useState([])

  useEffect(() => {
    if (profile?.id) fetchAllData(isAdmin)
  }, [profile, isAdmin])

  async function fetchAllData(admin) {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const weekAgo = new Date(Date.now() - 7 * 86400000)

      // Leads query
      let leadsQuery = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(id, full_name)')
      if (!admin) leadsQuery = leadsQuery.eq('vendedor_asignado', profile.id)

      // Interacciones query
      let intQuery = supabase.from('interacciones')
        .select('*, lead:leads!lead_id(id, nombre, modelo_interes)')
        .order('fecha', { ascending: false }).limit(20)
      if (!admin) intQuery = intQuery.eq('usuario_id', profile.id)

      const promises = [leadsQuery, intQuery]
      if (admin) {
        promises.push(supabase.from('profiles').select('id, full_name, role').order('full_name'))
      }

      const results = await Promise.all(promises)
      const allLeads = results[0].data || []
      const allInts = results[1].data || []
      const allVendedores = admin ? (results[2].data || []) : []

      setLeads(allLeads)
      setInteracciones(allInts)
      setVendedores(allVendedores.filter(v => v.role === 'empleado'))

      // Compute stats
      const leadsHoy = allLeads.filter(l => l.created_at && new Date(l.created_at) >= today).length
      const leadsEstaSemana = allLeads.filter(l => l.created_at && new Date(l.created_at) >= weekAgo).length
      const ventas = allLeads.filter(l => l.estado === 'venta_cerrada')
      const revenue = ventas.reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
      const activos = allLeads.filter(l => !['venta_cerrada', 'perdido'].includes(l.estado))

      // Per-status counts
      const porEstado = {}
      Object.keys(STATUS_LABELS).forEach(e => { porEstado[e] = allLeads.filter(l => l.estado === e).length })

      // Per-origin counts
      const porOrigen = {}
      allLeads.forEach(l => {
        const o = l.origen || 'otro'
        porOrigen[o] = (porOrigen[o] || 0) + 1
      })

      // Upcoming agenda
      const now = new Date()
      const proxAgenda = allLeads
        .filter(l => l.fecha_agenda && new Date(l.fecha_agenda) >= now && l.estado !== 'venta_cerrada' && l.estado !== 'perdido')
        .sort((a, b) => new Date(a.fecha_agenda) - new Date(b.fecha_agenda))
        .slice(0, 5)

      // Leads sin contactar (> 48hs sin interacción)
      const sinContactar = activos.filter(l => {
        const created = new Date(l.created_at).getTime()
        const lastInt = allInts.find(i => i.lead_id === l.id)
        const lastContact = lastInt ? new Date(lastInt.fecha).getTime() : created
        return (Date.now() - lastContact) > 48 * 3600000
      }).length

      // Per-vendor stats (admin only)
      const vendedorStats = admin ? allVendedores.filter(v => v.role === 'empleado').map(v => {
        const vLeads = allLeads.filter(l => l.vendedor_asignado === v.id)
        const vVentas = vLeads.filter(l => l.estado === 'venta_cerrada').length
        const vHoy = vLeads.filter(l => l.created_at && new Date(l.created_at) >= today).length
        const vActivos = vLeads.filter(l => !['venta_cerrada', 'perdido'].includes(l.estado)).length
        return { ...v, total: vLeads.length, ventas: vVentas, hoy: vHoy, activos: vActivos }
      }) : []

      setStats({
        total: allLeads.length,
        leadsHoy,
        leadsEstaSemana,
        ventas: ventas.length,
        revenue,
        activos: activos.length,
        porEstado,
        porOrigen,
        proxAgenda,
        sinContactar,
        vendedorStats,
        conversion: allLeads.length > 0 ? ((ventas.length / allLeads.length) * 100).toFixed(1) : '0',
        llamadas: allInts.filter(i => i.tipo === 'llamada').length,
        whatsapp: allInts.filter(i => i.tipo === 'whatsapp').length,
        emails: allInts.filter(i => i.tipo === 'email').length,
        visitas: allInts.filter(i => i.tipo === 'visita').length,
        totalInt: allInts.length,
      })
    } catch (e) { console.error(e) }
  }

  function getInitials(name) {
    return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?'
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (newPassword !== confirmPassword) { addToast('Las contraseñas no coinciden', 'error'); return }
    if (newPassword.length < 6) { addToast('Mínimo 6 caracteres', 'error'); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      addToast('Contraseña actualizada', 'success')
      setNewPassword(''); setConfirmPassword('')
    } catch (err) { addToast(err.message || 'Error', 'error') }
    finally { setSaving(false) }
  }

  const maxEstado = stats ? Math.max(...Object.values(stats.porEstado), 1) : 1

  return (
    <div>
      {/* ═══════════════════ ADMIN VIEW ═══════════════════ */}
      {isAdmin && stats && (
        <>
          {/* Admin Main Stats */}
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon red"><Users size={20} /></div></div>
              <div className="stat-card-value">{stats.total}</div>
              <div className="stat-card-label">Total Leads</div>
              <div className="stat-card-trend neutral">+{stats.leadsEstaSemana} esta semana</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon blue"><Calendar size={20} /></div></div>
              <div className="stat-card-value">{stats.leadsHoy}</div>
              <div className="stat-card-label">Leads Ingresados Hoy</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon green"><Award size={20} /></div></div>
              <div className="stat-card-value">{stats.ventas}</div>
              <div className="stat-card-label">Ventas Totales</div>
              <div className="stat-card-trend up">{stats.conversion}% conversión</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon purple"><TrendingUp size={20} /></div></div>
              <div className="stat-card-value">{fmt$(stats.revenue)}</div>
              <div className="stat-card-label">Revenue Total</div>
            </div>
          </div>

          {/* Admin: Pipeline + Team Overview */}
          <div className="grid-2" style={{ marginBottom: 20 }}>
            {/* Pipeline por Estado */}
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChart3 size={16} style={{ color: '#DC2626' }} />
                  <h3 style={{ margin: 0 }}>Pipeline General</h3>
                </div>
              </div>
              <div className="card-body">
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8125rem' }}>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      <span style={{ fontWeight: 700, color: STATUS_COLORS[key] }}>{stats.porEstado[key]}</span>
                    </div>
                    <div style={{ background: 'var(--gray-100)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${(stats.porEstado[key] / maxEstado) * 100}%`, height: '100%', background: STATUS_COLORS[key], borderRadius: 99, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                ))}

                {/* Origen breakdown */}
                <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12, marginTop: 16 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-500)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Origen de Leads</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(stats.porOrigen).sort((a, b) => b[1] - a[1]).map(([origen, count]) => (
                      <span key={origen} className="badge" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563EB', fontSize: '0.75rem' }}>
                        {ORIGEN_LABELS[origen] || origen}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Rendimiento del Equipo */}
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <UserCheck size={16} style={{ color: '#DC2626' }} />
                  <h3 style={{ margin: 0 }}>Rendimiento del Equipo</h3>
                </div>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {stats.vendedorStats.length === 0 ? (
                  <div className="empty-state" style={{ padding: 24 }}><p>No hay vendedores registrados</p></div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Vendedor</th>
                        <th style={{ textAlign: 'center' }}>Hoy</th>
                        <th style={{ textAlign: 'center' }}>Activos</th>
                        <th style={{ textAlign: 'center' }}>Ventas</th>
                        <th style={{ textAlign: 'center' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.vendedorStats.map(v => (
                        <tr key={v.id}>
                          <td className="table-cell-primary" style={{ fontWeight: 600 }}>{v.full_name}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="badge" style={{ background: v.hoy > 0 ? 'rgba(22,163,74,0.1)' : 'var(--gray-100)', color: v.hoy > 0 ? '#16A34A' : 'var(--gray-500)', fontWeight: 700 }}>
                              {v.hoy}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{v.activos}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="badge" style={{ background: 'rgba(22,163,74,0.1)', color: '#16A34A', fontWeight: 700 }}>{v.ventas}</span>
                          </td>
                          <td style={{ textAlign: 'center', color: 'var(--gray-500)' }}>{v.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════ VENDOR VIEW ═══════════════════ */}
      {!isAdmin && stats && (
        <>
          {/* Vendor Main Stats */}
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon red"><Target size={20} /></div></div>
              <div className="stat-card-value">{stats.activos}</div>
              <div className="stat-card-label">Leads Activos</div>
              <div className="stat-card-trend neutral">+{stats.leadsHoy} hoy</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon green"><Award size={20} /></div></div>
              <div className="stat-card-value">{stats.ventas}</div>
              <div className="stat-card-label">Mis Ventas</div>
              <div className="stat-card-trend up">{stats.conversion}% conversión</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon blue"><TrendingUp size={20} /></div></div>
              <div className="stat-card-value">{fmt$(stats.revenue)}</div>
              <div className="stat-card-label">Mi Revenue</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header"><div className="stat-card-icon" style={{ background: stats.sinContactar > 0 ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)' }}>{stats.sinContactar > 0 ? <AlertTriangle size={20} style={{ color: '#DC2626' }} /> : <CheckCircle size={20} style={{ color: '#16A34A' }} />}</div></div>
              <div className="stat-card-value" style={{ color: stats.sinContactar > 0 ? '#DC2626' : '#16A34A' }}>{stats.sinContactar}</div>
              <div className="stat-card-label">{stats.sinContactar > 0 ? 'Requieren Atención' : 'Todo al Día'}</div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>Acciones Rápidas</span>
                <button className="btn btn-primary btn-sm" onClick={() => navigate('/leads')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={14} /> Nuevo Lead
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/leads')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Eye size={14} /> Ver Mis Leads
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/agenda')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Calendar size={14} /> Mi Agenda
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <BarChart3 size={14} /> Dashboard
                </button>
              </div>
            </div>
          </div>

          {/* Vendor: Pipeline + Agenda + Activity */}
          <div className="grid-2" style={{ marginBottom: 20 }}>
            {/* Mini Pipeline */}
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChart3 size={16} style={{ color: '#DC2626' }} />
                  <h3 style={{ margin: 0 }}>Mi Pipeline</h3>
                </div>
              </div>
              <div className="card-body">
                {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'perdido').map(([key, label]) => (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: '0.8125rem' }}>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      <span style={{ fontWeight: 700, color: STATUS_COLORS[key] }}>{stats.porEstado[key]}</span>
                    </div>
                    <div style={{ background: 'var(--gray-100)', borderRadius: 99, height: 7, overflow: 'hidden' }}>
                      <div style={{ width: `${(stats.porEstado[key] / maxEstado) * 100}%`, height: '100%', background: STATUS_COLORS[key], borderRadius: 99, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Próximas Citas */}
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={16} style={{ color: '#2563EB' }} />
                    <h3 style={{ margin: 0 }}>Próximas Citas</h3>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate('/agenda')} style={{ fontSize: '0.75rem', color: '#2563EB' }}>
                    Ver Agenda <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              <div className="card-body" style={{ padding: stats.proxAgenda.length > 0 ? 0 : undefined }}>
                {stats.proxAgenda.length === 0 ? (
                  <div className="empty-state" style={{ padding: '16px 0' }}>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--gray-500)' }}>No tenés citas programadas</p>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate('/agenda')} style={{ marginTop: 8 }}>
                      <Plus size={14} /> Agendar
                    </button>
                  </div>
                ) : (
                  <div>
                    {stats.proxAgenda.map(l => {
                      const fecha = new Date(l.fecha_agenda)
                      const esHoy = fecha.toDateString() === new Date().toDateString()
                      return (
                        <div key={l.id} onClick={() => navigate(`/leads/${l.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', cursor: 'pointer', transition: 'background 0.15s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ minWidth: 44, textAlign: 'center', background: esHoy ? 'rgba(220,38,38,0.1)' : 'var(--gray-100)', borderRadius: 8, padding: '4px 8px' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: esHoy ? '#DC2626' : 'var(--gray-500)', textTransform: 'uppercase' }}>
                              {esHoy ? 'HOY' : fecha.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                            </div>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 800, color: esHoy ? '#DC2626' : 'var(--text-primary)' }}>
                              {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nombre}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{l.modelo_interes || 'Sin modelo'}</div>
                          </div>
                          {l.telefono && (
                            <a href={getWaLink(l.telefono)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#25D366', padding: 4 }} title="WhatsApp">
                              <MessageCircle size={16} />
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Vendor: Recent Activity + Performance */}
          <div className="grid-2" style={{ marginBottom: 20 }}>
            {/* Actividad Reciente */}
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={16} style={{ color: '#7C3AED' }} />
                  <h3 style={{ margin: 0 }}>Mi Actividad Reciente</h3>
                </div>
              </div>
              <div className="card-body" style={{ padding: interacciones.length > 0 ? 0 : undefined }}>
                {interacciones.length === 0 ? (
                  <div className="empty-state" style={{ padding: '16px 0' }}>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--gray-500)' }}>Sin actividad registrada todavía</p>
                  </div>
                ) : (
                  <div>
                    {interacciones.slice(0, 8).map(i => {
                      const Icon = i.tipo === 'llamada' ? Phone : i.tipo === 'whatsapp' ? MessageCircle : i.tipo === 'email' ? Mail : i.tipo === 'visita' ? MapPin : Zap
                      const color = i.tipo === 'llamada' ? '#2563EB' : i.tipo === 'whatsapp' ? '#25D366' : i.tipo === 'email' ? '#D97706' : '#7C3AED'
                      return (
                        <div key={i.id} onClick={() => i.lead?.id && navigate(`/leads/${i.lead.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: '1px solid var(--gray-100)', cursor: i.lead?.id ? 'pointer' : 'default' }} onMouseEnter={e => { if (i.lead?.id) e.currentTarget.style.background = 'var(--gray-50)' }} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Icon size={14} style={{ color }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {i.lead?.nombre || 'Lead'} {i.lead?.modelo_interes ? `· ${i.lead.modelo_interes}` : ''}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {i.detalle || `${i.tipo} registrado`}
                            </div>
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>{timeAgo(i.fecha)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Performance Breakdown */}
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Flame size={16} style={{ color: '#DC2626' }} />
                  <h3 style={{ margin: 0 }}>Mi Rendimiento</h3>
                </div>
              </div>
              <div className="card-body">
                <div className="detail-row"><div className="detail-label"><Target size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Leads Totales</div><div className="detail-value" style={{ fontWeight: 700 }}>{stats.total}</div></div>
                <div className="detail-row"><div className="detail-label"><Zap size={14} style={{ marginRight: 6, verticalAlign: 'middle', color: '#2563EB' }} />Nuevos Hoy</div><div className="detail-value" style={{ fontWeight: 700, color: '#2563EB' }}>{stats.leadsHoy}</div></div>
                <div className="detail-row"><div className="detail-label"><Zap size={14} style={{ marginRight: 6, verticalAlign: 'middle', color: '#7C3AED' }} />Esta Semana</div><div className="detail-value" style={{ fontWeight: 700, color: '#7C3AED' }}>{stats.leadsEstaSemana}</div></div>
                <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 10, marginTop: 6 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Contactos Realizados</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ background: 'rgba(37,99,235,0.06)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                      <Phone size={14} style={{ color: '#2563EB', marginBottom: 2 }} />
                      <div style={{ fontSize: '1.125rem', fontWeight: 800 }}>{stats.llamadas}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--gray-500)' }}>Llamadas</div>
                    </div>
                    <div style={{ background: 'rgba(37,211,102,0.06)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                      <MessageCircle size={14} style={{ color: '#25D366', marginBottom: 2 }} />
                      <div style={{ fontSize: '1.125rem', fontWeight: 800 }}>{stats.whatsapp}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--gray-500)' }}>WhatsApp</div>
                    </div>
                    <div style={{ background: 'rgba(217,119,6,0.06)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                      <Mail size={14} style={{ color: '#D97706', marginBottom: 2 }} />
                      <div style={{ fontSize: '1.125rem', fontWeight: 800 }}>{stats.emails}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--gray-500)' }}>Emails</div>
                    </div>
                    <div style={{ background: 'rgba(124,58,237,0.06)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                      <MapPin size={14} style={{ color: '#7C3AED', marginBottom: 2 }} />
                      <div style={{ fontSize: '1.125rem', fontWeight: 800 }}>{stats.visitas}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--gray-500)' }}>Visitas</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════ COMMON: Profile + Password ═══════════════════ */}
      <div className="profile-grid">
        {/* Profile Info */}
        <div className="card">
          <div className="card-header"><h3>Información Personal</h3></div>
          <div className="card-body">
            <div className="profile-avatar-lg">{getInitials(profile?.full_name)}</div>
            <div className="detail-row"><div className="detail-label">Nombre Completo</div><div className="detail-value">{profile?.full_name || '-'}</div></div>
            <div className="detail-row"><div className="detail-label">DNI</div><div className="detail-value">{profile?.dni || '-'}<div className="form-hint">El DNI no puede modificarse</div></div></div>
            <div className="detail-row"><div className="detail-label">Rol</div><div className="detail-value"><span className={`badge badge-${profile?.role}`}>{profile?.role === 'admin' ? 'Administrador' : 'Vendedor'}</span></div></div>
            <div className="detail-row"><div className="detail-label">Miembro desde</div><div className="detail-value">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'}</div></div>
          </div>
        </div>

        <div>
          {/* Change Password */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><h3>Cambiar Contraseña</h3></div>
            <div className="card-body">
              <form onSubmit={handleChangePassword}>
                <div className="form-group">
                  <label className="form-label">Nueva Contraseña</label>
                  <input className="form-input" type="password" placeholder="Mínimo 6 caracteres" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirmar Contraseña</label>
                  <input className="form-input" type="password" placeholder="Repetí la contraseña" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} />
                </div>
                <button type="submit" className="btn btn-primary btn-full" disabled={saving}>{saving ? 'Guardando...' : 'Actualizar Contraseña'}</button>
              </form>
            </div>
          </div>

          {/* Apariencia — se guarda en este navegador, no toca la base */}
          <div className="card">
            <div className="card-header"><h3>Apariencia</h3></div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Tema</label>
                <div className="segmented-filters">
                  <button type="button" className={`segmented-filter-btn ${mode === 'light' ? 'active' : ''}`} onClick={() => setMode('light')}>
                    <Sun size={14} /> Claro
                  </button>
                  <button type="button" className={`segmented-filter-btn ${mode === 'dark' ? 'active' : ''}`} onClick={() => setMode('dark')}>
                    <Moon size={14} /> Oscuro
                  </button>
                  <button type="button" className={`segmented-filter-btn ${mode === 'auto' ? 'active' : ''}`} onClick={() => setMode('auto')}>
                    <Monitor size={14} /> Automático
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Densidad de la interfaz</label>
                <div className="segmented-filters">
                  <button type="button" className={`segmented-filter-btn ${density === 'comfortable' ? 'active' : ''}`} onClick={() => setDensity('comfortable')}>
                    <Rows3 size={14} /> Cómoda
                  </button>
                  <button type="button" className={`segmented-filter-btn ${density === 'compact' ? 'active' : ''}`} onClick={() => setDensity('compact')}>
                    <Rows4 size={14} /> Compacta
                  </button>
                </div>
                <div className="form-hint">La densidad compacta muestra más filas por pantalla, ideal para monitores chicos.</div>
              </div>

              <div className="form-hint" style={{ marginTop: 4 }}>
                Estas preferencias se guardan sólo en este dispositivo.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
