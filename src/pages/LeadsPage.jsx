import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, LayoutGrid, List, Download, Phone, MessageCircle } from 'lucide-react'

const STATUS_LABELS = { 
  nuevo: 'Nuevo', 
  contactado: 'Contactado', 
  en_negociacion: 'En Negociación', 
  venta_cerrada: 'Venta Cerrada', 
  perdido: 'Perdido' 
}

const ORIGEN_LABELS = { 
  whatsapp: 'WhatsApp', 
  facebook: 'Facebook', 
  instagram: 'Instagram', 
  presencial: 'Presencial', 
  referido: 'Referido', 
  otro: 'Otro' 
}

const STATUS_ORDER = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada', 'perdido']

const getWaLink = (ph) => { 
  if(!ph) return null; 
  const c = ph.replace(/\D/g,''); 
  return 'https://wa.me/' + (c.startsWith('54') ? c : '54'+c) 
}

const formatPresupuesto = (v) => v ? '$' + Number(v).toLocaleString('es-AR') : '-'

export default function LeadsPage() {
  const { profile } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [leads, setLeads] = useState([])
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)

  // View state
  const [viewMode, setViewMode] = useState('table')

  // Filter states
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [origenFilter, setOrigenFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Modal states
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
    fecha_agenda: '',
    notas: ''
  })
  const [saving, setSaving] = useState(false)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    fetchLeads()
    if (isAdmin) {
      fetchVendors()
    }
  }, [profile])

  useEffect(() => {
    const handleOpenNewLead = () => {
      openModal()
    }
    window.addEventListener('open-new-lead', handleOpenNewLead)
    return () => window.removeEventListener('open-new-lead', handleOpenNewLead)
  }, [])

  const fetchLeads = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('leads')
        .select('*, vendedor:profiles!vendedor_asignado(id, full_name)')
        .order('created_at', { ascending: false })

      if (profile?.role === 'empleado') {
        query = query.eq('vendedor_asignado', profile.id)
      }

      const { data, error } = await query
      if (error) throw error
      setLeads(data || [])
    } catch (err) {
      console.error(err)
      showToast('Error al cargar leads', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchVendors = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name')
      if (error) throw error
      setVendors(data || [])
    } catch (err) {
      console.error(err)
    }
  }

  const handleExportCSV = () => {
    if (filteredLeads.length === 0) return
    const headers = ['Nombre', 'Teléfono', 'Email', 'Modelo', 'Origen', 'Estado', 'Presupuesto', 'Vendedor', 'Fecha']
    const csvData = filteredLeads.map(l => [
      l.nombre,
      l.telefono || '',
      l.email || '',
      l.modelo_interes || '',
      ORIGEN_LABELS[l.origen] || l.origen,
      STATUS_LABELS[l.estado] || l.estado,
      l.presupuesto_estimado || '',
      l.vendedor?.full_name || '',
      new Date(l.created_at).toLocaleDateString()
    ])

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.setAttribute('download', 'leads.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const openModal = (lead = null) => {
    if (lead) {
      setEditingLead(lead)
      setFormData({
        nombre: lead.nombre || '',
        telefono: lead.telefono || '',
        email: lead.email || '',
        modelo_interes: lead.modelo_interes || '',
        origen: lead.origen || 'whatsapp',
        estado: lead.estado || 'nuevo',
        vendedor_asignado: lead.vendedor_asignado || '',
        presupuesto_estimado: lead.presupuesto_estimado || '',
        fecha_agenda: lead.fecha_agenda ? lead.fecha_agenda.slice(0, 16) : '',
        notas: lead.notas || ''
      })
    } else {
      setEditingLead(null)
      setFormData({
        nombre: '',
        telefono: '',
        email: '',
        modelo_interes: '',
        origen: 'whatsapp',
        estado: 'nuevo',
        vendedor_asignado: isAdmin ? '' : profile?.id,
        presupuesto_estimado: '',
        fecha_agenda: '',
        notas: ''
      })
    }
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingLead(null)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...formData,
        vendedor_asignado: formData.vendedor_asignado || null,
        presupuesto_estimado: formData.presupuesto_estimado ? Number(formData.presupuesto_estimado) : null
      }

      if (editingLead) {
        const { error } = await supabase.from('leads').update(payload).eq('id', editingLead.id)
        if (error) throw error
        showToast('Lead actualizado', 'success')
      } else {
        const { error } = await supabase.from('leads').insert([payload])
        if (error) throw error
        showToast('Lead creado', 'success')
      }
      closeModal()
      fetchLeads()
    } catch (err) {
      console.error(err)
      showToast('Error al guardar lead', 'error')
    } finally {
      setSaving(false)
    }
  }

  const filteredLeads = leads.filter(l => {
    const sTerm = search.toLowerCase()
    const matchesSearch = !search || 
      (l.nombre && l.nombre.toLowerCase().includes(sTerm)) ||
      (l.telefono && l.telefono.includes(sTerm))
    const matchesStatus = !statusFilter || l.estado === statusFilter
    const matchesOrigen = !origenFilter || l.origen === origenFilter
    const matchesVendor = !vendorFilter || l.vendedor_asignado === vendorFilter
    const matchesDateFrom = !dateFrom || new Date(l.created_at) >= new Date(dateFrom)
    const matchesDateTo = !dateTo || new Date(l.created_at) <= new Date(dateTo + 'T23:59:59')
    
    return matchesSearch && matchesStatus && matchesOrigen && matchesVendor && matchesDateFrom && matchesDateTo
  })

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Leads</h1>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={handleExportCSV}>
            <Download className="icon" /> Exportar
          </button>
          <button className="btn btn-primary" onClick={() => openModal()}>
            <Plus className="icon" /> Nuevo Lead
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search className="icon" />
          <input
            type="text"
            placeholder="Buscar por nombre o teléfono..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        
        <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Estado (Todos)</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        
        <select className="filter-select" value={origenFilter} onChange={e => setOrigenFilter(e.target.value)}>
          <option value="">Origen (Todos)</option>
          {Object.entries(ORIGEN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {isAdmin && (
          <select className="filter-select" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
            <option value="">Vendedor (Todos)</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
          </select>
        )}

        <input type="date" className="filter-date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input type="date" className="filter-date" value={dateTo} onChange={e => setDateTo(e.target.value)} />

        <div className="view-toggle">
          <button 
            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
            title="Tabla"
          >
            <List className="icon" />
          </button>
          <button 
            className={`view-toggle-btn ${viewMode === 'kanban' ? 'active' : ''}`}
            onClick={() => setViewMode('kanban')}
            title="Kanban"
          >
            <LayoutGrid className="icon" />
          </button>
        </div>
      </div>

      <div className="results-count">
        {filteredLeads.length} {filteredLeads.length === 1 ? 'resultado' : 'resultados'}
      </div>

      {loading ? (
        <div className="spinner-overlay">
          <div className="spinner"></div>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="empty-state">
          <p>No se encontraron leads con los filtros actuales.</p>
        </div>
      ) : (
        viewMode === 'table' ? (
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Modelo</th>
                  <th>Origen</th>
                  <th>Estado</th>
                  <th>Presupuesto</th>
                  {isAdmin && <th>Vendedor</th>}
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map(lead => (
                  <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)} style={{ cursor: 'pointer' }}>
                    <td className="table-cell-primary">{lead.nombre}</td>
                    <td className="table-cell-secondary">{lead.telefono || '-'}</td>
                    <td className="table-cell-secondary">{lead.modelo_interes || '-'}</td>
                    <td className="table-cell-secondary">{ORIGEN_LABELS[lead.origen] || lead.origen}</td>
                    <td>
                      <span className={`badge badge-${lead.estado}`}>
                        {STATUS_LABELS[lead.estado] || lead.estado}
                      </span>
                    </td>
                    <td className="table-cell-secondary">{formatPresupuesto(lead.presupuesto_estimado)}</td>
                    {isAdmin && <td className="table-cell-secondary">{lead.vendedor?.full_name || '-'}</td>}
                    <td className="table-cell-secondary">{new Date(lead.created_at).toLocaleDateString()}</td>
                    <td className="table-actions" onClick={e => e.stopPropagation()}>
                      {lead.telefono && (
                        <>
                          <a href={getWaLink(lead.telefono)} target="_blank" rel="noopener noreferrer" className="btn-icon">
                            <MessageCircle className="icon" />
                          </a>
                          <a href={`tel:${lead.telefono}`} className="btn-icon">
                            <Phone className="icon" />
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="kanban-board">
            {STATUS_ORDER.map(status => (
              <div key={status} className="kanban-column" data-status={status}>
                <div className="kanban-column-header">
                  <h3 className="kanban-column-title">{STATUS_LABELS[status]}</h3>
                  <span className="kanban-column-count">
                    {filteredLeads.filter(l => l.estado === status).length}
                  </span>
                </div>
                <div className="kanban-cards">
                  {filteredLeads.filter(l => l.estado === status).map(lead => (
                    <div key={lead.id} className="kanban-card" onClick={() => navigate(`/leads/${lead.id}`)}>
                      <div className="kanban-card-name">{lead.nombre}</div>
                      {lead.modelo_interes && <div className="kanban-card-model">{lead.modelo_interes}</div>}
                      <div className="kanban-card-meta">
                        {lead.telefono && <span>{lead.telefono}</span>}
                      </div>
                      <div className="kanban-card-footer">
                        {lead.presupuesto_estimado && (
                          <span className="kanban-card-budget">{formatPresupuesto(lead.presupuesto_estimado)}</span>
                        )}
                        {isAdmin && lead.vendedor && (
                          <span className="kanban-card-vendor">{lead.vendedor.full_name}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingLead ? 'Editar Lead' : 'Nuevo Lead'}</h2>
              <button className="modal-close" onClick={closeModal}><X className="icon" /></button>
            </div>
            <div className="modal-body">
              <form id="lead-form" onSubmit={handleSave}>
                <div className="form-group">
                  <label className="form-label">Nombre *</label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    value={formData.nombre}
                    onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                  />
                </div>
                
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.telefono}
                      onChange={e => setFormData({ ...formData, telefono: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      className="form-input"
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Modelo de Interés</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.modelo_interes}
                    onChange={e => setFormData({ ...formData, modelo_interes: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Origen *</label>
                    <select
                      className="form-input"
                      required
                      value={formData.origen}
                      onChange={e => setFormData({ ...formData, origen: e.target.value })}
                    >
                      {Object.entries(ORIGEN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Estado *</label>
                    <select
                      className="form-input"
                      required
                      value={formData.estado}
                      onChange={e => setFormData({ ...formData, estado: e.target.value })}
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Presupuesto Estimado ($)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={formData.presupuesto_estimado}
                      onChange={e => setFormData({ ...formData, presupuesto_estimado: e.target.value })}
                    />
                  </div>
                  {isAdmin && (
                    <div className="form-group">
                      <label className="form-label">Vendedor Asignado</label>
                      <select
                        className="form-input"
                        value={formData.vendedor_asignado}
                        onChange={e => setFormData({ ...formData, vendedor_asignado: e.target.value })}
                      >
                        <option value="">Sin asignar</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Fecha y Hora de Cita</label>
                  <input
                    className="form-input"
                    type="datetime-local"
                    value={formData.fecha_agenda}
                    onChange={e => setFormData({ ...formData, fecha_agenda: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Notas</label>
                  <textarea
                    className="form-input"
                    rows="3"
                    value={formData.notas}
                    onChange={e => setFormData({ ...formData, notas: e.target.value })}
                  ></textarea>
                </div>
              </form>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Cancelar</button>
              <button type="submit" form="lead-form" className="btn btn-primary" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
