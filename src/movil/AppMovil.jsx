import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { Target, Users, MessagesSquare, CalendarDays, Menu, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { puedeVerificar } from '../lib/verificacion'
import AlertaCalientes from '../components/AlertaCalientes'
import DashboardPage from '../pages/DashboardPage'
import UsersPage from '../pages/UsersPage'
import VendorMonitorPage from '../pages/VendorMonitorPage'
import ProfilePage from '../pages/ProfilePage'
import InventoryPage from '../pages/InventoryPage'
import UsadosPage from '../pages/UsadosPage'
import SalesPage from '../pages/SalesPage'
import ClientsPage from '../pages/ClientsPage'
import WebSettingsPage from '../pages/WebSettingsPage'
import SorteoPage from '../pages/SorteoPage'
import VerificacionPage from '../pages/VerificacionPage'
import MetricasPage from '../pages/MetricasPage'
import { Pantalla } from './ui'
import HoyMovil from './HoyMovil'
import LeadsMovil from './LeadsMovil'
import LeadMovil from './LeadMovil'
import ChatsMovil, { ConversacionMovil } from './ChatsMovil'
import AgendaMovil from './AgendaMovil'
import MasMovil from './MasMovil'
import Calculadora from '../components/Calculadora'
import './app.css'

const PESTANAS = [
  { to: '/hoy', texto: 'Hoy', Icono: Target },
  { to: '/leads', texto: 'Leads', Icono: Users },
  { to: '/agente', texto: 'Chats', Icono: MessagesSquare },
  { to: '/agenda', texto: 'Agenda', Icono: CalendarDays },
  { to: '/mas', texto: 'Más', Icono: Menu },
]

// Pantallas de detalle (sin barra de pestañas, como en las apps nativas).
const esDetalle = (path) => /^\/leads\/[^/]+$/.test(path) || /^\/agente\/.+/.test(path)

// Las secciones menos usadas reutilizan la página de escritorio dentro de una pantalla móvil.
function Escritorio({ titulo, children, accion }) {
  return (
    <Pantalla titulo={titulo} atras="/mas" sinTituloGrande className="mv-escritorio" accion={accion}>
      <div className="mv-escritorio-cuerpo">{children}</div>
    </Pantalla>
  )
}

function SoloAdmin({ children }) {
  const { isAdmin } = useAuth()
  return isAdmin ? children : <Navigate to="/hoy" replace />
}

function BarraPestanas() {
  const [calientes, setCalientes] = useState(0)
  useEffect(() => {
    const h = (e) => setCalientes(Number(e.detail) || 0)
    window.addEventListener('calientes-pendientes', h)
    return () => window.removeEventListener('calientes-pendientes', h)
  }, [])
  return (
    <nav className="mv-pestanas">
      {PESTANAS.map(({ to, texto, Icono }) => (
        <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'activa' : '')}>
          <span className="mv-pestana-icono">
            <Icono size={25} strokeWidth={2} />
            {to === '/hoy' && calientes > 0 && <b>{calientes > 99 ? '99+' : calientes}</b>}
          </span>
          {texto}
        </NavLink>
      ))}
    </nav>
  )
}

export default function AppMovil() {
  const { profile } = useAuth()
  const location = useLocation()
  const detalle = esDetalle(location.pathname)

  useEffect(() => {
    const html = document.documentElement
    html.classList.add('mv-app')
    // Alto visible real (se achica cuando abre el teclado): el chat lo usa para que la caja de texto quede arriba del teclado.
    const vv = window.visualViewport
    const medir = () => {
      if (!vv) return
      html.style.setProperty('--mv-alto-visible', `${Math.round(vv.height)}px`)
      html.style.setProperty('--mv-vv-arriba', `${Math.round(vv.offsetTop)}px`)
    }
    // El teclado del iPhone sube con una animación y avisa antes de terminar: se vuelve a medir durante ~700 ms.
    let cuadro
    const seguir = () => {
      cancelAnimationFrame(cuadro)
      const fin = performance.now() + 700
      const paso = () => { medir(); if (performance.now() < fin) cuadro = requestAnimationFrame(paso) }
      paso()
    }
    medir()
    vv?.addEventListener('resize', seguir)
    vv?.addEventListener('scroll', medir)
    document.addEventListener('focusin', seguir)
    document.addEventListener('focusout', seguir)
    return () => {
      html.classList.remove('mv-app')
      cancelAnimationFrame(cuadro)
      vv?.removeEventListener('resize', seguir)
      vv?.removeEventListener('scroll', medir)
      document.removeEventListener('focusin', seguir)
      document.removeEventListener('focusout', seguir)
    }
  }, [])

  return (
    <div className={`mv-raiz ${detalle ? 'sin-pestanas' : ''}`}>
      {/* Sigue sonando y avisando de leads calientes; el número va en la pestaña "Hoy". */}
      <div hidden><AlertaCalientes /></div>
      <div className="mv-vista" key={location.pathname}>
        <Routes>
          <Route path="/hoy" element={<HoyMovil />} />
          <Route path="/leads" element={<LeadsMovil />} />
          <Route path="/leads/:id" element={<LeadMovil />} />
          <Route path="/agente" element={<ChatsMovil />} />
          <Route path="/agente/:clave" element={<ConversacionMovil />} />
          <Route path="/agenda" element={<AgendaMovil />} />
          <Route path="/mas" element={<MasMovil />} />
          <Route path="/calculadora" element={<Pantalla titulo="Calculadora" atras sinTituloGrande className="mv-escritorio"><Calculadora movil /></Pantalla>} />
          <Route path="/" element={<Escritorio titulo="Dashboard"><DashboardPage /></Escritorio>} />
          <Route path="/perfil" element={<Escritorio titulo="Mi perfil"><ProfilePage /></Escritorio>} />
          <Route path="/ventas" element={<Escritorio titulo="Ventas"><SalesPage /></Escritorio>} />
          <Route path="/clientes" element={<Escritorio titulo="Clientes"><ClientsPage /></Escritorio>} />
          <Route path="/inventario" element={<Escritorio titulo="Inventario"><InventoryPage /></Escritorio>} />
          <Route path="/usados" element={<Escritorio titulo="Usados"><UsadosPage /></Escritorio>} />
          <Route path="/verificacion" element={puedeVerificar(profile) ? <Escritorio titulo="Verificación DNI"><VerificacionPage /></Escritorio> : <Navigate to="/hoy" replace />} />
          <Route path="/metricas" element={<SoloAdmin><Escritorio titulo="Métricas DNI"><MetricasPage /></Escritorio></SoloAdmin>} />
          <Route path="/monitor" element={<SoloAdmin><Escritorio titulo="Monitor"><VendorMonitorPage /></Escritorio></SoloAdmin>} />
          <Route path="/usuarios" element={<SoloAdmin><Escritorio titulo="Usuarios" accion={<button className="mv-nav-boton" aria-label="Nuevo usuario" onClick={() => window.dispatchEvent(new CustomEvent('open-new-user'))}><Plus size={26} /></button>}><UsersPage /></Escritorio></SoloAdmin>} />
          <Route path="/sorteo" element={<SoloAdmin><Escritorio titulo="Sorteo"><SorteoPage /></Escritorio></SoloAdmin>} />
          <Route path="/web-config" element={<SoloAdmin><Escritorio titulo="Configurar web"><WebSettingsPage /></Escritorio></SoloAdmin>} />
          <Route path="*" element={<Navigate to="/hoy" replace />} />
        </Routes>
      </div>
      {!detalle && <BarraPestanas />}
    </div>
  )
}
