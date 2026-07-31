import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X } from 'lucide-react'

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
  otro: 'Otro',
}

const EMPTY_LEAD = {
  nombre: '',
  telefono: '',
  email: '',
  modelo_interes: '',
  origen: 'presencial',
  estado: 'nuevo',
  vendedor_asignado: '',
  notas: '',
  presupuesto_estimado: '',
}

export default function LeadsPage() {
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { addToast } = useToast()
  const [leads, setLeads] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingLead, setEditingLead] = useState(null)
  const [formData, setFormData] = useState(EMPTY_LEAD)
  const [saving, setSaving] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [filterOrigen, setFilterOrigen] = useState('')
  const [filterVendedor, setFilterVendedor] = useState('')

  useEffect(() => {
    fetchLeads()
    if (isAdmin) fetchVendedores()

    const handleOpenNewLead = () => openNewLead()
    window.addEventListener('open-new-lead', handleOpenNewLead)
    return () => window.removeEventListener('open-new-lead', handleOpenNewLead)
  }, [])

  async function fetchLeads() {
    try {
      let query = supabase
        .from('leads')
        .select('*, vendedor:profiles!vendedor_asignado(id, full_name)')
        .order('created_at', { ascending: false })

      if (!isAdmin) {
        query = query.eq('vendedor_asignado', profile.id)
      }

      const { data, error } = await query
      if (error) throw error
      setLeads(data || [])
    } catch (err) {
      console.error('Error fetching leads:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchVendedores() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .order('full_name')
    setVendedores(data || [])
  }

  function openNewLead() {
    setEditingLead(null)
    setFormData({
      ...EMPTY_LEAD,
      vendedor_asignado: isAdmin ? '' : profile.id,
    })
    setShowModal(true)
  }

  function openEditLead(lead) {
    setEditingLead(lead)
    setFormData({
      nombre: lead.nombre || '',
      telefono: lead.telefono || '',
      email: lead.email || '',
      modelo_interes: lead.modelo_interes || '',
      origen: lead.origen || 'presencial',
      estado: lead.estado || 'nuevo',
      vendedor_asignado: lead.vendedor_asignado || '',
      notas: lead.notas || '',
      presupuesto_estimado: lead.presupuesto_estimado || '',
    })
    setShowModal(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)

    try {
      const payload = {
        ...formData,
        presupuesto_estimado: formData.presupuesto_estimado ? Number(formData.presupuesto_estimado) : null,
        vendedor_asignado: formData.vendedor_asignado || (isAdmin ? null : profile.id),
        updated_at: new Date().toISOString(),
      }

      if (editingLead) {
        const { error } = await supabase
          .from('leads')
          .update(payload)
          .eq('id', editingLead.id)
        if (error) throw error
        addToast('Lead actualizado correctamente', 'success')
      } else {
        const { error } = await supabase
          .from('leads')
          .insert([payload])
        if (error) throw error
        addToast('Lead creado correctamente', 'success')
      }

      setShowModal(false)
      fetchLeads()
    } catch (err) {
      console.error('Error saving lead:', err)
      addToast('Error al guardar el lead', 'error')
    } finally {
      setSaving(false)
    }
  }

  const filteredLeads = leads.filter(lead => {
    if (search) {
      const s = search.toLowerCase()
      if (
        !(lead.nombre || '').toLowerCase().includes(s) &&
        !(lead.telefono || '').toLowerCase().includes(s)
      ) return false
    }
    if (filterEstado && lead.estado !== filterEstado) return false
    if (filterOrigen && lead.origen !== filterOrigen) return false
    if (filterVendedor && lead.vendedor_asignado !== filterVendedor) return false
    return true
  })

  if (loading) {
    return <div className="spinner-overlay"><div className="spinner" /></div>
  }

  return (
    <div>
      <div className="filters-bar">
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
          <input
            className="filter-input"
            style={{ paddingLeft: 36, width: '100%' }}
            placeholder="Buscar por nombre o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="filter-select" value={filterEstado} onChange={(e) => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <select className="filter-select" value={filterOrigen} onChange={(e) => setFilterOrigen(e.target.value)}>
          <option value="">Todos los orígenes</option>
          {Object.entries(ORIGEN_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {isAdmin && (
          <select className="filter-select" value={filterVendedor} onChange={(e) => setFilterVendedor(e.target.value)}>
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="card">
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Modelo</th>
                <th>Origen</th>
                <th>Estado</th>
                {isAdmin && <th>Vendedor</th>}
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7}>
                    <div className="empty-state">
                      <p>No se encontraron leads</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLeads.map(lead => (
                  <tr
                    key={lead.id}
                    className="table-clickable-row"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    <td style={{ fontWeight: 600 }}>{lead.nombre}</td>
                    <td>{lead.telefono}</td>
                    <td>{lead.modelo_interes}</td>
                    <td>{ORIGEN_LABELS[lead.origen] || lead.origen}</td>
                    <td>
                      <span className={`badge badge-${lead.estado}`}>
                        <span className="badge-dot" />
                        {STATUS_LABELS[lead.estado] || lead.estado}
                      </span>
                    </td>
                    {isAdmin && <td>{lead.vendedor?.full_name || '—'}</td>}
                    <td>{new Date(lead.created_at).toLocaleDateString('es-AR')}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={(e) => { e.stopPropagation(); openEditLead(lead) }}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingLead ? 'Editar Lead' : 'Nuevo Lead'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Nombre *</label>
                      <input
                        required
                        value={formData.nombre}
                        onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                        placeholder="Nombre completo"
                      />
                    </div>
                    <div className="form-group">
                      <label>Teléfono</label>
                      <input
                        value={formData.telefono}
                        onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                        placeholder="Ej: 11-1234-5678"
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="email@ejemplo.com"
                      />
                    </div>
                    <div className="form-group">
                      <label>Modelo de Interés</label>
                      <input
                        value={formData.modelo_interes}
                        onChange={(e) => setFormData({ ...formData, modelo_interes: e.target.value })}
                        placeholder="Ej: Honda CB 250"
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Origen</label>
                      <select
                        value={formData.origen}
                        onChange={(e) => setFormData({ ...formData, origen: e.target.value })}
                      >
                        {Object.entries(ORIGEN_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Estado</label>
                      <select
                        value={formData.estado}
                        onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                      >
                        {Object.entries(STATUS_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Presupuesto Estimado</label>
                      <input
                        type="number"
                        value={formData.presupuesto_estimado}
                        onChange={(e) => setFormData({ ...formData, presupuesto_estimado: e.target.value })}
                        placeholder="$0"
                      />
                    </div>
                    {isAdmin && (
                      <div className="form-group">
                        <label>Vendedor Asignado</label>
                        <select
                          value={formData.vendedor_asignado}
                          onChange={(e) => setFormData({ ...formData, vendedor_asignado: e.target.value })}
                        >
                          <option value="">Sin asignar</option>
                          {vendedores.map(v => (
                            <option key={v.id} value={v.id}>{v.full_name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Notas</label>
                    <textarea
                      value={formData.notas}
                      onChange={(e) => setFormData({ ...formData, notas: e.target.value })}
                      placeholder="Observaciones adicionales..."
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Guardando...' : (editingLead ? 'Guardar Cambios' : 'Crear Lead')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
