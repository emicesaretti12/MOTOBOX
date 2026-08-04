import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, X, KeyRound, Users, TrendingUp, Award, Target } from 'lucide-react'

const EMPTY_USER = { dni: '', full_name: '', password: '', role: 'empleado' }

export default function UsersPage() {
  const { profile } = useAuth()
  const { addToast } = useToast()
  const [profiles, setProfiles] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [formData, setFormData] = useState(EMPTY_USER)
  const [resetPassword, setResetPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
    const handler = () => setShowCreateModal(true)
    window.addEventListener('open-new-user', handler)
    return () => window.removeEventListener('open-new-user', handler)
  }, [])

  async function fetchData() {
    try {
      const [profilesRes, leadsRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('leads').select('vendedor_asignado, estado, presupuesto_estimado')
      ])
      setProfiles(profilesRes.data || [])
      setLeads(leadsRes.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function getVendorStats(vendorId) {
    const vendorLeads = leads.filter(l => l.vendedor_asignado === vendorId)
    const total = vendorLeads.length
    const ventas = vendorLeads.filter(l => l.estado === 'venta_cerrada').length
    const conversion = total > 0 ? ((ventas / total) * 100).toFixed(0) : '0'
    const revenue = vendorLeads
      .filter(l => l.estado === 'venta_cerrada' && l.presupuesto_estimado)
      .reduce((sum, l) => sum + Number(l.presupuesto_estimado), 0)
    return { total, ventas, conversion, revenue }
  }

  function getInitials(name) {
    return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?'
  }

  const empleados = profiles.filter(p => p.role === 'empleado')

  async function handleCreate(e) {
    e.preventDefault()
    if (!formData.dni || !formData.full_name || !formData.password) {
      addToast('Completá todos los campos', 'error')
      return
    }
    if (formData.password.length < 6) {
      addToast('La contraseña debe tener al menos 6 caracteres', 'error')
      return
    }
    setSaving(true)
    try {
      const email = `${formData.dni}@motobox-internal.local`
      const { data: { session } } = await supabase.auth.getSession()

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          email,
          password: formData.password,
          dni: formData.dni,
          full_name: formData.full_name,
          role: formData.role
        })
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || 'Error al crear usuario')
      }

      addToast('Usuario creado correctamente', 'success')
      setShowCreateModal(false)
      setFormData(EMPTY_USER)
      fetchData()
    } catch (err) {
      addToast(err.message || 'Error al crear usuario. Verificá que la Edge Function esté desplegada.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    if (!resetPassword || resetPassword.length < 6) {
      addToast('La contraseña debe tener al menos 6 caracteres', 'error')
      return
    }
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          user_id: selectedUser.id,
          new_password: resetPassword
        })
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || 'Error al resetear contraseña')
      }

      addToast('Contraseña actualizada', 'success')
      setShowResetModal(false)
      setResetPassword('')
      setSelectedUser(null)
    } catch (err) {
      addToast(err.message || 'Error al resetear. Verificá que la Edge Function esté desplegada.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="spinner-overlay"><div className="spinner" /></div>
  }

  return (
    <div>
      {/* Vendor Performance Cards */}
      {empleados.length > 0 && (
        <div className="vendor-grid">
          {empleados.map(emp => {
            const stats = getVendorStats(emp.id)
            return (
              <div key={emp.id} className="vendor-card">
                <div className="vendor-card-head">
                  <div className="vendor-avatar">{getInitials(emp.full_name)}</div>
                  <div>
                    <div className="vendor-name">{emp.full_name}</div>
                    <div className="vendor-role">Vendedor</div>
                  </div>
                </div>
                <div className="vendor-stats">
                  <div className="vendor-stat">
                    <div className="vendor-stat-val">{stats.total}</div>
                    <div className="vendor-stat-lbl">Leads</div>
                  </div>
                  <div className="vendor-stat">
                    <div className="vendor-stat-val">{stats.ventas}</div>
                    <div className="vendor-stat-lbl">Ventas</div>
                  </div>
                  <div className="vendor-stat">
                    <div className="vendor-stat-val">{stats.conversion}%</div>
                    <div className="vendor-stat-lbl">Conversión</div>
                  </div>
                  <div className="vendor-stat">
                    <div className="vendor-stat-val">${stats.revenue.toLocaleString('es-AR')}</div>
                    <div className="vendor-stat-lbl">Revenue</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Users Table */}
      <div className="card">
        <div className="card-header">
          <h3>Usuarios del Sistema</h3>
        </div>
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>DNI</th>
                <th>Rol</th>
                <th>Leads</th>
                <th>Conversión</th>
                <th>Fecha Alta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => {
                const stats = getVendorStats(p.id)
                return (
                  <tr key={p.id}>
                    <td className="table-cell-primary">{p.full_name}</td>
                    <td>{p.dni}</td>
                    <td>
                      <span className={`badge badge-${p.role}`}>
                        {p.role === 'admin' ? 'Admin' : 'Empleado'}
                      </span>
                    </td>
                    <td>{stats.total}</td>
                    <td>{stats.conversion}%</td>
                    <td className="table-cell-secondary">
                      {new Date(p.created_at).toLocaleDateString('es-AR')}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setSelectedUser(p); setShowResetModal(true) }}
                      >
                        <KeyRound size={14} />
                        Resetear
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nuevo Usuario</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">DNI</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Ej: 12345678"
                    value={formData.dni}
                    onChange={e => setFormData({ ...formData, dni: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Nombre Completo</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Nombre y Apellido"
                    value={formData.full_name}
                    onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Contraseña Provisoria</label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    required
                    minLength={6}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Rol</label>
                  <select
                    className="form-input"
                    value={formData.role}
                    onChange={e => setFormData({ ...formData, role: e.target.value })}
                  >
                    <option value="empleado">Empleado</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Creando...' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Resetear Contraseña</h3>
              <button className="modal-close" onClick={() => setShowResetModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleReset}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Usuario</label>
                  <input className="form-input" type="text" value={`${selectedUser.full_name} (${selectedUser.dni})`} disabled />
                </div>
                <div className="form-group">
                  <label className="form-label">Nueva Contraseña</label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowResetModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Guardando...' : 'Resetear Contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
