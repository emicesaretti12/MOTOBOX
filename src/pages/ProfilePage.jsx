import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { User, KeyRound, Shield } from 'lucide-react'

export default function ProfilePage() {
  const { user, profile } = useAuth()
  const { addToast } = useToast()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  function getInitials(name) {
    return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?'
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      addToast('Las contraseñas no coinciden', 'error')
      return
    }
    if (newPassword.length < 6) {
      addToast('La contraseña debe tener al menos 6 caracteres', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      addToast('Contraseña actualizada correctamente', 'success')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      addToast(err.message || 'Error al cambiar contraseña', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-grid">
      {/* Profile Info */}
      <div className="card">
        <div className="card-header">
          <h3>Información Personal</h3>
        </div>
        <div className="card-body">
          <div className="profile-avatar-lg">
            {getInitials(profile?.full_name)}
          </div>

          <div className="detail-row">
            <div className="detail-label">Nombre Completo</div>
            <div className="detail-value">{profile?.full_name || '-'}</div>
          </div>

          <div className="detail-row">
            <div className="detail-label">DNI</div>
            <div className="detail-value">
              {profile?.dni || '-'}
              <div className="form-hint">El DNI no puede modificarse</div>
            </div>
          </div>

          <div className="detail-row">
            <div className="detail-label">Rol</div>
            <div className="detail-value">
              <span className={`badge badge-${profile?.role}`}>
                {profile?.role === 'admin' ? 'Administrador' : 'Empleado'}
              </span>
            </div>
          </div>

          <div className="detail-row">
            <div className="detail-label">Miembro desde</div>
            <div className="detail-value">
              {profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
                : '-'}
            </div>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="card">
        <div className="card-header">
          <h3>Cambiar Contraseña</h3>
        </div>
        <div className="card-body">
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label className="form-label">Nueva Contraseña</label>
              <input
                className="form-input"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirmar Contraseña</label>
              <input
                className="form-input"
                type="password"
                placeholder="Repetí la contraseña"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={saving}>
              {saving ? 'Guardando...' : 'Actualizar Contraseña'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
