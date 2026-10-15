import { describe, it, expect } from 'vitest'
import {
  totales, porDia, porOrigen, filtrarOrigen, origenesPresentes, tiempoPromedio, tasaAprobacion,
  formatDuracion, rangoUltimosDias, formatDia,
} from '../../src/lib/metricas.js'

const fila = (dia, origen, extra = {}) => ({
  dia, origen, leads_nuevos: 0, dnis_enviados: 0, aprobados: 0, rechazados: 0, aprobados_primer_intento: 0,
  aprobados_con_familiar: 0, verificacion_segundos: '0', verificaciones_medidas: 0, asignados: 0, ventas_cerradas: 0, ...extra,
})

const FILAS = [
  fila('2026-10-16', 'whatsapp', { leads_nuevos: 5, dnis_enviados: 4, aprobados: 2, rechazados: 2, aprobados_primer_intento: 1, aprobados_con_familiar: 1, verificacion_segundos: '1200', verificaciones_medidas: 4, asignados: 2 }),
  fila('2026-10-16', 'instagram', { leads_nuevos: 3 }),
  fila('2026-10-15', 'whatsapp', { leads_nuevos: 2, dnis_enviados: 2, aprobados: 1, verificacion_segundos: '3600', verificaciones_medidas: 1, ventas_cerradas: 1 }),
]

describe('métricas', () => {
  it('totales y promedios ponderados', () => {
    const t = totales(FILAS)
    expect(t).toMatchObject({ leads_nuevos: 10, dnis_enviados: 6, aprobados: 3, rechazados: 2, asignados: 2, ventas_cerradas: 1 })
    // (1200 + 3600) / 5 = 960 s, no el promedio de promedios
    expect(tiempoPromedio(t)).toBe(960)
    expect(tasaAprobacion(t)).toBe(60)
    expect(tiempoPromedio(totales([]))).toBeNull()
    expect(tasaAprobacion(totales([]))).toBeNull()
  })

  it('agrupa por día (más reciente primero) y por origen', () => {
    expect(porDia(FILAS).map(d => [d.dia, d.leads_nuevos])).toEqual([['2026-10-16', 8], ['2026-10-15', 2]])
    expect(porOrigen(FILAS).map(o => [o.origen, o.leads_nuevos])).toEqual([['whatsapp', 7], ['instagram', 3]])
    expect(filtrarOrigen(FILAS, 'instagram')).toHaveLength(1)
    expect(filtrarOrigen(FILAS, '')).toHaveLength(3)
    expect(origenesPresentes(FILAS)).toEqual(['instagram', 'whatsapp'])
  })

  it('formatos', () => {
    expect(formatDuracion(null)).toBe('-')
    expect(formatDuracion(42)).toBe('42 s')
    expect(formatDuracion(960)).toBe('16 min')
    expect(formatDuracion(5400)).toBe('1 h 30 min')
    expect(rangoUltimosDias(7, Date.parse('2026-10-16T02:00:00Z'))).toEqual({ desde: '2026-10-09', hasta: '2026-10-15' })
    expect(formatDia('2026-10-16')).toBe('vie 16/10')
  })
})
