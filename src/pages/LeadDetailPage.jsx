import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { ArrowLeft, Plus, X, Phone, MessageCircle, Mail, MapPin, MoreHorizontal, Edit, ExternalLink, Clock } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const TIPO_LABELS = { llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Email', visita: 'Visita', otro: 'Otro' }
const TIPO_ICONS = { llamada: Phone, whatsapp: MessageCircle, email: Mail, visita: MapPin, otro: MoreHorizontal }
const PIPELINE_STEPS = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada']

function getWhatsAppLink(phone) {
  if (!phone) return null
  const cleaned = phone.replace(/\D/g, '')
  const number = cleaned.startsWith('54') ? cleaned : '54' + cleaned
  return `https://wa.me/${number}`
}

export default function LeadDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, isAdmin } = useAuth()
  const { addToast } = useToast()
  
  const [lead, setLead] = useState(null)
  const [interactions, setInteractions] = useState([])
  const [loading, setLoading] = useState(true)
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isInteractionModalOpen, setIsInteractionModalOpen] = useState(false)
  
  const [vendedores, setVendedores] = useState([])
  
  // Edit Form State
  const [editForm, setEditForm] = useState({
    nombre: '', telefono: '', email: '', modelo_interes: '', origen: '', estado: '', vendedor_asignado: '', presupuesto_estimado: '', notas: ''
  })
  
  // New Interaction State
  const [interactionForm, setInteractionForm] = useState({
    tipo: 'llamada', detalle: ''
  })

  useEffect(() => {
    fetchLead()
    fetchInteractions()
    if (isAdmin) fetchVendedores()
  }, [id])

  async function fetchLead() {
    const { data, error } = await supabase
      .from('leads')
      .select(`
        *,
        vendedor:profiles!vendedor_asignado(full_name)
      `)
      .eq('id', id)
      .single()
      
    if (error) {
      addToast('Error al cargar el lead', 'error')
      console.error(error)
      return
    }
    setLead(data)
    setEditForm({
      nombre: data.nombre || '',
      telefono: data.telefono || '',
      email: data.email || '',
      modelo_interes: data.modelo_interes || '',
      origen: data.origen || '',
      estado: data.estado || '',
      vendedor_asignado: data.vendedor_asignado || '',
      presupuesto_estimado: data.presupuesto_estimado || '',
      notas: data.notas || ''
    })
    setLoading(false)
  }

  async function fetchInteractions() {
    const { data, error } = await supabase
      .from('interacciones')
      .select(`
        *,
        usuario:profiles!usuario_id(full_name)
      `)
      .eq('lead_id', id)
      .order('fecha', { ascending: false })
      
    if (error) {
      console.error('Error fetching interactions', error)
      return
    }
    setInteractions(data)
  }

  async function fetchVendedores() {
    const { data } = await supabase.from('profiles').select('id, full_name').order('full_name')
    if (data) setVendedores(data)
  }

  async function handleStatusChange(newStatus) {
    if (!lead || newStatus === lead.estado) return
    const confirm = window.confirm(`¿Cambiar estado a ${STATUS_LABELS[newStatus]}?`)
    if (!confirm) return
    const { error } = await supabase.from('leads').update({ estado: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) {
      addToast('Error al cambiar el estado', 'error')
    } else {
      fetchLead()
      addToast(`Estado cambiado a ${STATUS_LABELS[newStatus]}`, 'success')
    }
  }

  async function handleUpdateLead(e) {
    e.preventDefault()
    const { error } = await supabase
      .from('leads')
      .update({ ...editForm, updated_at: new Date().toISOString() })
      .eq('id', id)
      
    if (error) {
      addToast('Error al actualizar el lead', 'error')
      return
    }
    
    addToast('Lead actualizado', 'success')
    setIsEditModalOpen(false)
    fetchLead()
  }

  async function handleSaveInteraction(e) {
    e.preventDefault()
    
    const newInteraction = {
      lead_id: id,
      usuario_id: user.id,
      tipo: interactionForm.tipo,
      detalle: interactionForm.detalle
    }
    
    const { error } = await supabase
      .from('interacciones')
      .insert([newInteraction])
      
    if (error) {
      addToast('Error al guardar interacción', 'error')
      return
    }
    
    if (lead.estado === 'nuevo') {
      await supabase.from('leads').update({ estado: 'contactado', updated_at: new Date().toISOString() }).eq('id', id)
      addToast('Interacción guardada y estado actualizado a Contactado', 'success')
    } else {
      addToast('Interacción guardada', 'success')
    }
    
    setIsInteractionModalOpen(false)
    setInteractionForm({ tipo: 'llamada', detalle: '' })
    fetchInteractions()
    fetchLead()
  }

  if (loading) return <div className="p-8 text-center text-[var(--color-text-secondary)]">Cargando lead...</div>
  if (!lead) return <div className="p-8 text-center text-[var(--color-text-secondary)]">Lead no encontrado</div>

  const currentStepIndex = PIPELINE_STEPS.indexOf(lead.estado)

  return (
    <div className="lead-detail-page p-6 max-w-6xl mx-auto animate-fade-in">
      <button onClick={() => navigate('/leads')} className="btn btn-ghost mb-6 flex items-center gap-2">
        <ArrowLeft size={18} /> Volver a Leads
      </button>

      {/* PIPELINE */}
      <div className="pipeline-container card mb-6 p-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 uppercase tracking-wider">Estado del Lead</h3>
        {lead.estado === 'perdido' ? (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center font-medium">
            Estado: Perdido
            <button className="ml-4 text-sm underline opacity-80 hover:opacity-100" onClick={() => handleStatusChange('nuevo')}>Reactivar</button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full relative">
            <div className="absolute top-1/2 left-0 right-0 h-1 bg-[var(--color-border)] -translate-y-1/2 z-0 rounded-full" />
            
            {PIPELINE_STEPS.map((step, index) => {
              const isCompleted = index <= currentStepIndex
              const isActive = index === currentStepIndex
              
              return (
                <div key={step} className="relative z-10 flex flex-col items-center flex-1 cursor-pointer group" onClick={() => handleStatusChange(step)}>
                  <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300
                    ${isCompleted ? 'bg-[var(--color-primary)] text-white shadow-[0_0_15px_var(--color-primary-alpha)]' : 'bg-[var(--color-bg-secondary)] border-2 border-[var(--color-border)] text-[var(--color-text-secondary)]'}
                    ${isActive ? 'ring-4 ring-[var(--color-primary-alpha)]' : ''}
                    group-hover:scale-110
                  `}>
                    {index + 1}
                  </div>
                  <span className={`
                    mt-2 text-xs font-semibold whitespace-nowrap transition-colors
                    ${isActive ? 'text-[var(--color-primary)]' : isCompleted ? 'text-[var(--color-text)]' : 'text-[var(--color-text-tertiary)]'}
                  `}>
                    {STATUS_LABELS[step]}
                  </span>
                </div>
              )
            })}
            {/* Completed Line Overlay */}
            <div 
              className="absolute top-1/2 left-0 h-1 bg-[var(--color-primary)] -translate-y-1/2 z-0 rounded-full transition-all duration-500 ease-in-out" 
              style={{ width: `${currentStepIndex >= 0 ? (currentStepIndex / (PIPELINE_STEPS.length - 1)) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>

      {/* QUICK ACTIONS */}
      <div className="quick-actions-bar flex flex-wrap gap-3 mb-6">
        <a 
          href={getWhatsAppLink(lead.telefono) || '#'} 
          target="_blank" 
          rel="noopener noreferrer"
          className={`btn flex-1 flex items-center justify-center gap-2 ${!lead.telefono ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'bg-green-600 hover:bg-green-700 text-white'}`}
          onClick={(e) => !lead.telefono && e.preventDefault()}
        >
          <MessageCircle size={18} /> WhatsApp
        </a>
        <a 
          href={lead.telefono ? `tel:${lead.telefono}` : '#'}
          className={`btn flex-1 flex items-center justify-center gap-2 ${!lead.telefono ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
          onClick={(e) => !lead.telefono && e.preventDefault()}
        >
          <Phone size={18} /> Llamar
        </a>
        <a 
          href={lead.email ? `mailto:${lead.email}` : '#'}
          className={`btn flex-1 flex items-center justify-center gap-2 ${!lead.email ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]'}`}
          onClick={(e) => !lead.email && e.preventDefault()}
        >
          <Mail size={18} /> Email
        </a>
        <button 
          onClick={() => setIsEditModalOpen(true)}
          className="btn flex-1 flex items-center justify-center gap-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white"
        >
          <Edit size={18} /> Editar Lead
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN - LEAD INFO */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2 border-b border-[var(--color-border)] pb-4">
              Información del Lead
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Nombre</label>
                <div className="font-medium text-lg">{lead.nombre}</div>
              </div>
              
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Teléfono</label>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{lead.telefono || '-'}</span>
                  {lead.telefono && <a href={getWhatsAppLink(lead.telefono)} target="_blank" rel="noopener noreferrer" className="text-green-500 hover:text-green-400"><ExternalLink size={14} /></a>}
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Email</label>
                <div className="font-medium">{lead.email || '-'}</div>
              </div>
              
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Modelo de Interés</label>
                <div className="font-medium">{lead.modelo_interes || '-'}</div>
              </div>
              
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Presupuesto Estimado</label>
                <div className="font-medium">
                  {lead.presupuesto_estimado ? `$${Number(lead.presupuesto_estimado).toLocaleString('es-AR')}` : '-'}
                </div>
              </div>
              
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Origen</label>
                <div className="inline-flex px-2 py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm capitalize">
                  {lead.origen || '-'}
                </div>
              </div>
              
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Vendedor Asignado</label>
                <div className="font-medium flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[var(--color-primary-alpha)] flex items-center justify-center text-xs text-[var(--color-primary)] font-bold">
                    {lead.vendedor?.full_name ? lead.vendedor.full_name.charAt(0).toUpperCase() : '?'}
                  </div>
                  {lead.vendedor?.full_name || 'Sin Asignar'}
                </div>
              </div>
              
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold block mb-1">Notas</label>
                <div className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] p-3 rounded-lg min-h-[60px] whitespace-pre-wrap">
                  {lead.notas || 'Sin notas.'}
                </div>
              </div>
              
              <div className="pt-4 border-t border-[var(--color-border)] grid grid-cols-2 gap-4 text-xs text-[var(--color-text-tertiary)]">
                <div>
                  <div className="font-semibold mb-1">Creado</div>
                  <div>{new Date(lead.created_at).toLocaleString('es-AR')}</div>
                </div>
                <div>
                  <div className="font-semibold mb-1">Última Act.</div>
                  <div>{new Date(lead.updated_at).toLocaleString('es-AR')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - INTERACTIONS */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6 border-b border-[var(--color-border)] pb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Clock size={20} className="text-[var(--color-primary)]" />
                Historial de Interacciones
                <span className="bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] text-sm px-2 py-0.5 rounded-full ml-2">
                  {interactions.length}
                </span>
              </h2>
              <button onClick={() => setIsInteractionModalOpen(true)} className="btn btn-primary btn-sm flex items-center gap-1">
                <Plus size={16} /> Nueva Interacción
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2">
              {interactions.length === 0 ? (
                <div className="text-center p-12 text-[var(--color-text-secondary)] flex flex-col items-center">
                  <MessageCircle size={48} className="opacity-20 mb-4" />
                  <p className="font-medium">No hay interacciones registradas</p>
                  <p className="text-sm mt-1">Registra la primera llamada o mensaje con el lead.</p>
                </div>
              ) : (
                <div className="relative pl-6 border-l-2 border-[var(--color-border)] ml-3 space-y-6 pb-4">
                  {interactions.map((interaction, i) => {
                    const Icon = TIPO_ICONS[interaction.tipo] || MoreHorizontal
                    return (
                      <div key={interaction.id} className="relative">
                        <div className="absolute -left-[35px] bg-[var(--color-surface)] border-2 border-[var(--color-border)] p-1.5 rounded-full">
                          <Icon size={14} className="text-[var(--color-primary)]" />
                        </div>
                        <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 shadow-sm border border-[var(--color-border)] transition-transform hover:-translate-y-1">
                          <div className="flex justify-between items-start mb-2">
                            <span className="font-semibold text-[var(--color-text)] flex items-center gap-2">
                              {TIPO_LABELS[interaction.tipo]}
                            </span>
                            <span className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1">
                              <Clock size={12} />
                              {new Date(interaction.created_at).toLocaleString('es-AR')}
                            </span>
                          </div>
                          <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{interaction.detalle}</p>
                          <div className="mt-3 text-xs text-[var(--color-text-tertiary)] flex items-center gap-1 pt-3 border-t border-[var(--color-border)]">
                            <span className="w-4 h-4 rounded-full bg-[var(--color-primary-alpha)] flex items-center justify-center text-[var(--color-primary)] font-bold">
                              {interaction.usuario?.full_name ? interaction.usuario.full_name.charAt(0).toUpperCase() : '?'}
                            </span>
                            Registrado por {interaction.usuario?.full_name || 'Desconocido'}
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
      </div>

      {/* EDIT MODAL */}
      {isEditModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content max-w-2xl w-full">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Editar Lead</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-[var(--color-text-secondary)] hover:text-white">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleUpdateLead} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-group">
                  <label>Nombre Completo *</label>
                  <input type="text" className="input" required value={editForm.nombre} onChange={e => setEditForm({...editForm, nombre: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input type="tel" className="input" value={editForm.telefono} onChange={e => setEditForm({...editForm, telefono: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" className="input" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Modelo de Interés</label>
                  <input type="text" className="input" value={editForm.modelo_interes} onChange={e => setEditForm({...editForm, modelo_interes: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Origen</label>
                  <select className="input" value={editForm.origen} onChange={e => setEditForm({...editForm, origen: e.target.value})}>
                    <option value="">Seleccionar...</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                    <option value="web">Sitio Web</option>
                    <option value="showroom">Showroom</option>
                    <option value="referido">Referido</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select className="input" required value={editForm.estado} onChange={e => setEditForm({...editForm, estado: e.target.value})}>
                    {Object.entries(STATUS_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                {isAdmin && (
                  <div className="form-group">
                    <label>Vendedor Asignado</label>
                    <select className="input" value={editForm.vendedor_asignado} onChange={e => setEditForm({...editForm, vendedor_asignado: e.target.value})}>
                      <option value="">Sin asignar</option>
                      {vendedores.map(v => (
                        <option key={v.id} value={v.id}>{v.full_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="form-group">
                  <label>Presupuesto Estimado ($)</label>
                  <input type="number" className="input" value={editForm.presupuesto_estimado} onChange={e => setEditForm({...editForm, presupuesto_estimado: e.target.value})} />
                </div>
              </div>
              
              <div className="form-group">
                <label>Notas</label>
                <textarea className="input min-h-[100px]" value={editForm.notas} onChange={e => setEditForm({...editForm, notas: e.target.value})}></textarea>
              </div>
              
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="btn btn-ghost">Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar Cambios</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW INTERACTION MODAL */}
      {isInteractionModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content max-w-lg w-full">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Registrar Interacción</h2>
              <button onClick={() => setIsInteractionModalOpen(false)} className="text-[var(--color-text-secondary)] hover:text-white">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSaveInteraction} className="space-y-4">
              <div className="form-group">
                <label>Tipo de Interacción *</label>
                <select className="input" required value={interactionForm.tipo} onChange={e => setInteractionForm({...interactionForm, tipo: e.target.value})}>
                  {Object.entries(TIPO_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Detalle *</label>
                <textarea 
                  className="input min-h-[120px]" 
                  required 
                  placeholder="Resumen de la llamada, mensaje enviado, etc."
                  value={interactionForm.detalle} 
                  onChange={e => setInteractionForm({...interactionForm, detalle: e.target.value})}
                ></textarea>
              </div>
              
              {lead.estado === 'nuevo' && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400">
                  <span className="font-semibold block mb-1">Nota automática:</span>
                  El estado del lead se cambiará a <strong>Contactado</strong> al guardar esta interacción.
                </div>
              )}
              
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsInteractionModalOpen(false)} className="btn btn-ghost">Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar Interacción</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
