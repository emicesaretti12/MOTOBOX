import { useEffect, useState } from 'react'
import {
  DollarSign, Briefcase, Package, Gauge, LayoutDashboard, Activity, BarChart3, UserPlus, Ticket, Settings,
  ShieldCheck, Smartphone, LogOut, UserCircle,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useCrmConfig } from '../hooks/useCrmConfig'
import { puedeVerificar } from '../lib/verificacion'
import { esIOS, estaInstalada } from '../lib/instalarApp'
import { USER_ROLE_LABELS } from '../lib/constants'
import { Pantalla, Avatar, Seccion, Fila, Hoja, MenuAcciones } from './ui'

const Icono = ({ I, color }) => <span className="mv-icono-ajuste" style={{ background: color }}><I size={17} color="#fff" /></span>

export default function MasMovil() {
  const { profile, isAdmin, logout } = useAuth()
  const crm = useCrmConfig()
  const [evento, setEvento] = useState(null)
  const [ayudaIOS, setAyudaIOS] = useState(false)
  const [salir, setSalir] = useState(false)
  const [instalada, setInstalada] = useState(() => estaInstalada(window))

  useEffect(() => {
    const guardar = (e) => { e.preventDefault(); setEvento(e) }
    const listo = () => { setInstalada(true); setEvento(null) }
    window.addEventListener('beforeinstallprompt', guardar)
    window.addEventListener('appinstalled', listo)
    return () => { window.removeEventListener('beforeinstallprompt', guardar); window.removeEventListener('appinstalled', listo) }
  }, [])

  const puedeInstalar = !instalada && (evento || esIOS(navigator.userAgent))
  async function instalar() {
    if (!evento) { setAyudaIOS(true); return }
    evento.prompt()
    const r = await evento.userChoice
    if (r.outcome === 'accepted') setInstalada(true)
    setEvento(null)
  }

  return (
    <Pantalla titulo="Más">
      <div className="mv-grupo mv-perfil">
        <Fila
          to="/perfil"
          izq={<Avatar nombre={profile?.full_name} tam={56} />}
          titulo={profile?.full_name || 'Mi perfil'}
          sub={USER_ROLE_LABELS[profile?.role] || 'Vendedor'}
          chevron
        />
      </div>

      {crm?.colaDniActiva && puedeVerificar(profile) && (
        <Seccion>
          <Fila to="/verificacion" izq={<Icono I={ShieldCheck} color="#34c759" />} titulo="Verificación de DNI" chevron />
        </Seccion>
      )}

      <Seccion titulo="Negocio">
        <Fila to="/ventas" izq={<Icono I={DollarSign} color="#34c759" />} titulo="Ventas" chevron />
        <Fila to="/clientes" izq={<Icono I={Briefcase} color="#007aff" />} titulo="Clientes" chevron />
        <Fila to="/inventario" izq={<Icono I={Package} color="#ff9500" />} titulo="Inventario" chevron />
        <Fila to="/usados" izq={<Icono I={Gauge} color="#8e8e93" />} titulo="Usados" chevron />
      </Seccion>

      <Seccion titulo="Resultados">
        <Fila to="/" izq={<Icono I={LayoutDashboard} color="#5856d6" />} titulo="Dashboard" chevron />
        {isAdmin && <Fila to="/monitor" izq={<Icono I={Activity} color="#ff2d55" />} titulo="Monitor de vendedores" chevron />}
        {isAdmin && crm?.disponible && <Fila to="/metricas" izq={<Icono I={BarChart3} color="#5ac8fa" />} titulo="Métricas DNI" chevron />}
      </Seccion>

      {isAdmin && (
        <Seccion titulo="Administración">
          <Fila to="/usuarios" izq={<Icono I={UserPlus} color="#007aff" />} titulo="Usuarios" chevron />
          <Fila to="/sorteo" izq={<Icono I={Ticket} color="#af52de" />} titulo="Sorteo" chevron />
          <Fila to="/web-config" izq={<Icono I={Settings} color="#8e8e93" />} titulo="Configurar web" chevron />
        </Seccion>
      )}

      <Seccion>
        <Fila to="/perfil" izq={<Icono I={UserCircle} color="#8e8e93" />} titulo="Mi perfil" chevron />
        {puedeInstalar && <Fila onClick={instalar} izq={<Icono I={Smartphone} color="#ff9500" />} titulo="Instalar app en el celular" chevron />}
      </Seccion>

      <Seccion>
        <Fila onClick={() => setSalir(true)} izq={<Icono I={LogOut} color="#ff3b30" />} titulo="Cerrar sesión" destructiva />
      </Seccion>

      <p className="mv-pie-lista">MotoBox CRM</p>

      <MenuAcciones abierto={salir} onCerrar={() => setSalir(false)} titulo="¿Cerrar sesión en este celular?" acciones={[{ texto: 'Cerrar sesión', destructiva: true, onClick: logout }]} />
      <Hoja abierta={ayudaIOS} onCerrar={() => setAyudaIOS(false)} titulo="Instalar en el iPhone">
        <ol className="mv-pasos">
          <li>Abrí esta página en <strong>Safari</strong>.</li>
          <li>Tocá <strong>Compartir</strong> (el cuadrado con la flecha para arriba).</li>
          <li>Elegí <strong>Agregar a inicio</strong> y tocá <strong>Agregar</strong>.</li>
        </ol>
        <p className="mv-ayuda">Te queda el ícono de MotoBox en la pantalla y se abre como una app, sin barra del navegador.</p>
      </Hoja>
    </Pantalla>
  )
}
