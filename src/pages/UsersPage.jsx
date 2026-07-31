import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { Plus, X, KeyRound } from 'lucide-react'

export default function UsersPage() {
  const { addToast } = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [createForm, setCreateForm] = useState({
    dni: '',
    full_name: '',
    password: '',
    role: 'empleado',
  })

  useEffect(() => {
    fetchUsers()

    const handleOpenNewUser = () => setShowCreateModal(true)
    window.addEventListener('open-new-user', handleOpenNewUser)
    return () => window.removeEventListener('open-new-user', handleOpenNewUser)
  }, [])

  async function fetchUsers() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setUsers(data || [])
    } catch (err) {
      console.error('Error fetching users:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault()
    setSaving(true)

    try {
      // Call the Edge Function to create user
      const { data: { session } } = await supabase.auth.getSession()
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            dni: createForm.dni,
            full_name: createForm.full_name,
            password: createForm.password,
            role: createForm.role,
          }),
        }
      )

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Error al crear usuario')

      addToast('Usuario creado correctamente', 'success')
      setShowCreateModal(false)
      setCreateForm({ dni: '', full_name: '', password: '', role: 'empleado' })
      fetchUsers()
    } catch (err) {
      console.error('Error creating user:', err)
      addToast(err.message || 'Error al crear usuario', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    setSaving(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            user_id: selectedUser.id,
            new_password: newPassword,
          }),
        }
      )

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Error al resetear contraseña')

      addToast('Contraseña reseteada correctamente', 'success')
      setShowResetModal(false)
      setNewPassword('')
      setSelectedUser(null)
    } catch (err) {
      console.error('Error resetting password:', err)
      addToast(err.message || 'Error al resetear contraseña', 'error')
    } finally {
      setSaving(false)
    }
  }

  function openResetModal(user) {
    setSelectedUser(user)
    setNewPassword('')
    setShowResetModal(true)
  }

  if (loading) {
    return <div className="spinner-overlay"><div className="spinner" /></div>
  }

  return (
    <div>
      <div className="card">
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>DNI</th>
                <th>Rol</th>
                <th>Fecha de Alta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <p>No hay usuarios registrados</p>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user.id}>
                    <td style={{ fontWeight: 600 }}>{user.full_name}</td>
                    <td>{user.dni}</td>
                    <td>
                      <span className={`badge ${user.role === 'admin' ? 'badge-venta_cerrada' : 'badge-nuevo'}`}>
                        {user.role === 'admin' ? 'Admin' : 'Empleado'}
                      </span>
                    </td>
                    <td>{new Date(user.created_at).toLocaleDateString('es-AR')}</td>
                    <td>
                      <div className="user-actions">
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => openResetModal(user)}
                          title="Resetear contraseña"
                        >
                          <KeyRound size={14} /> Resetear clave
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Crear Usuario */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nuevo Usuario</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="form-group">
                    <label>DNI *</label>
                    <input
                      required
                      value={createForm.dni}
                      onChange={(e) => setCreateForm({ ...createForm, dni: e.target.value })}
                      placeholder="Número de DNI"
                    />
                  </div>
                  <div className="form-group">
                    <label>Nombre Completo *</label>
                    <input
                      required
                      value={createForm.full_name}
                      onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                      placeholder="Nombre y apellido"
                    />
                  </div>
                  <div className="form-group">
                    <label>Contraseña Provisoria *</label>
                    <input
                      required
                      type="password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      placeholder="Mínimo 6 caracteres"
                      minLength={6}
                    />
                  </div>
                  <div className="form-group">
                    <label>Rol</label>
                    <select
                      value={createForm.role}
                      onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                    >
                      <option value="empleado">Empleado</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
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

      {/* Modal: Resetear Contraseña */}
      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Resetear Contraseña</h2>
              <button className="modal-close" onClick={() => setShowResetModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <p style={{ marginBottom: 16, color: '#666' }}>
                  Reseteando contraseña de <strong>{selectedUser?.full_name}</strong> (DNI: {selectedUser?.dni})
                </p>
                <div className="form-group">
                  <label>Nueva Contraseña *</label>
                  <input
                    required
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    minLength={6}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowResetModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Reseteando...' : 'Resetear Contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
