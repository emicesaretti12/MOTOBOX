import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useState } from 'react'
import { useCrmConfig } from '../hooks/useCrmConfig'
import { puedeVerificar } from '../lib/verificacion'
import AlertaCalientes from './AlertaCalientes'
import {
  LayoutDashboard,
  Users as UsersIcon,
  UserPlus,
  LogOut,
  Menu,
  X,
  Plus,
  Settings,
  Ticket,
  Calendar,
  Activity,
  Package,
  Gauge,
  DollarSign,
  Briefcase,
  ShieldCheck,
  BarChart3,
  Target,
  Bot,
} from 'lucide-react'

export default function Layout() {
  const { profile, logout, isAdmin } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const crmConfig = useCrmConfig()
  const verVerificacion = !!crmConfig?.colaDniActiva && puedeVerificar(profile)

  function getPageTitle() {
    const path = location.pathname
    if (path === '/') return 'Dashboard'
    if (path === '/hoy') return 'Para vender hoy'
    if (path === '/agente') return 'Agente en vivo'
    if (path === '/leads') return 'Gestión de Leads'
    if (path.startsWith('/leads/')) return 'Detalle del Lead'
    if (path === '/agenda') return 'Agenda'
    if (path === '/monitor') return 'Monitor de Vendedores'
    if (path === '/usuarios') return 'Gestión de Usuarios'
        if (path === '/perfil') return 'Mi Perfil'
    if (path === '/inventario') return 'Gestión de Inventario'
    if (path === '/usados') return 'Usados exclusivos'
    if (path === '/ventas') return 'Gestión de Ventas'
    if (path === '/clientes') return 'Gestión de Clientes'
    if (path === '/web-config') return 'Configurar Web Pública'
    if (path === '/sorteo') return 'Sorteo'
    if (path === '/verificacion') return 'Verificación de DNI'
    if (path === '/metricas') return 'Métricas de verificación'
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

  // Menú ordenado por tarea: primero vender, después el negocio, al final la administración.
  const secciones = [
    { titulo: 'Vender', links: [
      { to: '/hoy', texto: 'Para vender hoy', Icono: Target },
      { to: '/agente', texto: 'Agente en vivo', Icono: Bot },
      { to: '/leads', texto: 'Leads', Icono: UsersIcon },
      { to: '/agenda', texto: 'Agenda', Icono: Calendar },
      verVerificacion && { to: '/verificacion', texto: 'Verificación DNI', Icono: ShieldCheck },
    ] },
    { titulo: 'Negocio', links: [
      { to: '/ventas', texto: 'Ventas', Icono: DollarSign },
      { to: '/clientes', texto: 'Clientes', Icono: Briefcase },
      { to: '/inventario', texto: 'Inventario', Icono: Package },
      { to: '/usados', texto: 'Usados', Icono: Gauge },
    ] },
    { titulo: 'Resultados', links: [
      { to: '/', texto: 'Dashboard', Icono: LayoutDashboard, end: true },
      isAdmin && { to: '/monitor', texto: 'Monitor de vendedores', Icono: Activity },
      isAdmin && crmConfig?.disponible && { to: '/metricas', texto: 'Métricas DNI', Icono: BarChart3 },
    ] },
    isAdmin && { titulo: 'Administración', links: [
      { to: '/usuarios', texto: 'Usuarios', Icono: UserPlus },
      { to: '/sorteo', texto: 'Sorteo', Icono: Ticket },
      { to: '/web-config', texto: 'Configurar web', Icono: Settings },
    ] },
    { titulo: 'Cuenta', links: [{ to: '/perfil', texto: 'Mi perfil', Icono: Settings }] },
  ].filter(Boolean).map((sec) => ({ ...sec, links: sec.links.filter(Boolean) }))

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
          {secciones.map((sec) => (
            <div key={sec.titulo} className="sidebar-seccion">
              <span className="sidebar-section-label">{sec.titulo}</span>
              {sec.links.map(({ to, texto, Icono, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icono size={18} />
                  {texto}
                </NavLink>
              ))}
            </div>
          ))}
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
          <div className="topbar-actions">{getPageActions()}</div>
        </header>

        <div className="page-content">
          <AlertaCalientes />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
