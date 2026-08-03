import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { User, KeyRound, Shield, Lock } from 'lucide-react'

export default function ProfilePage() {
  const { user, profile } = useAuth()
  const { addToast } = useToast()
  
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

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
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      addToast(err.message || 'Error al cambiar contraseña', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
          <User className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Mi Perfil</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Info Card */}
        <div className="card bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="card-header px-6 py-4 border-b border-gray-200 bg-gray-50/50">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-500" />
              Datos Personales
            </h2>
          </div>
          <div className="card-body p-6 space-y-5">
            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Completo</label>
              <div className="w-full p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-800">
                {profile?.nombre_completo || user?.email || 'N/A'}
              </div>
            </div>
            
            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Rol en el Sistema</label>
              <div className="w-full p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-800 capitalize flex items-center">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                  {profile?.rol || 'N/A'}
                </span>
              </div>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">DNI</label>
              <div className="flex items-center gap-2 p-2.5 bg-gray-100 rounded-lg border border-gray-200 text-gray-500 select-none cursor-not-allowed">
                <Lock className="h-4 w-4" />
                <span>{profile?.dni || 'N/A'}</span>
              </div>
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1 font-medium">
                * El DNI no puede modificarse
              </p>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="card bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="card-header px-6 py-4 border-b border-gray-200 bg-gray-50/50">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-indigo-500" />
              Cambiar Contraseña
            </h2>
          </div>
          <div className="card-body p-6">
            <form onSubmit={handleChangePassword} className="space-y-5">
              <div className="form-group">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contraseña Actual <span className="text-gray-400 font-normal">(Opcional)</span>
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow outline-none"
                  placeholder="Tu contraseña actual"
                />
              </div>

              <div className="form-group">
                <label className="block text-sm font-medium text-gray-700 mb-1">Nueva Contraseña</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow outline-none"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>

              <div className="form-group">
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar Nueva Contraseña</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow outline-none"
                  placeholder="Repite la nueva contraseña"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Guardando...
                    </>
                  ) : (
                    'Actualizar Contraseña'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
