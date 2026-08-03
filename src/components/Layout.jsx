import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useState } from 'react'
import {
  LayoutDashboard,
  Users as UsersIcon,
  UserPlus,
  LogOut,
  Menu,
  X,
  Plus,
  Settings,
} from 'lucide-react'

export default function Layout() {
  const { profile, logout, isAdmin } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function getPageTitle() {
    const path = location.pathname
    if (path === '/') return 'Dashboard'
    if (path === '/leads') return 'Gestión de Leads'
    if (path.startsWith('/leads/')) return 'Detalle del Lead'
    if (path === '/usuarios') return 'Gestión de Usuarios'
    if (path === '/perfil') return 'Mi Perfil'
    return 'MotoBox CRM'
  }

  function getPageActions() {
    const path = location.pathname
    if (path === '/leads') {
      return (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            // Dispatch a custom event that LeadsPage listens for
            window.dispatchEvent(new CustomEvent('open-new-lead'))
          }}
        >
          <Plus size={16} /> Nuevo Lead
        </button>
      )
    }
    if (path === '/usuarios' && isAdmin) {
      return (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('open-new-user'))
          }}
        >
          <UserPlus size={16} /> Nuevo Usuario
        </button>
      )
    }
    return null
  }

  const initials = profile?.full_name
    ? profile.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??'

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>
            MOTO<span>BOX</span>
          </h2>
          <div className="sidebar-role">
            {isAdmin ? 'Panel Administrativo' : 'Panel de Ventas'}
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Principal</span>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
            onClick={() => setSidebarOpen(false)}
          >
            <LayoutDashboard size={20} />
            Dashboard
          </NavLink>

          <NavLink
            to="/leads"
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
            onClick={() => setSidebarOpen(false)}
          >
            <UsersIcon size={20} />
            Leads
          </NavLink>

          {isAdmin && (
            <>
              <span className="sidebar-section-label">Administración</span>
              <NavLink
                to="/usuarios"
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'active' : ''}`
                }
                onClick={() => setSidebarOpen(false)}
              >
                <UserPlus size={20} />
                Usuarios
              </NavLink>
            </>
          )}

          <span className="sidebar-section-label">Cuenta</span>
          <NavLink
            to="/perfil"
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
            onClick={() => setSidebarOpen(false)}
          >
            <Settings size={20} />
            Mi Perfil
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{profile?.full_name}</div>
              <div className="sidebar-user-role">
                {profile?.role === 'admin' ? 'Administrador' : 'Empleado'}
              </div>
            </div>
          </div>
          <button
            className="sidebar-link"
            onClick={logout}
            style={{ marginTop: 4 }}
          >
            <LogOut size={20} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <header className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <h1>{getPageTitle()}</h1>
          </div>
          <div className="page-header-actions">{getPageActions()}</div>
        </header>

        <div className="page-body">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
