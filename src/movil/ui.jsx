import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { iniciales, colorDe } from './formato'

// Piezas de interfaz de la app móvil, al estilo de las apps nativas de iPhone/Android.

// Pantalla con título grande que se achica al bajar (como Ajustes o Contactos del iPhone),
// botón atrás, acción a la derecha y "tirar para actualizar".
export function Pantalla({ titulo, subtitulo, atras, accion, onRefrescar, children, sinTituloGrande = false, className = '' }) {
  const navigate = useNavigate()
  const [compacta, setCompacta] = useState(sinTituloGrande)
  const [tiron, setTiron] = useState(0)
  const [refrescando, setRefrescando] = useState(false)
  const inicio = useRef(null)

  useEffect(() => {
    if (sinTituloGrande) return
    const alBajar = () => setCompacta(window.scrollY > 34)
    alBajar()
    window.addEventListener('scroll', alBajar, { passive: true })
    return () => window.removeEventListener('scroll', alBajar)
  }, [sinTituloGrande])

  useEffect(() => { window.scrollTo(0, 0) }, [titulo])

  // Tirar para actualizar
  const tocar = (e) => { inicio.current = window.scrollY <= 0 && onRefrescar ? e.touches[0].clientY : null }
  const mover = (e) => {
    if (inicio.current == null) return
    const d = e.touches[0].clientY - inicio.current
    setTiron(d > 0 ? Math.min(90, d * 0.5) : 0)
  }
  const soltar = async () => {
    if (inicio.current == null) return
    inicio.current = null
    if (tiron >= 60 && onRefrescar) {
      setRefrescando(true)
      setTiron(56)
      try { await onRefrescar() } finally { setRefrescando(false); setTiron(0) }
    } else setTiron(0)
  }

  return (
    <div className={`mv-pantalla ${className}`} onTouchStart={tocar} onTouchMove={mover} onTouchEnd={soltar}>
      <header className={`mv-nav ${compacta ? 'compacta' : ''}`}>
        <div className="mv-nav-fila">
          <div className="mv-nav-izq">
            {atras && (
              <button className="mv-atras" onClick={() => (typeof atras === 'string' ? navigate(atras) : navigate(-1))}>
                <ChevronLeft size={26} strokeWidth={2.4} /> <span>{typeof atras === 'string' ? 'Más' : 'Atrás'}</span>
              </button>
            )}
          </div>
          <div className="mv-nav-titulo">{titulo}</div>
          <div className="mv-nav-der">{accion}</div>
        </div>
      </header>
      {(onRefrescar && (tiron > 0 || refrescando)) && (
        <div className="mv-tiron" style={{ height: tiron }}>
          <RefreshCw size={20} className={refrescando ? 'girando' : ''} style={{ transform: refrescando ? undefined : `rotate(${tiron * 4}deg)`, opacity: Math.min(1, tiron / 60) }} />
        </div>
      )}
      {!sinTituloGrande && (
        <div className="mv-titulo-grande">
          <h1>{titulo}</h1>
          {subtitulo && <p>{subtitulo}</p>}
        </div>
      )}
      <div className="mv-cuerpo">{children}</div>
    </div>
  )
}

export function Avatar({ nombre, tam = 40, color }) {
  return (
    <span className="mv-avatar" style={{ width: tam, height: tam, fontSize: tam * 0.4, background: color || colorDe(nombre) }}>
      {iniciales(nombre)}
    </span>
  )
}

// Lista agrupada con esquinas redondeadas (estilo "inset grouped").
export function Seccion({ titulo, pie, children, accion }) {
  return (
    <section className="mv-seccion">
      {(titulo || accion) && <div className="mv-seccion-titulo"><span>{titulo}</span>{accion}</div>}
      <div className="mv-grupo">{children}</div>
      {pie && <div className="mv-seccion-pie">{pie}</div>}
    </section>
  )
}

export function Fila({ izq, titulo, sub, der, chevron, onClick, to, destructiva, children, className = '' }) {
  const contenido = (
    <>
      {izq && <span className="mv-fila-izq">{izq}</span>}
      <span className="mv-fila-centro">
        <span className={`mv-fila-titulo ${destructiva ? 'rojo' : ''}`}>{titulo}</span>
        {sub && <span className="mv-fila-sub">{sub}</span>}
        {children}
      </span>
      {der != null && <span className="mv-fila-der">{der}</span>}
      {chevron && <ChevronRight size={18} className="mv-fila-chevron" />}
    </>
  )
  if (to) return <Link to={to} className={`mv-fila tocable ${className}`}>{contenido}</Link>
  // div con role=button (y no <button>) para poder poner otros botones adentro, como el de WhatsApp.
  if (onClick) {
    return (
      <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter') onClick(e) }} className={`mv-fila tocable ${className}`}>
        {contenido}
      </div>
    )
  }
  return <div className={`mv-fila ${className}`}>{contenido}</div>
}

export function Segmentos({ opciones, valor, onCambio }) {
  return (
    <div className="mv-segmentos" role="tablist">
      {opciones.map((o) => (
        <button key={o.valor} role="tab" aria-selected={valor === o.valor} className={valor === o.valor ? 'activo' : ''} onClick={() => onCambio(o.valor)}>
          {o.texto}{o.n != null && <span className="mv-seg-n">{o.n}</span>}
        </button>
      ))}
    </div>
  )
}

export function Pastilla({ children, tono = 'gris' }) {
  return <span className={`mv-pastilla ${tono}`}>{children}</span>
}

export function Vacio({ icono: Icono, titulo, texto, children }) {
  return (
    <div className="mv-vacio">
      {Icono && <Icono size={44} strokeWidth={1.5} />}
      <strong>{titulo}</strong>
      {texto && <p>{texto}</p>}
      {children}
    </div>
  )
}

export function Esqueleto({ filas = 6 }) {
  return (
    <div className="mv-grupo mv-esqueleto">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="mv-fila"><span className="mv-esq-circulo" /><span className="mv-fila-centro"><span className="mv-esq-linea" /><span className="mv-esq-linea corta" /></span></div>
      ))}
    </div>
  )
}

// Hoja que sube desde abajo. Se cierra tocando afuera, con la X o deslizando hacia abajo.
export function Hoja({ abierta, onCerrar, titulo, children, pie, alto = false }) {
  const [desliz, setDesliz] = useState(0)
  const y0 = useRef(null)
  useEffect(() => {
    if (!abierta) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [abierta])
  if (!abierta) return null
  return (
    <div className="mv-hoja-fondo" onClick={onCerrar}>
      <div
        className={`mv-hoja ${alto ? 'alta' : ''}`}
        style={{ transform: desliz ? `translateY(${desliz}px)` : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mv-hoja-agarre"
          onTouchStart={(e) => { y0.current = e.touches[0].clientY }}
          onTouchMove={(e) => { if (y0.current != null) setDesliz(Math.max(0, e.touches[0].clientY - y0.current)) }}
          onTouchEnd={() => { if (desliz > 90) onCerrar(); setDesliz(0); y0.current = null }}
        >
          <span />
          {titulo && (
            <div className="mv-hoja-cab">
              <button className="mv-texto-boton" onClick={onCerrar}>Cancelar</button>
              <strong>{titulo}</strong>
              <span className="mv-hoja-cab-der" />
            </div>
          )}
        </div>
        <div className="mv-hoja-cuerpo">{children}</div>
        {pie && <div className="mv-hoja-pie">{pie}</div>}
      </div>
    </div>
  )
}

// Menú de opciones desde abajo (como el "action sheet" del iPhone).
export function MenuAcciones({ abierto, onCerrar, titulo, acciones }) {
  if (!abierto) return null
  return (
    <div className="mv-hoja-fondo" onClick={onCerrar}>
      <div className="mv-acciones" onClick={(e) => e.stopPropagation()}>
        <div className="mv-acciones-grupo">
          {titulo && <div className="mv-acciones-titulo">{titulo}</div>}
          {acciones.filter(Boolean).map((a) => (
            <button key={a.texto} className={a.destructiva ? 'rojo' : ''} onClick={() => { onCerrar(); a.onClick() }}>{a.texto}</button>
          ))}
        </div>
        <button className="mv-acciones-cancelar" onClick={onCerrar}>Cancelar</button>
      </div>
    </div>
  )
}

export function Campo({ etiqueta, children }) {
  return (
    <label className="mv-campo">
      <span>{etiqueta}</span>
      {children}
    </label>
  )
}
