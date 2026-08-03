import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { Plus, X, KeyRound, Users, TrendingUp, Award, Target } from 'lucide-react'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)

  // Create User Form
  const [createForm, setCreateForm] = useState({
    dni: '',
    nombre_completo: '',
    password: '',
    rol: 'empleado'
  })
  const [isCreating, setIsCreating] = useState(false)

  // Reset Password Form
  const [resetForm, setResetForm] = useState({
    password: ''
  })
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    fetchData()

    const handler = () => setShowCreateModal(true)
    window.addEventListener('open-new-user', handler)
    return () => window.removeEventListener('open-new-user', handler)
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [profilesRes, leadsRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('leads').select('vendedor_asignado, estado, presupuesto_estimado')
      ])

      if (profilesRes.error) throw profilesRes.error
      if (leadsRes.error) throw leadsRes.error

      setUsers(profilesRes.data || [])
      setLeads(leadsRes.data || [])
    } catch (error) {
      console.error('Error fetching data:', error)
      showToast('Error al cargar datos', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    if (createForm.password.length < 6) {
      showToast('La contraseña debe tener al menos 6 caracteres', 'error')
      return
    }

    try {
      setIsCreating(true)
      const { data: { session } } = await supabase.auth.getSession()
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({
          dni: createForm.dni,
          nombre_completo: createForm.nombre_completo,
          password: createForm.password,
          rol: createForm.rol
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error al crear usuario')
      }

      showToast('Usuario creado exitosamente', 'success')
      setShowCreateModal(false)
      setCreateForm({ dni: '', nombre_completo: '', password: '', rol: 'empleado' })
      fetchData()
    } catch (error) {
      console.error('Error creating user:', error)
      showToast(error.message || 'Error al crear usuario', 'error')
    } finally {
      setIsCreating(false)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    if (resetForm.password.length < 6) {
      showToast('La contraseña debe tener al menos 6 caracteres', 'error')
      return
    }

    try {
      setIsResetting(true)
      const { data: { session } } = await supabase.auth.getSession()
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          newPassword: resetForm.password
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error al restablecer contraseña')
      }

      showToast('Contraseña restablecida exitosamente', 'success')
      setShowResetModal(false)
      setResetForm({ password: '' })
      setSelectedUser(null)
    } catch (error) {
      console.error('Error resetting password:', error)
      showToast(error.message || 'Error al restablecer contraseña', 'error')
    } finally {
      setIsResetting(false)
    }
  }

  // Calculate vendor stats
  const vendorStats = users
    .filter(u => u.rol === 'empleado')
    .map(vendor => {
      const vendorLeads = leads.filter(l => l.vendedor_asignado === vendor.id)
      const closedLeads = vendorLeads.filter(l => l.estado === 'cerrado_ganado' || l.estado === 'Cerrado Ganado') 
      const totalLeads = vendorLeads.length
      const closedCount = closedLeads.length
      const conversionRate = totalLeads > 0 ? Math.round((closedCount / totalLeads) * 100) : 0
      const revenue = closedLeads.reduce((sum, lead) => sum + (Number(lead.presupuesto_estimado) || 0), 0)

      return {
        ...vendor,
        totalLeads,
        closedCount,
        conversionRate,
        revenue
      }
    })

  const getInitials = (name) => {
    if (!name) return '?'
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
  }

  if (loading) {
    return <div className="p-6 flex justify-center items-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-600" />
            Gestión de Usuarios
          </h1>
          <p className="text-gray-500 mt-1">Administra los usuarios y vendedores del sistema.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium shadow-sm"
        >
          <Plus className="w-5 h-5" />
          Nuevo Usuario
        </button>
      </div>

      {/* Vendor Performance Cards */}
      {vendorStats.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" />
            Rendimiento de Vendedores
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 vendor-cards-grid">
            {vendorStats.map(vendor => (
              <div key={vendor.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 vendor-perf-card hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-inner vendor-perf-avatar">
                    {getInitials(vendor.nombre_completo)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 vendor-perf-name">{vendor.nombre_completo}</h3>
                    <p className="text-sm text-gray-500">Vendedor</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 vendor-perf-stats">
                  <div className="bg-gray-50 rounded-xl p-3 vendor-perf-stat">
                    <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium mb-1 vendor-perf-stat-label">
                      <Target className="w-3.5 h-3.5" /> Leads
                    </div>
                    <div className="text-xl font-bold text-gray-900 vendor-perf-stat-value">{vendor.totalLeads}</div>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3 vendor-perf-stat">
                    <div className="flex items-center gap-1.5 text-blue-600 text-xs font-medium mb-1 vendor-perf-stat-label">
                      <TrendingUp className="w-3.5 h-3.5" /> Cierres
                    </div>
                    <div className="text-xl font-bold text-blue-700 vendor-perf-stat-value">{vendor.closedCount}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-3 vendor-perf-stat">
                    <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium mb-1 vendor-perf-stat-label">
                      <Award className="w-3.5 h-3.5" /> Conversión
                    </div>
                    <div className="text-xl font-bold text-emerald-700 vendor-perf-stat-value">{vendor.conversionRate}%</div>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 vendor-perf-stat">
                    <div className="flex items-center gap-1.5 text-amber-600 text-xs font-medium mb-1 vendor-perf-stat-label">
                      Ingresos Est.
                    </div>
                    <div className="text-xl font-bold text-amber-700 vendor-perf-stat-value truncate" title={`$${vendor.revenue.toLocaleString()}`}>
                      ${vendor.revenue > 1000000 ? (vendor.revenue/1000000).toFixed(1) + 'M' : vendor.revenue.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="py-4 px-6 text-sm font-semibold text-gray-600">Nombre</th>
                <th className="py-4 px-6 text-sm font-semibold text-gray-600">DNI</th>
                <th className="py-4 px-6 text-sm font-semibold text-gray-600">Rol</th>
                <th className="py-4 px-6 text-sm font-semibold text-gray-600 text-center">Leads Asignados</th>
                <th className="py-4 px-6 text-sm font-semibold text-gray-600 text-center">Conversión (%)</th>
                <th className="py-4 px-6 text-sm font-semibold text-gray-600">Fecha de Alta</th>
                <th className="py-4 px-6 text-sm font-semibold text-gray-600 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(user => {
                const userStats = vendorStats.find(v => v.id === user.id)
                const isEmployee = user.rol === 'empleado'
                
                return (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-medium text-xs">
                          {getInitials(user.nombre_completo)}
                        </div>
                        <span className="font-medium text-gray-900">{user.nombre_completo}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-gray-500 font-medium">{user.dni}</td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        user.rol === 'admin' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {user.rol === 'admin' ? 'admin' : 'empleado'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      {isEmployee ? (
                        <span className="inline-block bg-gray-100 text-gray-700 px-3 py-1 rounded-lg font-semibold text-sm">
                          {userStats?.totalLeads || 0}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {isEmployee ? (
                        <span className={`font-semibold ${userStats?.conversionRate > 20 ? 'text-emerald-600' : 'text-gray-600'}`}>
                          {userStats?.conversionRate || 0}%
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-gray-500 text-sm">
                      {new Date(user.created_at).toLocaleDateString('es-AR')}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={() => {
                          setSelectedUser(user)
                          setShowResetModal(true)
                        }}
                        className="text-gray-400 hover:text-blue-600 transition-colors p-2 rounded-lg hover:bg-blue-50"
                        title="Restablecer Contraseña"
                      >
                        <KeyRound className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-gray-500">
                    No hay usuarios registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-semibold text-lg text-gray-900">Crear Nuevo Usuario</h3>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateUser} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={createForm.nombre_completo}
                  onChange={e => setCreateForm({...createForm, nombre_completo: e.target.value})}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  placeholder="Ej: Juan Pérez"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">DNI</label>
                <input
                  type="text"
                  required
                  pattern="[0-9]+"
                  value={createForm.dni}
                  onChange={e => setCreateForm({...createForm, dni: e.target.value})}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  placeholder="Sin puntos ni espacios"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña Provisoria</label>
                <input
                  type="text"
                  required
                  minLength={6}
                  value={createForm.password}
                  onChange={e => setCreateForm({...createForm, password: e.target.value})}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Rol</label>
                <select
                  value={createForm.rol}
                  onChange={e => setCreateForm({...createForm, rol: e.target.value})}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none appearance-none"
                >
                  <option value="empleado">Empleado (Vendedor)</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                >
                  {isCreating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creando...
                    </>
                  ) : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-semibold text-lg text-gray-900">Restablecer Contraseña</h3>
              <button 
                onClick={() => {
                  setShowResetModal(false)
                  setSelectedUser(null)
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 bg-blue-50/50 border-b border-blue-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                  {getInitials(selectedUser.nombre_completo)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{selectedUser.nombre_completo}</p>
                  <p className="text-sm text-gray-500">DNI: {selectedUser.dni}</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleResetPassword} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva Contraseña</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={resetForm.password}
                    onChange={e => setResetForm({password: e.target.value})}
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
              </div>
              
              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetModal(false)
                    setSelectedUser(null)
                  }}
                  className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                >
                  {isResetting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Guardando...
                    </>
                  ) : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
