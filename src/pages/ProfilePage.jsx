import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Phone, MessageCircle, Mail, MapPin, Target, Award, TrendingUp } from 'lucide-react'

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '$0' }

export default function ProfilePage() {
  const { user, profile, isAdmin } = useAuth()
  const { addToast } = useToast()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState(null)

  useEffect(() => { if (profile?.id) fetchStats() }, [profile])

  async function fetchStats() {
    try {
      const [lr, ir] = await Promise.all([
        supabase.from('leads').select('estado, presupuesto_estimado').eq('vendedor_asignado', profile.id),
        supabase.from('interacciones').select('tipo').eq('usuario_id', profile.id)
      ])
      const leads = lr.data || []
      const ints = ir.data || []
      setStats({
        total: leads.length,
        ventas: leads.filter(l => l.estado === 'venta_cerrada').length,
        negociacion: leads.filter(l => l.estado === 'en_negociacion').length,
        revenue: leads.filter(l => l.estado === 'venta_cerrada').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0),
        llamadas: ints.filter(i => i.tipo === 'llamada').length,
        whatsapp: ints.filter(i => i.tipo === 'whatsapp').length,
        emails: ints.filter(i => i.tipo === 'email').length,
        visitas: ints.filter(i => i.tipo === 'visita').length,
        totalInt: ints.length,
        conversion: leads.length > 0 ? ((leads.filter(l => l.estado === 'venta_cerrada').length / leads.length) * 100).toFixed(1) : '0'
      })
    } catch (e) { console.error(e) }
  }

  function getInitials(name) {
    return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?'
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (newPassword !== confirmPassword) { addToast('Las contraseñas no coinciden', 'error'); return }
    if (newPassword.length < 6) { addToast('Mínimo 6 caracteres', 'error'); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      addToast('Contraseña actualizada', 'success')
      setNewPassword(''); setConfirmPassword('')
    } catch (err) { addToast(err.message || 'Error', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div>
      {/* Stats row for employee */}
      {!isAdmin && stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-card-header"><div className="stat-card-icon red"><Target size={20} /></div></div>
            <div className="stat-card-value">{stats.total}</div>
            <div className="stat-card-label">Mis Leads</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header"><div className="stat-card-icon green"><Award size={20} /></div></div>
            <div className="stat-card-value">{stats.ventas}</div>
            <div className="stat-card-label">Mis Ventas</div>
            <div className="stat-card-trend up">{stats.conversion}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header"><div className="stat-card-icon blue"><TrendingUp size={20} /></div></div>
            <div className="stat-card-value">{fmt$(stats.revenue)}</div>
            <div className="stat-card-label">Mi Revenue</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header"><div className="stat-card-icon purple"><Phone size={20} /></div></div>
            <div className="stat-card-value">{stats.totalInt}</div>
            <div className="stat-card-label">Contactos</div>
          </div>
        </div>
      )}

      <div className="profile-grid">
        {/* Profile Info */}
        <div className="card">
          <div className="card-header"><h3>Información Personal</h3></div>
          <div className="card-body">
            <div className="profile-avatar-lg">{getInitials(profile?.full_name)}</div>
            <div className="detail-row"><div className="detail-label">Nombre Completo</div><div className="detail-value">{profile?.full_name || '-'}</div></div>
            <div className="detail-row"><div className="detail-label">DNI</div><div className="detail-value">{profile?.dni || '-'}<div className="form-hint">El DNI no puede modificarse</div></div></div>
            <div className="detail-row"><div className="detail-label">Rol</div><div className="detail-value"><span className={`badge badge-${profile?.role}`}>{profile?.role === 'admin' ? 'Administrador' : 'Vendedor'}</span></div></div>
            <div className="detail-row"><div className="detail-label">Miembro desde</div><div className="detail-value">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'}</div></div>
          </div>
        </div>

        <div>
          {/* Change Password */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><h3>Cambiar Contraseña</h3></div>
            <div className="card-body">
              <form onSubmit={handleChangePassword}>
                <div className="form-group">
                  <label className="form-label">Nueva Contraseña</label>
                  <input className="form-input" type="password" placeholder="Mínimo 6 caracteres" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirmar Contraseña</label>
                  <input className="form-input" type="password" placeholder="Repetí la contraseña" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} />
                </div>
                <button type="submit" className="btn btn-primary btn-full" disabled={saving}>{saving ? 'Guardando...' : 'Actualizar Contraseña'}</button>
              </form>
            </div>
          </div>

          {/* Activity Breakdown (employee) */}
          {!isAdmin && stats && (
            <div className="card">
              <div className="card-header"><h3>Mi Actividad</h3></div>
              <div className="card-body">
                <div className="detail-row"><div className="detail-label"><Phone size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Llamadas</div><div className="detail-value">{stats.llamadas}</div></div>
                <div className="detail-row"><div className="detail-label"><MessageCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />WhatsApp</div><div className="detail-value">{stats.whatsapp}</div></div>
                <div className="detail-row"><div className="detail-label"><Mail size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Emails</div><div className="detail-value">{stats.emails}</div></div>
                <div className="detail-row"><div className="detail-label"><MapPin size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Visitas</div><div className="detail-value">{stats.visitas}</div></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
