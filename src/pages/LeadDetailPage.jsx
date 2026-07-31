import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { ArrowLeft, Plus, X, Phone, MessageCircle, Mail, MapPin, MoreHorizontal } from 'lucide-react'

const STATUS_LABELS = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  en_negociacion: 'En Negociación',
  venta_cerrada: 'Venta Cerrada',
  perdido: 'Perdido',
}

const TIPO_LABELS = {
  llamada: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Email',
  visita: 'Visita',
  otro: 'Otro',
}

const TIPO_ICONS = {
  llamada: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  visita: MapPin,
  otro: MoreHorizontal,
}

export default function LeadDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { addToast } = useToast()
  const [lead, setLead] = useState(null)
  const [interacciones, setInteracciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInteraccionModal, setShowInteraccionModal] = useState(false)
  const [interaccionForm, setInteraccionForm] = useState({ tipo: 'llamada', detalle: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchLead()
    fetchInteracciones()
  }, [id])

  async function fetchLead() {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*, vendedor:profiles!vendedor_asignado(full_name)')
        .eq('id', id)
        .single()
      if (error) throw error
      setLead(data)
    } catch (err) {
      console.error('Error fetching lead:', err)
      navigate('/leads')
    } finally {
      setLoading(false)
    }
  }

  async function fetchInteracciones() {
    const { data } = await supabase
      .from('interacciones')
      .select('*, usuario:profiles!usuario_id(full_name)')
      .eq('lead_id', id)
      .order('fecha', { ascending: false })
    setInteracciones(data || [])
  }

  async function handleAddInteraccion(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await supabase.from('interacciones').insert([{
        lead_id: id,
        usuario_id: profile.id,
        tipo: interaccionForm.tipo,
        detalle: interaccionForm.detalle,
        fecha: new Date().toISOString(),
      }])
      if (error) throw error
      addToast('Interacción registrada', 'success')
      setShowInteraccionModal(false)
      setInteraccionForm({ tipo: 'llamada', detalle: '' })
      fetchInteracciones()

      // Auto-update lead status to "contactado" if currently "nuevo"
      if (lead.estado === 'nuevo') {
        await supabase.from('leads').update({ estado: 'contactado', updated_at: new Date().toISOString() }).eq('id', id)
        fetchLead()
      }
    } catch (err) {
      console.error('Error adding interaction:', err)
      addToast('Error al registrar interacción', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="spinner-overlay"><div className="spinner" /></div>
  }

  if (!lead) return null

  return (
    <div>
      <button className="back-btn" onClick={() => navigate('/leads')}>
        <ArrowLeft size={16} /> Volver a Leads
      </button>

      <div className="lead-detail-grid">
        {/* Lead Info */}
        <div className="card">
          <div className="card-header">
            <h3>{lead.nombre}</h3>
            <span className={`badge badge-${lead.estado}`}>
              <span className="badge-dot" />
              {STATUS_LABELS[lead.estado] || lead.estado}
            </span>
          </div>
          <div className="card-body">
            <div className="lead-info-section">
              <div className="lead-info-item">
                <span className="lead-info-label">Teléfono</span>
                <span className="lead-info-value">{lead.telefono || '—'}</span>
              </div>
              <div className="lead-info-item">
                <span className="lead-info-label">Email</span>
                <span className="lead-info-value">{lead.email || '—'}</span>
              </div>
              <div className="lead-info-item">
                <span className="lead-info-label">Modelo de Interés</span>
                <span className="lead-info-value">{lead.modelo_interes || '—'}</span>
              </div>
              <div className="lead-info-item">
                <span className="lead-info-label">Origen</span>
                <span className="lead-info-value">{lead.origen || '—'}</span>
              </div>
              <div className="lead-info-item">
                <span className="lead-info-label">Vendedor</span>
                <span className="lead-info-value">{lead.vendedor?.full_name || '—'}</span>
              </div>
              <div className="lead-info-item">
                <span className="lead-info-label">Presupuesto</span>
                <span className="lead-info-value">
                  {lead.presupuesto_estimado
                    ? `$${Number(lead.presupuesto_estimado).toLocaleString('es-AR')}`
                    : '—'}
                </span>
              </div>
              <div className="lead-info-item" style={{ gridColumn: '1 / -1' }}>
                <span className="lead-info-label">Notas</span>
                <span className="lead-info-value">{lead.notas || '—'}</span>
              </div>
              <div className="lead-info-item">
                <span className="lead-info-label">Creado</span>
                <span className="lead-info-value">
                  {new Date(lead.created_at).toLocaleDateString('es-AR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Interacciones */}
        <div className="card">
          <div className="card-header">
            <h3>Historial de Interacciones</h3>
            <button className="btn btn-sm btn-primary" onClick={() => setShowInteraccionModal(true)}>
              <Plus size={14} /> Nueva
            </button>
          </div>
          <div className="card-body">
            {interacciones.length === 0 ? (
              <div className="empty-state">
                <MessageCircle size={40} />
                <p>No hay interacciones registradas</p>
              </div>
            ) : (
              <div className="timeline">
                {interacciones.map((inter, idx) => {
                  const Icon = TIPO_ICONS[inter.tipo] || MoreHorizontal
                  return (
                    <div className="timeline-item" key={inter.id}>
                      <div className="timeline-marker">
                        <div className="timeline-dot" />
                        {idx < interacciones.length - 1 && <div className="timeline-line" />}
                      </div>
                      <div className="timeline-content">
                        <div className="timeline-type">
                          <Icon size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                          {TIPO_LABELS[inter.tipo] || inter.tipo}
                        </div>
                        <div className="timeline-detail">{inter.detalle}</div>
                        <div className="timeline-meta">
                          {inter.usuario?.full_name} · {new Date(inter.fecha).toLocaleDateString('es-AR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Nueva Interacción */}
      {showInteraccionModal && (
        <div className="modal-overlay" onClick={() => setShowInteraccionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nueva Interacción</h2>
              <button className="modal-close" onClick={() => setShowInteraccionModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddInteraccion}>
              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="form-group">
                    <label>Tipo de Contacto</label>
                    <select
                      value={interaccionForm.tipo}
                      onChange={(e) => setInteraccionForm({ ...interaccionForm, tipo: e.target.value })}
                    >
                      {Object.entries(TIPO_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Detalle *</label>
                    <textarea
                      required
                      value={interaccionForm.detalle}
                      onChange={(e) => setInteraccionForm({ ...interaccionForm, detalle: e.target.value })}
                      placeholder="Describí la interacción..."
                      rows={4}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowInteraccionModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Guardando...' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
