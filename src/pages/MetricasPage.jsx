import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { LEAD_ORIGEN_LABELS } from '../lib/constants'
import {
  filtrarOrigen, totales, porDia, porOrigen, origenesPresentes, tiempoPromedio, tasaAprobacion,
  formatDuracion, rangoUltimosDias, formatDia,
} from '../lib/metricas'
import { Users, ShieldCheck, BadgeCheck, XCircle, Clock, UserCheck, Award, RefreshCw } from 'lucide-react'

const PERIODOS = [7, 30, 90]

function Tile({ icono: Icono, color, valor, etiqueta, detalle }) {
  return (
    <div className="stat-card">
      <div className="stat-card-header"><div className={`stat-card-icon ${color}`}><Icono size={20} /></div></div>
      <div className="stat-card-value">{valor}</div>
      <div className="stat-card-label">{etiqueta}</div>
      {detalle && <div className="stat-card-trend neutral">{detalle}</div>}
    </div>
  )
}

function Tabla({ titulo, filas, primeraColumna, renderPrimera }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header"><h3>{titulo}</h3></div>
      <div className="card-body-flush cola-tabla-wrap">
        <table className="data-table metricas-tabla">
          <thead>
            <tr>
              <th>{primeraColumna}</th><th>Leads nuevos</th><th>DNIs enviados</th><th>Aprobados</th><th>Rechazados</th>
              <th>1er intento</th><th>Con familiar</th><th>Verificación prom.</th><th>Asignados</th><th>Ventas</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={10}><div className="empty-state"><p>Sin datos en este período</p></div></td></tr>
            ) : filas.map(f => (
              <tr key={renderPrimera(f)}>
                <td className="table-cell-primary">{renderPrimera(f)}</td>
                <td>{f.leads_nuevos}</td><td>{f.dnis_enviados}</td><td>{f.aprobados}</td><td>{f.rechazados}</td>
                <td>{f.aprobados_primer_intento}</td><td>{f.aprobados_con_familiar}</td>
                <td>{formatDuracion(tiempoPromedio(f))}</td><td>{f.asignados}</td><td>{f.ventas_cerradas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function MetricasPage() {
  const [dias, setDias] = useState(30)
  const [origen, setOrigen] = useState('')
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { desde, hasta } = rangoUltimosDias(dias)
    const { data, error } = await supabase.rpc('metricas_dni', { p_desde: desde, p_hasta: hasta })
    if (error) {
      setError(error.message?.includes('SIN_PERMISO') ? 'Solo los administradores ven las métricas.' : 'No se pudieron cargar las métricas.')
      setFilas([])
    } else {
      setError(null)
      setFilas(data || [])
    }
    setCargando(false)
  }, [dias])

  useEffect(() => { cargar() }, [cargar])

  const visibles = useMemo(() => filtrarOrigen(filas, origen), [filas, origen])
  const t = useMemo(() => totales(visibles), [visibles])
  const tasa = tasaAprobacion(t)
  const etiquetaOrigen = o => LEAD_ORIGEN_LABELS[o] || o

  return (
    <div>
      <div className="filters-bar">
        <div className="view-toggle">
          {PERIODOS.map(p => (
            <button key={p} className={`view-toggle-btn ${dias === p ? 'active' : ''}`} onClick={() => setDias(p)}>Últimos {p} días</button>
          ))}
        </div>
        <select className="filter-select" value={origen} onChange={e => setOrigen(e.target.value)}>
          <option value="">Todos los orígenes</option>
          {origenesPresentes(filas).map(o => <option key={o} value={o}>{etiquetaOrigen(o)}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={cargar}><RefreshCw size={14} /> Actualizar</button>
      </div>

      {error ? (
        <div className="card"><div className="card-body"><div className="empty-state"><p>{error}</p></div></div></div>
      ) : cargando ? (
        <div className="spinner-overlay"><div className="spinner" /></div>
      ) : (
        <>
          <div className="stats-row metricas-tiles">
            <Tile icono={Users} color="blue" valor={t.leads_nuevos} etiqueta="Leads nuevos" />
            <Tile icono={ShieldCheck} color="purple" valor={t.dnis_enviados} etiqueta="DNIs enviados" />
            <Tile icono={BadgeCheck} color="green" valor={t.aprobados} etiqueta="Aprobados"
              detalle={tasa !== null ? `${tasa}% de los resueltos` : null} />
            <Tile icono={XCircle} color="rojo" valor={t.rechazados} etiqueta="Rechazados" />
            <Tile icono={BadgeCheck} color="green" valor={`${t.aprobados_primer_intento} / ${t.aprobados_con_familiar}`}
              etiqueta="Aprobados: 1er intento / con familiar" />
            <Tile icono={Clock} color="yellow" valor={formatDuracion(tiempoPromedio(t))} etiqueta="Tiempo promedio de verificación" />
            <Tile icono={UserCheck} color="blue" valor={t.asignados} etiqueta="Asignados a vendedores" />
            <Tile icono={Award} color="green" valor={t.ventas_cerradas} etiqueta="Ventas cerradas" />
          </div>
          <p className="form-hint" style={{ marginBottom: 16 }}>
            Los datos de DNI (enviados, aprobados, tiempos) se registran desde que se activó la verificación en el CRM.
            Leads nuevos y ventas cerradas incluyen la historia completa.
          </p>

          <Tabla titulo="Por día" primeraColumna="Día" filas={porDia(visibles)} renderPrimera={f => formatDia(f.dia)} />
          <Tabla titulo="Por origen" primeraColumna="Origen" filas={porOrigen(visibles)} renderPrimera={f => etiquetaOrigen(f.origen)} />
        </>
      )}
    </div>
  )
}
