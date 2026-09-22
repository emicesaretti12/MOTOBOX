import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import {
  Search, User, Package, LayoutDashboard, Users as UsersIcon, Calendar, DollarSign,
  Briefcase, Settings, Plug, Activity, UserPlus, Moon, Sun, Phone, CornerDownLeft,
} from 'lucide-react'

const STATUS_LABELS = {
  nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación',
  venta_cerrada: 'Venta Cerrada', perdido: 'Perdido',
}

function normalize(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Buscador global (Ctrl/Cmd + K).
 * Sólo lee datos — nunca escribe en la base.
 */
export default function CommandPalette() {
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { toggleMode, isDark } = useTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [leads, setLeads] = useState([])
  const [motos, setMotos] = useState([])
  const [cargado, setCargado] = useState(false)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const navegacion = useMemo(() => {
    const items = [
      { id: 'nav-dashboard', tipo: 'Ir a', titulo: 'Dashboard', icon: LayoutDashboard, accion: () => navigate('/') },
      { id: 'nav-leads', tipo: 'Ir a', titulo: 'Leads', icon: UsersIcon, accion: () => navigate('/leads') },
      { id: 'nav-agenda', tipo: 'Ir a', titulo: 'Agenda', icon: Calendar, accion: () => navigate('/agenda') },
      { id: 'nav-inventario', tipo: 'Ir a', titulo: 'Inventario', icon: Package, accion: () => navigate('/inventario') },
      { id: 'nav-ventas', tipo: 'Ir a', titulo: 'Ventas', icon: DollarSign, accion: () => navigate('/ventas') },
      { id: 'nav-clientes', tipo: 'Ir a', titulo: 'Clientes', icon: Briefcase, accion: () => navigate('/clientes') },
      { id: 'nav-perfil', tipo: 'Ir a', titulo: 'Mi Perfil', icon: Settings, accion: () => navigate('/perfil') },
      {
        id: 'act-nuevo-lead', tipo: 'Acción', titulo: 'Crear nuevo lead', icon: UserPlus,
        accion: () => {
          navigate('/leads')
          setTimeout(() => window.dispatchEvent(new CustomEvent('open-new-lead')), 120)
        },
      },
      {
        id: 'act-tema', tipo: 'Acción', titulo: isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro',
        icon: isDark ? Sun : Moon, accion: toggleMode,
      },
    ]
    if (isAdmin) {
      items.push(
        { id: 'nav-monitor', tipo: 'Ir a', titulo: 'Monitor de Vendedores', icon: Activity, accion: () => navigate('/monitor') },
        { id: 'nav-usuarios', tipo: 'Ir a', titulo: 'Usuarios', icon: UserPlus, accion: () => navigate('/usuarios') },
        { id: 'nav-web', tipo: 'Ir a', titulo: 'Configurar Web Pública', icon: Settings, accion: () => navigate('/web-config') },
        { id: 'nav-integraciones', tipo: 'Ir a', titulo: 'Integraciones y conexiones', icon: Plug, accion: () => navigate('/integraciones') }
      )
    }
    return items
  }, [navigate, isAdmin, isDark, toggleMode])

  const cargarDatos = useCallback(async () => {
    if (cargado) return
    try {
      let lq = supabase
        .from('leads')
        .select('id, nombre, telefono, modelo_interes, estado')
        .order('updated_at', { ascending: false })
        .limit(400)
      if (!isAdmin && profile?.id) lq = lq.eq('vendedor_asignado', profile.id)

      const [lr, mr] = await Promise.all([
        lq,
        supabase.from('inventario_motos').select('id, marca, modelo, anio, precio, estado').limit(300),
      ])
      setLeads(lr.data || [])
      setMotos(mr.data || [])
    } catch {
      /* si falla seguimos sólo con navegación */
    } finally {
      setCargado(true)
    }
  }, [cargado, isAdmin, profile])

  // Atajo de teclado global
  useEffect(() => {
    function onKeyDown(e) {
      const esK = e.key === 'k' || e.key === 'K'
      if ((e.metaKey || e.ctrlKey) && esK) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    const abrir = () => setOpen(true)
    window.addEventListener('open-command-palette', abrir)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('open-command-palette', abrir)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setCursor(0)
      return
    }
    cargarDatos()
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open, cargarDatos])

  const resultados = useMemo(() => {
    const q = normalize(query.trim())
    const nav = navegacion.filter(i => !q || normalize(i.titulo).includes(q))

    if (!q) return nav.slice(0, 9)

    const leadsHit = leads
      .filter(l => normalize(l.nombre).includes(q) || normalize(l.modelo_interes).includes(q) || String(l.telefono || '').includes(query.trim()))
      .slice(0, 8)
      .map(l => ({
        id: `lead-${l.id}`,
        tipo: 'Lead',
        titulo: l.nombre,
        sub: [l.modelo_interes, l.telefono, STATUS_LABELS[l.estado]].filter(Boolean).join(' · '),
        icon: User,
        accion: () => navigate(`/leads/${l.id}`),
      }))

    const motosHit = motos
      .filter(m => normalize(`${m.marca} ${m.modelo} ${m.anio || ''}`).includes(q))
      .slice(0, 5)
      .map(m => ({
        id: `moto-${m.id}`,
        tipo: 'Moto',
        titulo: `${m.marca} ${m.modelo}`,
        sub: [m.anio, m.precio ? '$' + Number(m.precio).toLocaleString('es-AR') : null, m.estado].filter(Boolean).join(' · '),
        icon: Package,
        accion: () => navigate('/inventario'),
      }))

    return [...leadsHit, ...motosHit, ...nav].slice(0, 14)
  }, [query, leads, motos, navegacion, navigate])

  useEffect(() => {
    setCursor(0)
  }, [query])

  function ejecutar(item) {
    if (!item) return
    setOpen(false)
    item.accion()
  }

  function onInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ejecutar(resultados[cursor])
    }
  }

  useEffect(() => {
    const activo = listRef.current?.querySelector('.cmdk-item.active')
    if (activo) activo.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Buscador global">
        <div className="cmdk-search">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Buscar leads, motos o ir a una sección..."
            aria-label="Buscar"
          />
          <kbd className="cmdk-kbd">ESC</kbd>
        </div>

        <div className="cmdk-list" ref={listRef}>
          {resultados.length === 0 ? (
            <div className="cmdk-empty">
              {cargado ? 'Sin resultados' : 'Buscando...'}
            </div>
          ) : (
            resultados.map((item, i) => {
              const Icon = item.icon || Search
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`cmdk-item ${i === cursor ? 'active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => ejecutar(item)}
                >
                  <span className="cmdk-item-icon"><Icon size={16} /></span>
                  <span className="cmdk-item-body">
                    <span className="cmdk-item-title">{item.titulo}</span>
                    {item.sub && <span className="cmdk-item-sub">{item.sub}</span>}
                  </span>
                  <span className="cmdk-item-tag">{item.tipo}</span>
                </button>
              )
            })
          )}
        </div>

        <div className="cmdk-footer">
          <span><kbd className="cmdk-kbd">↑</kbd><kbd className="cmdk-kbd">↓</kbd> navegar</span>
          <span><kbd className="cmdk-kbd"><CornerDownLeft size={11} /></kbd> abrir</span>
          <span><Phone size={12} /> {leads.length} leads indexados</span>
        </div>
      </div>
    </div>
  )
}
