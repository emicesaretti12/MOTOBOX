import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, LayoutGrid, List, Download, Phone, MessageCircle, Mail } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const ORIGEN_LABELS = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', presencial: 'Presencial', referido: 'Referido', otro: 'Otro' }
const STATUS_ORDER = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada', 'perdido']
const STATUS_COLORS = { nuevo: '#3B82F6', contactado: '#F59E0B', en_negociacion: '#8B5CF6', venta_cerrada: '#10B981', perdido: '#6B7280' }

export default function LeadsPage() {
  const { user, profile } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState([])
  
  const [viewMode, setViewMode] = useState('table') 

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [origenFilter, setOrigenFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingLead, setEditingLead] = useState(null)
  
  const [formData, setFormData] = useState({
    nombre: '',
    telefono: '',
    email: '',
    modelo_interes: '',
    origen: 'whatsapp',
    estado: 'nuevo',
    vendedor_asignado: '',
    presupuesto_estimado: '',
    notas: ''
  })

  useEffect(() => {
    fetchLeads()
    if (profile?.role === 'admin') fetchEmployees()

    const handler = () => openNewLead()
    window.addEventListener('open-new-lead', handler)
    return () => window.removeEventListener('open-new-lead', handler)
  }, [profile])

  const fetchLeads = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('leads')
        .select(`
          *,
          vendedor:profiles!vendedor_asignado(id, full_name)
        `)
        .order('created_at', { ascending: false })

      if (profile?.role !== 'admin') {
        query = query.eq('vendedor_asignado', user.id)
      }

      const { data, error } = await query

      if (error) throw error
      setLeads(data || [])
    } catch (error) {
      console.error('Error fetching leads:', error)
      showToast('Error al cargar leads', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchEmployees = async () => {
    const { data, error } = await supabase.from('profiles').select('id, full_name').in('role', ['admin', 'empleado'])
    if (!error && data) setEmployees(data)
  }

  const openNewLead = () => {
    setEditingLead(null)
    setFormData({
      nombre: '',
      telefono: '',
      email: '',
      modelo_interes: '',
      origen: 'whatsapp',
      estado: 'nuevo',
      vendedor_asignado: profile?.role === 'admin' ? '' : user.id,
      presupuesto_estimado: '',
      notas: ''
    })
    setIsModalOpen(true)
  }

  const handleEditLead = (e, lead) => {
    e.stopPropagation()
    setEditingLead(lead)
    setFormData({
      nombre: lead.nombre || '',
      telefono: lead.telefono || '',
      email: lead.email || '',
      modelo_interes: lead.modelo_interes || '',
      origen: lead.origen || 'otro',
      estado: lead.estado || 'nuevo',
      vendedor_asignado: lead.vendedor_asignado || '',
      presupuesto_estimado: lead.presupuesto_estimado || '',
      notas: lead.notas || ''
    })
    setIsModalOpen(true)
  }

  const formatCurrency = (amount) => {
    if (!amount) return '-'
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount)
  }

  const getWhatsAppLink = (phone) => {
    if (!phone) return null
    const cleaned = phone.replace(/\D/g, '')
    const number = cleaned.startsWith('54') ? cleaned : '54' + cleaned
    return `https://wa.me/${number}`
  }

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = lead.nombre?.toLowerCase().includes(search.toLowerCase()) || 
                          lead.telefono?.includes(search)
    const matchesStatus = statusFilter ? lead.estado === statusFilter : true
    const matchesOrigen = origenFilter ? lead.origen === origenFilter : true
    const matchesVendor = vendorFilter ? lead.vendedor_asignado === vendorFilter : true
    
    let matchesDate = true
    if (dateFrom || dateTo) {
      const leadDate = lead.created_at.split('T')[0]
      if (dateFrom && leadDate < dateFrom) matchesDate = false
      if (dateTo && leadDate > dateTo) matchesDate = false
    }
    
    return matchesSearch && matchesStatus && matchesOrigen && matchesVendor && matchesDate
  })

  const exportCSV = () => {
    const headers = ['Nombre','Teléfono','Email','Modelo','Origen','Estado','Vendedor','Presupuesto','Notas','Fecha']
    const rows = filteredLeads.map(l => [
      l.nombre, l.telefono, l.email, l.modelo_interes,
      ORIGEN_LABELS[l.origen], STATUS_LABELS[l.estado],
      l.vendedor?.full_name || '', l.presupuesto_estimado || '',
      l.notas || '', new Date(l.created_at).toLocaleDateString('es-AR')
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'leads_motobox.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveLead = async (e) => {
    e.preventDefault()
    
    if (!formData.nombre || !formData.telefono) {
      showToast('Nombre y teléfono son obligatorios', 'error')
      return
    }

    try {
      const dataToSave = {
        ...formData,
        vendedor_asignado: profile?.role === 'admin' ? formData.vendedor_asignado : user.id,
        presupuesto_estimado: formData.presupuesto_estimado ? parseFloat(formData.presupuesto_estimado) : null
      }

      if (editingLead) {
        const { error } = await supabase.from('leads').update(dataToSave).eq('id', editingLead.id)
        if (error) throw error
        showToast('Lead actualizado exitosamente', 'success')
      } else {
        const { error } = await supabase.from('leads').insert([dataToSave])
        if (error) throw error
        showToast('Lead creado exitosamente', 'success')
      }

      setIsModalOpen(false)
      fetchLeads()
    } catch (error) {
      console.error('Error saving lead:', error)
      showToast('Error al guardar el lead', 'error')
    }
  }

  const getDaysSince = (dateString) => {
    const diffTime = Math.abs(new Date() - new Date(dateString));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Leads y Oportunidades</h1>
        <div className="header-actions">
          <div className="view-toggle">
            <button 
              className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Vista de Tabla"
            >
              <List size={20} />
            </button>
            <button 
              className={`view-toggle-btn ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => setViewMode('kanban')}
              title="Vista Kanban"
            >
              <LayoutGrid size={20} />
            </button>
          </div>
          <button className="btn-secondary" onClick={exportCSV}>
            <Download size={20} />
            Exportar CSV
          </button>
          <button className="btn-primary" onClick={openNewLead}>
            <Plus size={20} />
            Nuevo Lead
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar por nombre o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos los Estados</option>
          {Object.entries(STATUS_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        <select value={origenFilter} onChange={(e) => setOrigenFilter(e.target.value)}>
          <option value="">Todos los Orígenes</option>
          {Object.entries(ORIGEN_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        {profile?.role === 'admin' && (
          <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
            <option value="">Todos los Vendedores</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>
        )}

        <div className="date-filters">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span>a</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>
      
      <div className="results-count">
        Mostrando {filteredLeads.length} leads
      </div>

      {loading ? (
        <div className="loading-state">Cargando leads...</div>
      ) : viewMode === 'table' ? (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Modelo</th>
                <th>Origen</th>
                <th>Estado</th>
                <th>Presupuesto</th>
                {profile?.role === 'admin' && <th>Vendedor</th>}
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={profile?.role === 'admin' ? 9 : 8} className="empty-state">
                    No se encontraron leads
                  </td>
                </tr>
              ) : (
                filteredLeads.map(lead => (
                  <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)} style={{cursor: 'pointer'}}>
                    <td className="font-medium">{lead.nombre}</td>
                    <td>{lead.telefono}</td>
                    <td>{lead.modelo_interes || '-'}</td>
                    <td>{ORIGEN_LABELS[lead.origen] || lead.origen}</td>
                    <td>
                      <span className={`status-badge status-${lead.estado}`}>
                        {STATUS_LABELS[lead.estado] || lead.estado}
                      </span>
                    </td>
                    <td>{formatCurrency(lead.presupuesto_estimado)}</td>
                    {profile?.role === 'admin' && (
                      <td>{lead.vendedor?.full_name || '-'}</td>
                    )}
                    <td>{new Date(lead.created_at).toLocaleDateString('es-AR')}</td>
                    <td>
                      <div className="actions-cell" onClick={e => e.stopPropagation()}>
                        {lead.telefono && (
                          <>
                            <a 
                              href={getWhatsAppLink(lead.telefono)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="action-icon text-green-500 hover:text-green-600"
                              title="WhatsApp"
                            >
                              <MessageCircle size={18} />
                            </a>
                            <a 
                              href={`tel:${lead.telefono}`}
                              className="action-icon text-blue-500 hover:text-blue-600"
                              title="Llamar"
                            >
                              <Phone size={18} />
                            </a>
                          </>
                        )}
                        <button className="btn-icon" onClick={(e) => handleEditLead(e, lead)} title="Editar">
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="kanban-board">
          {STATUS_ORDER.map(status => {
            const columnLeads = filteredLeads.filter(l => l.estado === status)
            const color = STATUS_COLORS[status] || '#ccc'
            
            return (
              <div key={status} className="kanban-column" style={{ borderTop: `4px solid ${color}` }}>
                <div className="kanban-column-header">
                  <h3>{STATUS_LABELS[status]}</h3>
                  <span className="kanban-column-count">{columnLeads.length}</span>
                </div>
                <div className="kanban-cards">
                  {columnLeads.map(lead => (
                    <div 
                      key={lead.id} 
                      className="kanban-card"
                      onClick={() => navigate(`/leads/${lead.id}`)}
                    >
                      <div className="kanban-card-name">{lead.nombre}</div>
                      <div className="kanban-card-model">{lead.modelo_interes || 'Sin modelo'}</div>
                      <div className="kanban-card-meta">
                        {lead.telefono && <span>📞 {lead.telefono}</span>}
                      </div>
                      <div className="kanban-card-budget">
                        {formatCurrency(lead.presupuesto_estimado)}
                      </div>
                      <div className="kanban-card-footer">
                        <small className="text-gray-500">
                          {lead.vendedor?.full_name || 'Sin vendedor'} • hace {getDaysSince(lead.created_at)} días
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingLead ? 'Editar Lead' : 'Nuevo Lead'}</h2>
              <button className="btn-icon" onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSaveLead} className="modal-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Nombre *</label>
                  <input
                    type="text"
                    required
                    value={formData.nombre}
                    onChange={(e) => setFormData({...formData, nombre: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Teléfono *</label>
                  <input
                    type="tel"
                    required
                    value={formData.telefono}
                    onChange={(e) => setFormData({...formData, telefono: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Modelo de Interés</label>
                  <input
                    type="text"
                    value={formData.modelo_interes}
                    onChange={(e) => setFormData({...formData, modelo_interes: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Origen</label>
                  <select
                    value={formData.origen}
                    onChange={(e) => setFormData({...formData, origen: e.target.value})}
                  >
                    {Object.entries(ORIGEN_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select
                    value={formData.estado}
                    onChange={(e) => setFormData({...formData, estado: e.target.value})}
                  >
                    {Object.entries(STATUS_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                {profile?.role === 'admin' && (
                  <div className="form-group">
                    <label>Vendedor Asignado</label>
                    <select
                      value={formData.vendedor_asignado}
                      onChange={(e) => setFormData({...formData, vendedor_asignado: e.target.value})}
                    >
                      <option value="">Seleccionar vendedor...</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="form-group">
                  <label>Presupuesto Estimado</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.presupuesto_estimado}
                    onChange={(e) => setFormData({...formData, presupuesto_estimado: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notas</label>
                <textarea
                  rows="3"
                  value={formData.notas}
                  onChange={(e) => setFormData({...formData, notas: e.target.value})}
                ></textarea>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingLead ? 'Guardar Cambios' : 'Crear Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
