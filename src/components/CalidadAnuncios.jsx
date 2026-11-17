import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ordenarPorCalidad, porcentaje } from '../lib/calidadAnuncios'

// Qué anuncio trae gente que compra: por cada anuncio de Meta, cuántas conversaciones se volvieron leads
// listos para comprar, con DNI aprobado, con visita y con venta. Datos de la vista calidad_anuncios.
export default function CalidadAnuncios() {
  const [filas, setFilas] = useState(null)

  useEffect(() => {
    supabase.from('calidad_anuncios').select('*').then(({ data, error }) => setFilas(error ? [] : data ?? []))
  }, [])

  if (filas === null) return null

  return (
    <div className="card">
      <div className="card-header"><h3>Calidad por anuncio</h3></div>
      {filas.length === 0 ? (
        <p className="calidad-vacio">
          Todavía no llegaron conversaciones desde anuncios desde que se empezó a medir. Apenas alguien escriba desde un
          anuncio, acá vas a ver cuántos de cada anuncio terminan listos para comprar.
        </p>
      ) : (
        <div className="card-body-flush cola-tabla-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Anuncio</th>
                <th>Conversaciones</th>
                <th>Dijeron cómo pagan</th>
                <th>Listos para comprar</th>
                <th>DNI aprobado / rechazado</th>
                <th>Con visita</th>
                <th>Ventas</th>
              </tr>
            </thead>
            <tbody>
              {ordenarPorCalidad(filas).map((f) => (
                <tr key={f.anuncio_id}>
                  <td><strong>{f.anuncio}</strong><div className="calidad-canal">{f.canal === 'instagram' ? 'Instagram' : 'WhatsApp'}</div></td>
                  <td>{f.conversaciones}</td>
                  <td>{f.dijeron_como_pagan} <span className="calidad-pct">{porcentaje(f.dijeron_como_pagan, f.conversaciones)}</span></td>
                  <td><strong>{f.listos_para_comprar}</strong> <span className="calidad-pct">{porcentaje(f.listos_para_comprar, f.conversaciones)}</span></td>
                  <td>{f.dni_aprobado} / {f.dni_rechazado}</td>
                  <td>{f.con_visita}</td>
                  <td>{f.ventas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
