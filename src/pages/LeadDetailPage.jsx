import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { ArrowLeft, Phone, MessageCircle, Mail, MapPin, MoreHorizontal, Edit, Plus, X, Check } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const TIPO_LABELS = { llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Email', visita: 'Visita', otro: 'Otro' }
const PIPELINE_STEPS = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada']

export default function LeadDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, isAdmin } = useAuth()
  const { addToast } = useToast()

  const [lead, setLead] = useState(null)
  const [interacciones, setInteracciones] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)

  // Modals state
  const [showEditModal, setShowEditModal] = useState(false)
  const [showInteractionModal, setShowInteractionModal] = useState(false)

  // Edit form state
  const [editFormData, setEditFormData] = useState({})
  
  // Interaction form state
  const [interactionFormData, setInteractionFormData] = useState({ tipo: 'llamada', detalle: '' })

  const fetchLeadData = async () => {
    try {
      setLoading(true)
      
      const [leadResponse, interaccionesResponse, vendedoresResponse] = await Promise.all([
        supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)').eq('id', id).single(),
        supabase.from('interacciones').select('*, usuario:profiles!usuario_id(full_name)').eq('lead_id', id).order('fecha', { ascending: false }),
        isAdmin ? supabase.from('profiles').select('id, full_name').order('full_name') : Promise.resolve({ data: [] })
      ])

      if (leadResponse.error) throw leadResponse.error
      if (interaccionesResponse.error) throw interaccionesResponse.error
      if (isAdmin && vendedoresResponse.error) throw vendedoresResponse.error

      setLead(leadResponse.data)
      setInteracciones(interaccionesResponse.data || [])
      if (isAdmin) {
        setVendedores(vendedoresResponse.data || [])
      }
    } catch (error) {
      console.error('Error fetching lead data:', error)
      addToast('Error al cargar la información del lead', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) {
      fetchLeadData()
    }
  }, [id, isAdmin])

  const handleStatusChange = async (newStatus) => {
    if (newStatus === lead.estado) return
    
    if (window.confirm(`¿Estás seguro de cambiar el estado a ${STATUS_LABELS[newStatus]}?`)) {
      try {
        const { error } = await supabase
          .from('leads')
          .update({ estado: newStatus })
          .eq('id', id)
          
        if (error) throw error
        
        addToast('Estado actualizado correctamente', 'success')
        fetchLeadData()
      } catch (error) {
        console.error('Error updating status:', error)
        addToast('Error al actualizar el estado', 'error')
      }
    }
  }

  const handleEditSubmit = async (e) => {
    e.preventDefault()
    try {
      const updates = { ...editFormData }
      // format numbers if needed, ensure budget is number
      if (updates.presupuesto_estimado) {
        updates.presupuesto_estimado = Number(updates.presupuesto_estimado)
      } else {
        updates.presupuesto_estimado = null
      }
      
      const { error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        
      if (error) throw error
      
      addToast('Lead actualizado correctamente', 'success')
      setShowEditModal(false)
      fetchLeadData()
    } catch (error) {
      console.error('Error updating lead:', error)
      addToast('Error al actualizar el lead', 'error')
    }
  }

  const handleInteractionSubmit = async (e) => {
    e.preventDefault()
    try {
      const { error } = await supabase
        .from('interacciones')
        .insert([{
          lead_id: id,
          usuario_id: user.id,
          tipo: interactionFormData.tipo,
          detalle: interactionFormData.detalle
        }])
        
      if (error) throw error
      
      let toastMsg = 'Interacción registrada'
      
      // Auto-update to 'contactado' if currently 'nuevo'
      if (lead.estado === 'nuevo') {
        const { error: updateError } = await supabase
          .from('leads')
          .update({ estado: 'contactado' })
          .eq('id', id)
          
        if (updateError) throw updateError
        toastMsg += ' y estado actualizado a Contactado'
      }
      
      addToast(toastMsg, 'success')
      setShowInteractionModal(false)
      setInteractionFormData({ tipo: 'llamada', detalle: '' })
      fetchLeadData()
    } catch (error) {
      console.error('Error creating interaction:', error)
      addToast('Error al registrar la interacción', 'error')
    }
  }

  const openEditModal = () => {
    setEditFormData({
      nombre: lead.nombre || '',
      telefono: lead.telefono || '',
      email: lead.email || '',
      modelo_interes: lead.modelo_interes || '',
      origen: lead.origen || '',
      estado: lead.estado || 'nuevo',
      vendedor_asignado: lead.vendedor_asignado || '',
      notas: lead.notas || '',
      presupuesto_estimado: lead.presupuesto_estimado || '',
      fecha_agenda: lead.fecha_agenda ? lead.fecha_agenda.slice(0, 16) : ''
    })
    setShowEditModal(true)
  }

  const formatCurrency = (v) => {
    if (!v) return '-'
    return '$' + Number(v).toLocaleString('es-AR')
  }

  const formatDate = (d) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const getWhatsAppLink = (phone) => {
    if (!phone) return '#'
    let cleanPhone = phone.replace(/\D/g, '')
    if (cleanPhone.length === 10 && !cleanPhone.startsWith('54')) {
      cleanPhone = '549' + cleanPhone
    } else if (!cleanPhone.startsWith('54')) {
        cleanPhone = '54' + cleanPhone
    }
    return `https://wa.me/${cleanPhone}`
  }

  const getTimelineIcon = (tipo) => {
    switch (tipo) {
      case 'llamada': return <Phone size={16} />
      case 'whatsapp': return <MessageCircle size={16} />
      case 'email': return <Mail size={16} />
      case 'visita': return <MapPin size={16} />
      default: return <MoreHorizontal size={16} />
    }
  }

  if (loading) {
    return (
      <div className="spinner-overlay">
        <div className="spinner"></div>
      </div>
    )
  }

  if (!lead) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={() => navigate('/leads')}>
          <ArrowLeft size={20} /> Volver
        </button>
        <p>No se encontró el lead.</p>
      </div>
    )
  }

  const currentStepIndex = PIPELINE_STEPS.indexOf(lead.estado)

  return (
    <div>
      <div className="mb-4">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/leads')}>
          <ArrowLeft size={16} /> Volver a Leads
        </button>
      </div>

      <div className="pipeline">
        {PIPELINE_STEPS.map((step, index) => {
          const isActive = lead.estado === step
          const isCompleted = currentStepIndex > index && lead.estado !== 'perdido'
          
          let stepClass = ''
          if (isActive) stepClass = 'active'
          else if (isCompleted) stepClass = 'completed'
          
          return (
            <div 
              key={step} 
              className={`pipeline-step ${stepClass}`}
              onClick={() => handleStatusChange(step)}
            >
              <div className="pipeline-dot">
                {isCompleted && <Check size={12} />}
              </div>
              <span className="pipeline-label">{STATUS_LABELS[step]}</span>
              {index < PIPELINE_STEPS.length - 1 && (
                <div className={`pipeline-connector ${isCompleted ? 'completed' : ''}`}></div>
              )}
            </div>
          )
        })}
        {lead.estado === 'perdido' && (
          <div className="pipeline-step perdido">
            <div className="pipeline-dot">
               <X size={12} />
            </div>
            <span className="pipeline-label">Perdido</span>
          </div>
        )}
      </div>

      <div className="quick-actions">
        <a 
          href={getWhatsAppLink(lead.telefono)} 
          target="_blank" 
          rel="noopener noreferrer"
          className={`quick-action wa ${!lead.telefono ? 'disabled' : ''}`}
          onClick={(e) => !lead.telefono && e.preventDefault()}
        >
          <MessageCircle size={20} />
          <span>WhatsApp</span>
        </a>
        <a 
          href={lead.telefono ? `tel:${lead.telefono}` : '#'} 
          className={`quick-action call ${!lead.telefono ? 'disabled' : ''}`}
          onClick={(e) => !lead.telefono && e.preventDefault()}
        >
          <Phone size={20} />
          <span>Llamar</span>
        </a>
        <a 
          href={lead.email ? `mailto:${lead.email}` : '#'} 
          className={`quick-action mail ${!lead.email ? 'disabled' : ''}`}
          onClick={(e) => !lead.email && e.preventDefault()}
        >
          <Mail size={20} />
          <span>Email</span>
        </a>
        <button className="quick-action edit" onClick={openEditModal}>
          <Edit size={20} />
          <span>Editar</span>
        </button>
      </div>

      <div className="detail-grid">
        <div className="card">
          <div className="card-header">
            <h3>Información del Lead</h3>
          </div>
          <div className="card-body">
            <div className="detail-row">
              <span className="detail-label">Nombre</span>
              <span className="detail-value">{lead.nombre}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Teléfono</span>
              <span className="detail-value">{lead.telefono || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Email</span>
              <span className="detail-value">{lead.email || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Modelo de Interés</span>
              <span className="detail-value">{lead.modelo_interes || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Origen</span>
              <span className="detail-value">{lead.origen || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Presupuesto</span>
              <span className="detail-value">{formatCurrency(lead.presupuesto_estimado)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Vendedor</span>
              <span className="detail-value">{lead.vendedor?.full_name || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Estado</span>
              <span className="detail-value">
                <span className={`badge badge-${lead.estado}`}>{STATUS_LABELS[lead.estado]}</span>
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Cita Agendada</span>
              <span className="detail-value">{lead.fecha_agenda ? formatDate(lead.fecha_agenda) : 'Sin agendar'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Notas</span>
              <span className="detail-value">{lead.notas || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Creado</span>
              <span className="detail-value">{formatDate(lead.created_at)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Actualizado</span>
              <span className="detail-value">{formatDate(lead.updated_at)}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Interacciones ({interacciones.length})</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowInteractionModal(true)}>
              <Plus size={16} /> Nueva Interacción
            </button>
          </div>
          <div className="card-body">
            {interacciones.length === 0 ? (
              <p>No hay interacciones registradas.</p>
            ) : (
              <div className="timeline">
                {interacciones.map((interaccion) => (
                  <div key={interaccion.id} className="timeline-item">
                    <div className={`timeline-icon ${interaccion.tipo}`}>
                      {getTimelineIcon(interaccion.tipo)}
                    </div>
                    <div className="timeline-body">
                      <div className="timeline-type">{TIPO_LABELS[interaccion.tipo] || interaccion.tipo}</div>
                      {interaccion.detalle && (
                        <div className="timeline-detail">{interaccion.detalle}</div>
                      )}
                      <div className="timeline-meta">
                        {interaccion.usuario?.full_name || 'Usuario'} • {formatDate(interaccion.fecha)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Editar Lead</h2>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nombre</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      required 
                      value={editFormData.nombre}
                      onChange={e => setEditFormData({...editFormData, nombre: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={editFormData.telefono}
                      onChange={e => setEditFormData({...editFormData, telefono: e.target.value})}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input 
                      type="email" 
                      className="form-input" 
                      value={editFormData.email}
                      onChange={e => setEditFormData({...editFormData, email: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Modelo de Interés</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={editFormData.modelo_interes}
                      onChange={e => setEditFormData({...editFormData, modelo_interes: e.target.value})}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Origen</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={editFormData.origen}
                      onChange={e => setEditFormData({...editFormData, origen: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Presupuesto Estimado</label>
                    <input 
                      type="number" 
                      className="form-input" 
                      value={editFormData.presupuesto_estimado}
                      onChange={e => setEditFormData({...editFormData, presupuesto_estimado: e.target.value})}
                    />
                  </div>
                </div>
                
                {isAdmin && (
                  <div className="form-group">
                    <label className="form-label">Vendedor Asignado</label>
                    <select 
                      className="form-input"
                      value={editFormData.vendedor_asignado || ''}
                      onChange={e => setEditFormData({...editFormData, vendedor_asignado: e.target.value || null})}
                    >
                      <option value="">Sin asignar</option>
                      {vendedores.map(v => (
                        <option key={v.id} value={v.id}>{v.full_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                
                <div className="form-group">
                  <label className="form-label">Estado</label>
                  <select 
                    className="form-input"
                    value={editFormData.estado}
                    onChange={e => setEditFormData({...editFormData, estado: e.target.value})}
                  >
                    {Object.entries(STATUS_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label className="form-label">Fecha y Hora de Cita</label>
                  <input
                    className="form-input"
                    type="datetime-local"
                    value={editFormData.fecha_agenda || ''}
                    onChange={e => setEditFormData({...editFormData, fecha_agenda: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Notas</label>
                  <textarea 
                    className="form-input" 
                    rows="3"
                    value={editFormData.notas}
                    onChange={e => setEditFormData({...editFormData, notas: e.target.value})}
                  ></textarea>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowEditModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar Cambios</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showInteractionModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Nueva Interacción</h2>
              <button className="modal-close" onClick={() => setShowInteractionModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleInteractionSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tipo de Interacción</label>
                  <select 
                    className="form-input"
                    value={interactionFormData.tipo}
                    onChange={e => setInteractionFormData({...interactionFormData, tipo: e.target.value})}
                    required
                  >
                    {Object.entries(TIPO_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label className="form-label">Detalle</label>
                  <textarea 
                    className="form-input" 
                    rows="4"
                    required
                    value={interactionFormData.detalle}
                    onChange={e => setInteractionFormData({...interactionFormData, detalle: e.target.value})}
                    placeholder="Describe la interacción..."
                  ></textarea>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowInteractionModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
