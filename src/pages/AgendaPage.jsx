import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Calendar, Clock, Phone, MessageCircle, ChevronLeft, ChevronRight, User, CheckCircle, AlertCircle } from 'lucide-react'

// Helpers
function getWaLink(phone) {
  if (!phone) return '#';
  const cleanPhone = phone.replace(/\D/g, '');
  return `https://wa.me/${cleanPhone}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7; 
  if (day !== 1) {
    d.setHours(-24 * (day - 1));
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDates(offset) {
  const now = new Date();
  now.setDate(now.getDate() + offset * 7);
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function isToday(dateStr) {
  const date = new Date(dateStr);
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}

function isPast(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  return date < now && !isToday(dateStr);
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'nuevo': return 'badge-nuevo';
    case 'contactado': return 'badge-contactado';
    case 'en_negociacion': return 'badge-en_negociacion';
    case 'venta_cerrada': return 'badge-venta_cerrada';
    case 'perdido': return 'badge-perdido';
    default: return 'badge-nuevo';
  }
}

function formatStatus(status) {
  return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export default function AgendaPage() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [leads, setLeads] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterVendor, setFilterVendor] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  
  const [sinAgendarCount, setSinAgendarCount] = useState(0)

  useEffect(() => {
    fetchAgenda()
  }, [profile, isAdmin])

  const fetchAgenda = async () => {
    try {
      setLoading(true)
      
      let query = supabase
        .from('leads')
        .select('*, vendedor:profiles!vendedor_asignado(id, full_name)')
        .not('fecha_agenda', 'is', null)
        .order('fecha_agenda', { ascending: true })
        
      if (!isAdmin && profile) {
        query = query.eq('vendedor_asignado', profile.id)
      }
      
      const { data: leadsData, error: leadsError } = await query
      if (leadsError) throw leadsError
      
      setLeads(leadsData || [])
      
      let sinAgendarQuery = supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .is('fecha_agenda', null)
        
      if (!isAdmin && profile) {
        sinAgendarQuery = sinAgendarQuery.eq('vendedor_asignado', profile.id)
      }
      
      const { count: sinAgendar } = await sinAgendarQuery
      setSinAgendarCount(sinAgendar || 0)
      
      if (isAdmin) {
        const { data: vends } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('role', ['empleado', 'admin'])
        setVendedores(vends || [])
      }
      
    } catch (error) {
      console.error('Error fetching agenda:', error)
    } finally {
      setLoading(false)
    }
  }

  const stats = leads.reduce((acc, lead) => {
    const d = new Date(lead.fecha_agenda);
    const { start: currentWeekStart, end: currentWeekEnd } = getWeekDates(0);
    
    if (isToday(lead.fecha_agenda)) acc.hoy++;
    if (d >= currentWeekStart && d <= currentWeekEnd) acc.estaSemana++;
    if (isPast(lead.fecha_agenda) && lead.estado !== 'venta_cerrada' && lead.estado !== 'perdido') {
      acc.pendientes++;
    }
    
    return acc;
  }, { hoy: 0, estaSemana: 0, pendientes: 0 })

  const { start, end } = getWeekDates(weekOffset)
  
  const filteredLeads = leads.filter(lead => {
    const d = new Date(lead.fecha_agenda)
    const inWeek = d >= start && d <= end
    
    if (!inWeek) return false
    if (filterVendor && lead.vendedor_asignado !== filterVendor) return false
    if (filterStatus && lead.estado !== filterStatus) return false
    
    return true
  })
  
  const groupedLeads = filteredLeads.reduce((acc, lead) => {
    const dateStr = new Date(lead.fecha_agenda).toISOString().split('T')[0]
    if (!acc[dateStr]) acc[dateStr] = []
    acc[dateStr].push(lead)
    return acc
  }, {})
  
  const sortedDates = Object.keys(groupedLeads).sort()

  const formatDateLabel = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00'); // Force local midday to avoid timezone shifts
    return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  if (loading) {
    return (
      <div className="spinner-overlay">
        <div className="spinner"></div>
      </div>
    )
  }

  const startFormatted = start.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
  const endFormatted = end.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header">
            <h3 className="stat-card-label">Hoy</h3>
            <div className="stat-card-icon" style={{color: 'var(--color-primary)'}}>
              <Calendar size={20} />
            </div>
          </div>
          <p className="stat-card-value">{stats.hoy}</p>
        </div>
        
        <div className="stat-card">
          <div className="stat-card-header">
            <h3 className="stat-card-label">Esta Semana</h3>
            <div className="stat-card-icon" style={{color: 'var(--color-success)'}}>
              <CheckCircle size={20} />
            </div>
          </div>
          <p className="stat-card-value">{stats.estaSemana}</p>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <h3 className="stat-card-label">Pendientes</h3>
            <div className="stat-card-icon" style={{color: 'var(--color-danger)'}}>
              <AlertCircle size={20} />
            </div>
          </div>
          <p className="stat-card-value">{stats.pendientes}</p>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <h3 className="stat-card-label">Sin Agendar</h3>
            <div className="stat-card-icon" style={{color: 'var(--color-warning)'}}>
              <Clock size={20} />
            </div>
          </div>
          <p className="stat-card-value">{sinAgendarCount}</p>
        </div>
      </div>

      <div className="filters-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn btn-icon" onClick={() => setWeekOffset(prev => prev - 1)}>
            <ChevronLeft size={20} />
          </button>
          <span style={{ fontWeight: '500' }}>
            Semana del {startFormatted} al {endFormatted}
          </span>
          <button className="btn btn-icon" onClick={() => setWeekOffset(prev => prev + 1)}>
            <ChevronRight size={20} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(0)}>
            Hoy
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {isAdmin && (
            <select 
              className="filter-select"
              value={filterVendor}
              onChange={e => setFilterVendor(e.target.value)}
            >
              <option value="">Todos los vendedores</option>
              {vendedores.map(v => (
                <option key={v.id} value={v.id}>{v.full_name}</option>
              ))}
            </select>
          )}

          <select 
            className="filter-select"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="nuevo">Nuevo</option>
            <option value="contactado">Contactado</option>
            <option value="en_negociacion">En Negociación</option>
            <option value="venta_cerrada">Venta Cerrada</option>
            <option value="perdido">Perdido</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Agenda</h2>
        </div>
        <div className="card-body card-body-flush">
          {sortedDates.length === 0 ? (
            <div className="empty-state">
              <Calendar size={48} style={{color: 'var(--color-neutral-400)', marginBottom: '1rem'}} />
              <h3>No hay leads agendados</h3>
              <p>No se encontraron eventos para esta semana con los filtros actuales.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Nombre del Lead</th>
                  <th>Modelo</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  {isAdmin && <th>Vendedor</th>}
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sortedDates.map(dateStr => {
                  const dateLeads = groupedLeads[dateStr]
                  const isTodayHeader = isToday(dateStr + 'T12:00:00')
                  
                  return (
                    <React.Fragment key={dateStr}>
                      <tr>
                        <td 
                          colSpan={isAdmin ? 7 : 6} 
                          className={isTodayHeader ? 'table-cell-primary' : 'table-cell-secondary'}
                          style={{ fontWeight: '600', backgroundColor: isTodayHeader ? 'var(--color-primary-light)' : 'var(--color-neutral-50)', textTransform: 'capitalize' }}
                        >
                          {formatDateLabel(dateStr)} {isTodayHeader && '(Hoy)'}
                        </td>
                      </tr>
                      {dateLeads.map(lead => (
                        <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)} style={{ cursor: 'pointer' }}>
                          <td style={{ fontWeight: '500' }}>
                            {new Date(lead.fecha_agenda).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="table-cell-primary">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <User size={16} />
                              {lead.nombre}
                            </div>
                          </td>
                          <td>{lead.modelo_interes || '-'}</td>
                          <td>{lead.telefono || '-'}</td>
                          <td>
                            <span className={`badge ${getStatusBadgeClass(lead.estado)}`}>
                              {formatStatus(lead.estado)}
                            </span>
                          </td>
                          {isAdmin && (
                            <td>{lead.vendedor?.full_name || 'Sin asignar'}</td>
                          )}
                          <td onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <a 
                                href={getWaLink(lead.telefono)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-icon"
                                style={{ color: 'var(--color-success)' }}
                              >
                                <MessageCircle size={18} />
                              </a>
                              <a 
                                href={`tel:${lead.telefono}`}
                                className="btn btn-icon"
                                style={{ color: 'var(--color-primary)' }}
                              >
                                <Phone size={18} />
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
