import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { ArrowLeft, Phone, MessageCircle, Mail, MapPin, MoreHorizontal, Edit, Plus, X, Check } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const TIPO_LABELS = { llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Email', visita: 'Visita', otro: 'Otro' }
const PIPELINE = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada']
const TIPO_ICONS = { llamada: Phone, whatsapp: MessageCircle, email: Mail, visita: MapPin, otro: MoreHorizontal }

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '-' }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-' }
function getWa(ph) { if (!ph) return null; const c = ph.replace(/\D/g, ''); return 'https://wa.me/' + (c.startsWith('54') ? c : '54' + c) }

export default function LeadDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, isAdmin } = useAuth()
  const { addToast } = useToast()
  const [lead, setLead] = useState(null)
  const [interacciones, setInteracciones] = useState([])
  const [historial, setHistorial] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showIntModal, setShowIntModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [intForm, setIntForm] = useState({ tipo: 'llamada', detalle: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (id) fetchAll() }, [id])

  async function fetchAll() {
    try {
      const [lr, ir, hr, vr] = await Promise.all([
        supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)').eq('id', id).single(),
        supabase.from('interacciones').select('*, usuario:profiles!usuario_id(full_name)').eq('lead_id', id).order('fecha', { ascending: false }),
        supabase.from('historial_cambios').select('*, usuario:profiles!usuario_id(full_name)').eq('lead_id', id).order('created_at', { ascending: false }).limit(20),
        supabase.from('profiles').select('id, full_name').order('full_name')
      ])
      if (lr.error) throw lr.error
      setLead(lr.data)
      setInteracciones(ir.data || [])
      setHistorial(hr.data || [])
      setVendedores(vr.data || [])
    } catch (e) { console.error(e); addToast('Error cargando lead', 'error') }
    finally { setLoading(false) }
  }

  async function handleStatusChange(newStatus) {
    if (newStatus === lead.estado) return
    if (!window.confirm(`¿Cambiar estado a ${STATUS_LABELS[newStatus]}?`)) return
    try {
      const { error } = await supabase.from('leads').update({ estado: newStatus }).eq('id', id)
      if (error) throw error
      await supabase.from('historial_cambios').insert({ lead_id: id, usuario_id: user.id, campo: 'Estado', valor_anterior: STATUS_LABELS[lead.estado], valor_nuevo: STATUS_LABELS[newStatus] })
      addToast('Estado actualizado', 'success')
      fetchAll()
    } catch (e) { addToast('Error', 'error') }
  }

  function openEdit() {
    setEditForm({ nombre: lead.nombre || '', telefono: lead.telefono || '', email: lead.email || '', modelo_interes: lead.modelo_interes || '', origen: lead.origen || 'presencial', estado: lead.estado || 'nuevo', vendedor_asignado: lead.vendedor_asignado || '', presupuesto_estimado: lead.presupuesto_estimado || '', fecha_agenda: lead.fecha_agenda ? lead.fecha_agenda.slice(0, 16) : '', notas: lead.notas || '' })
    setShowEditModal(true)
  }

  async function handleEditSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updates = { ...editForm, vendedor_asignado: editForm.vendedor_asignado || null, presupuesto_estimado: editForm.presupuesto_estimado ? Number(editForm.presupuesto_estimado) : null, fecha_agenda: editForm.fecha_agenda || null }
      const changes = []
      const labels = { nombre: 'Nombre', telefono: 'Teléfono', email: 'Email', modelo_interes: 'Modelo', origen: 'Origen', estado: 'Estado', vendedor_asignado: 'Vendedor', presupuesto_estimado: 'Presupuesto', fecha_agenda: 'Cita', notas: 'Notas' }
      for (const k of Object.keys(labels)) {
        if (String(lead[k] || '') !== String(updates[k] || ''))
          changes.push({ lead_id: id, usuario_id: user.id, campo: labels[k], valor_anterior: String(lead[k] || '') || null, valor_nuevo: String(updates[k] || '') || null })
      }
      const { error } = await supabase.from('leads').update(updates).eq('id', id)
      if (error) throw error
      if (changes.length > 0) await supabase.from('historial_cambios').insert(changes)
      addToast('Lead actualizado', 'success')
      setShowEditModal(false)
      fetchAll()
    } catch (e) { addToast('Error al guardar', 'error') }
    finally { setSaving(false) }
  }

  async function handleIntSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await supabase.from('interacciones').insert({ lead_id: id, usuario_id: user.id, tipo: intForm.tipo, detalle: intForm.detalle })
      if (error) throw error
      if (lead.estado === 'nuevo') await supabase.from('leads').update({ estado: 'contactado' }).eq('id', id)
      addToast('Interacción registrada', 'success')
      setShowIntModal(false)
      setIntForm({ tipo: 'llamada', detalle: '' })
      fetchAll()
    } catch (e) { addToast('Error', 'error') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>
  if (!lead) return <div className="empty-state"><p>Lead no encontrado</p></div>

  const pipeIdx = PIPELINE.indexOf(lead.estado)
  const isPerdido = lead.estado === 'perdido'

  return (
    <div>
      {/* Back + Title */}
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/leads')} style={{ marginBottom: 16 }}><ArrowLeft size={16} /> Volver a Leads</button>

      {/* Pipeline */}
      <div className="pipeline">
        {PIPELINE.map((step, i) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <div className={`pipeline-connector ${i <= pipeIdx && !isPerdido ? 'completed' : ''}`} />}
            <div className={`pipeline-step ${isPerdido ? (step === lead.estado ? 'perdido' : '') : i < pipeIdx ? 'completed' : i === pipeIdx ? 'active' : ''}`} onClick={() => handleStatusChange(step)}>
              <div className="pipeline-dot">{i < pipeIdx && !isPerdido ? <Check size={14} /> : i + 1}</div>
              <span className="pipeline-label">{STATUS_LABELS[step]}</span>
            </div>
          </div>
        ))}
        <div className="pipeline-connector" />
        <div className={`pipeline-step ${isPerdido ? 'perdido' : ''}`} onClick={() => handleStatusChange('perdido')}>
          <div className="pipeline-dot"><X size={14} /></div>
          <span className="pipeline-label">Perdido</span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <a className="quick-action wa" href={getWa(lead.telefono) || '#'} target="_blank" rel="noopener" {...(!lead.telefono && { disabled: true })}><MessageCircle size={16} /> WhatsApp</a>
        <a className="quick-action call" href={lead.telefono ? `tel:${lead.telefono}` : '#'} {...(!lead.telefono && { disabled: true })}><Phone size={16} /> Llamar</a>
        <a className="quick-action mail" href={lead.email ? `mailto:${lead.email}` : '#'} {...(!lead.email && { disabled: true })}><Mail size={16} /> Email</a>
        <button className="quick-action edit" onClick={openEdit}><Edit size={16} /> Editar</button>
      </div>

      {/* Detail Grid */}
      <div className="detail-grid">
        {/* Info Card */}
        <div className="card">
          <div className="card-header"><h3>Información del Lead</h3></div>
          <div className="card-body">
            <div className="detail-row"><span className="detail-label">Nombre</span><span className="detail-value">{lead.nombre}</span></div>
            <div className="detail-row"><span className="detail-label">Teléfono</span><span className="detail-value">{lead.telefono || '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{lead.email || '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Modelo</span><span className="detail-value">{lead.modelo_interes || '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Origen</span><span className="detail-value">{lead.origen}</span></div>
            <div className="detail-row"><span className="detail-label">Presupuesto</span><span className="detail-value">{fmt$(lead.presupuesto_estimado)}</span></div>
            <div className="detail-row"><span className="detail-label">Vendedor</span><span className="detail-value">{lead.vendedor?.full_name || 'Sin asignar'}</span></div>
            <div className="detail-row"><span className="detail-label">Estado</span><span className="detail-value"><span className={`badge badge-${lead.estado}`}>{STATUS_LABELS[lead.estado]}</span></span></div>
            <div className="detail-row"><span className="detail-label">Cita Agendada</span><span className="detail-value">{lead.fecha_agenda ? fmtDate(lead.fecha_agenda) : 'Sin agendar'}</span></div>
            <div className="detail-row"><span className="detail-label">Notas</span><span className="detail-value">{lead.notas || '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Creado</span><span className="detail-value">{fmtDate(lead.created_at)}</span></div>
            <div className="detail-row"><span className="detail-label">Actualizado</span><span className="detail-value">{fmtDate(lead.updated_at)}</span></div>
          </div>
        </div>

        {/* Right Column */}
        <div>
          {/* Interacciones */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3>Interacciones ({interacciones.length})</h3>
              <button className="btn btn-primary btn-sm" onClick={() => setShowIntModal(true)}><Plus size={14} /> Nueva</button>
            </div>
            <div className="card-body">
              {interacciones.length > 0 ? interacciones.map(a => {
                const Icon = TIPO_ICONS[a.tipo] || MoreHorizontal
                return (
                  <div key={a.id} className="timeline-item">
                    <div className={`timeline-icon ${a.tipo}`}><Icon size={16} /></div>
                    <div className="timeline-body">
                      <div className="timeline-type">{TIPO_LABELS[a.tipo] || a.tipo}</div>
                      {a.detalle && <div className="timeline-detail">{a.detalle}</div>}
                      <div className="timeline-meta">{a.usuario?.full_name} • {fmtDate(a.fecha)}</div>
                    </div>
                  </div>
                )
              }) : <div className="empty-state"><p>Sin interacciones aún</p></div>}
            </div>
          </div>

          {/* Historial de Cambios */}
          {historial.length > 0 && (
            <div className="card">
              <div className="card-header"><h3>Historial de Cambios</h3></div>
              <div className="card-body">
                {historial.map(h => (
                  <div key={h.id} className="feed-item">
                    <div className="feed-icon"><Edit size={12} /></div>
                    <div className="feed-body">
                      <div className="feed-text"><strong>{h.usuario?.full_name}</strong> cambió <span className="highlight">{h.campo}</span>: {h.valor_anterior || '(vacío)'} → {h.valor_nuevo || '(vacío)'}</div>
                      <div className="feed-time">{fmtDate(h.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Editar Lead</h3><button className="modal-close" onClick={() => setShowEditModal(false)}><X size={18} /></button></div>
            <form onSubmit={handleEditSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Nombre</label><input className="form-input" value={editForm.nombre} onChange={e => setEditForm({ ...editForm, nombre: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Teléfono</label><input className="form-input" value={editForm.telefono} onChange={e => setEditForm({ ...editForm, telefono: e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Modelo</label><input className="form-input" value={editForm.modelo_interes} onChange={e => setEditForm({ ...editForm, modelo_interes: e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Origen</label><select className="form-input" value={editForm.origen} onChange={e => setEditForm({ ...editForm, origen: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="presencial">Presencial</option><option value="referido">Referido</option><option value="otro">Otro</option></select></div>
                  <div className="form-group"><label className="form-label">Estado</label><select className="form-input" value={editForm.estado} onChange={e => setEditForm({ ...editForm, estado: e.target.value })}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Presupuesto</label><input className="form-input" type="number" value={editForm.presupuesto_estimado} onChange={e => setEditForm({ ...editForm, presupuesto_estimado: e.target.value })} /></div>
                  {isAdmin && <div className="form-group"><label className="form-label">Vendedor</label><select className="form-input" value={editForm.vendedor_asignado} onChange={e => setEditForm({ ...editForm, vendedor_asignado: e.target.value })}><option value="">Sin asignar</option>{vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}</select></div>}
                </div>
                <div className="form-group"><label className="form-label">Fecha y Hora de Cita</label><input className="form-input" type="datetime-local" value={editForm.fecha_agenda} onChange={e => setEditForm({ ...editForm, fecha_agenda: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">Notas</label><textarea className="form-input" rows="3" value={editForm.notas} onChange={e => setEditForm({ ...editForm, notas: e.target.value })}></textarea></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Interaction Modal */}
      {showIntModal && (
        <div className="modal-overlay" onClick={() => setShowIntModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Nueva Interacción</h3><button className="modal-close" onClick={() => setShowIntModal(false)}><X size={18} /></button></div>
            <form onSubmit={handleIntSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tipo</label>
                  <select className="form-input" value={intForm.tipo} onChange={e => setIntForm({ ...intForm, tipo: e.target.value })}>
                    {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Detalle</label>
                  <textarea className="form-input" rows="4" placeholder="¿Qué se habló? ¿Próximos pasos?" value={intForm.detalle} onChange={e => setIntForm({ ...intForm, detalle: e.target.value })}></textarea>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowIntModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Registrar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
