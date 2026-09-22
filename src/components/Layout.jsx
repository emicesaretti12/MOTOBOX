import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useState } from 'react'
import CommandPalette from './CommandPalette'
import ThemeToggle from './ThemeToggle'
import {
  LayoutDashboard,
  Users as UsersIcon,
  UserPlus,
  LogOut,
  Menu,
  X,
  Plus,
  Settings,
  Calendar,
  Activity,
  Package,
  DollarSign,
  Briefcase,
  Plug,
  Search,
} from 'lucide-react'

export default function Layout() {
  const { profile, logout, isAdmin } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

  function getPageTitle() {
    const path = location.pathname
    if (path === '/') return 'Dashboard'
    if (path === '/leads') return 'Gestión de Leads'
    if (path.startsWith('/leads/')) return 'Detalle del Lead'
    if (path === '/agenda') return 'Agenda'
    if (path === '/monitor') return 'Monitor de Vendedores'
    if (path === '/usuarios') return 'Gestión de Usuarios'
        if (path === '/perfil') return 'Mi Perfil'
    if (path === '/inventario') return 'Gestión de Inventario'
    if (path === '/ventas') return 'Gestión de Ventas'
    if (path === '/clientes') return 'Gestión de Clientes'
    if (path === '/web-config') return 'Configurar Web Pública'
    if (path === '/integraciones') return 'Integraciones y Conexiones'
    return 'MotoBox CRM'
  }

  function getPageActions() {
    const path = location.pathname
    if (path === '/leads') {
      return (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => window.dispatchEvent(new CustomEvent('open-new-lead'))}
        >
          <Plus size={16} /> Nuevo Lead
        </button>
      )
    }
    if (path === '/usuarios' && isAdmin) {
      return (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => window.dispatchEvent(new CustomEvent('open-new-user'))}
        >
          <UserPlus size={16} /> Nuevo Usuario
        </button>
      )
    }
    return null
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '??'

  return (
    <div className="app-layout">
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <h2>MOTO<span>BOX</span></h2>
          <div className="sidebar-role">
            {isAdmin ? 'Panel Administrativo' : 'Panel de Ventas'}
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Principal</span>

          <NavLink
            to="/inventario"
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <Package size={18} />
            Inventario
          </NavLink>

          <NavLink
            to="/ventas"
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <DollarSign size={18} />
            Ventas
          </NavLink>

          <NavLink
            to="/clientes"
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <Briefcase size={18} />
            Clientes
          </NavLink>

          <NavLink
            to="/" end
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>

          <NavLink
            to="/leads"
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <UsersIcon size={18} />
            Leads
          </NavLink>

          <NavLink
            to="/agenda"
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <Calendar size={18} />
            Agenda
          </NavLink>

          {isAdmin && (
            <>
              <span className="sidebar-section-label">Administración</span>

              <NavLink
                to="/monitor"
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Activity size={18} />
                Monitor Vendedores
              </NavLink>

              <NavLink
                to="/usuarios"
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <UserPlus size={18} />
                Usuarios
              </NavLink>

              <NavLink
                to="/web-config"
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Settings size={18} />
                Configurar Web
              </NavLink>

              <NavLink
                to="/integraciones"
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Plug size={18} />
                Integraciones
              </NavLink>
            </>
          )}

          <span className="sidebar-section-label">Cuenta</span>

          <NavLink
            to="/perfil"
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <Settings size={18} />
            Mi Perfil
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials}</div>
            <div>
              <div className="sidebar-user-name">{profile?.full_name}</div>
              <div className="sidebar-user-role">
                {profile?.role === 'admin' ? 'Administrador' : 'Vendedor'}
              </div>
            </div>
          </div>
          <button className="sidebar-link" onClick={logout}>
            <LogOut size={18} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">
            <button className="mobile-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            {getPageTitle()}
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="cmdk-trigger"
              onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
              title="Buscador global"
            >
              <Search size={15} />
              <span>Buscar...</span>
              <kbd className="cmdk-kbd">{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <ThemeToggle />
            {getPageActions()}
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </main>

      <CommandPalette />
    </div>
  )
}
