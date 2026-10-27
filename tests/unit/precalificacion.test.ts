import { describe, it, expect, vi } from 'vitest'
import {
  armarCuil, cuilesPosibles, precalificar, resumirDeudas, contarChequesImpagos, notaPrecalificacion,
} from '../../supabase/functions/sendpulse-whatsapp-webhook/precalificacion.ts'

const API = 'https://bcra.test/CentralDeDeudores/v1.0'

function respuesta(status: number, cuerpo?: unknown) {
  return new Response(cuerpo === undefined ? '' : JSON.stringify(cuerpo), { status })
}

function deudas(cuil: string, periodos: Array<{ periodo: string; entidades: Array<Record<string, unknown>> }>) {
  return { status: 200, results: { identificacion: Number(cuil), denominacion: 'X', periodos } }
}

// Responde según la URL: { 'Deudas/2030…': Response } ; lo que no está -> 404.
function fetchPorUrl(mapa: Record<string, Response | Error>) {
  const llamadas: string[] = []
  const fn = vi.fn(async (url: string) => {
    llamadas.push(url)
    const clave = Object.keys(mapa).find((k) => url.endsWith(k))
    if (!clave) return respuesta(404, { status: 404, errorMessages: ['No se encontró datos para la identificación ingresada.'] })
    const r = mapa[clave]
    if (r instanceof Error) throw r
    return r.clone()
  })
  return { fn: fn as unknown as typeof fetch, llamadas }
}

describe('CUIL', () => {
  it('arma el CUIL con el dígito verificador correcto', () => {
    // Ejemplos verificables a mano con los pesos 5,4,3,2,7,6,5,4,3,2.
    expect(armarCuil('20', '12345678')).toBe('20123456786')
    expect(armarCuil('27', '12345678')).toBe('27123456780')
  })

  it('devuelve hombre y mujer, completa con ceros y descarta DNIs inválidos', () => {
    expect(cuilesPosibles('12.345.678')).toEqual(['20123456786', '27123456780'])
    // DNI de 7 dígitos: se completa con 0. Con 27 el verificador da 10, así que pasa a 23-…-4.
    expect(cuilesPosibles('1234567')).toEqual(['20012345675', '23012345674'])
    expect(cuilesPosibles('123')).toEqual([])
    expect(cuilesPosibles('')).toEqual([])
  })

  it('cuando el verificador da 10 usa el prefijo 23', () => {
    // Busca un DNI cuyo verificador con 20 dé 10 y comprueba la regla.
    let dni = ''
    for (let n = 10000000; n < 10001000; n++) {
      if (armarCuil('20', String(n)).length === 12) { dni = String(n); break }
    }
    expect(dni).not.toBe('')
    expect(cuilesPosibles(dni)[0]).toBe(`23${dni}9`)
  })
})

describe('resumen de deudas', () => {
  it('usa solo el período más reciente y convierte miles de pesos', () => {
    const r = resumirDeudas(deudas('1', [
      { periodo: '202608', entidades: [{ entidad: 'A', situacion: 5, monto: 900 }] },
      { periodo: '202609', entidades: [{ entidad: 'A', situacion: 1, monto: 100.5 }, { entidad: 'B', situacion: 2, monto: 50 }] },
    ]))
    expect(r).toEqual({ peorSituacion: 2, entidades: 2, montoTotal: 150500, procesoJudicial: false })
  })

  it('cuenta solo cheques rechazados sin pagar', () => {
    expect(contarChequesImpagos({ results: { causales: [{ causal: 'SIN FONDOS', entidades: [{ detalle: [
      { nroCheque: 1, fechaPago: '2026-01-10' }, { nroCheque: 2, fechaPago: null }, { nroCheque: 3 },
    ] }] }] } })).toBe(2)
    expect(contarChequesImpagos(null)).toBe(0)
  })
})

describe('precalificar', () => {
  const [hombre, mujer] = cuilesPosibles('30111222')

  it('sin deudas informadas (404 en los dos CUIL) es apto', async () => {
    const { fn, llamadas } = fetchPorUrl({})
    const p = await precalificar('30111222', { apiUrl: API }, { fetch: fn })
    expect(p.resultado).toBe('apto')
    expect(p.peorSituacion).toBeNull()
    expect(llamadas).toEqual([`${API}/Deudas/${hombre}`, `${API}/Deudas/${mujer}`])
  })

  it('situación 1 o 2 es apto; mira los cheques del CUIL que tiene datos', async () => {
    const { fn, llamadas } = fetchPorUrl({
      [`Deudas/${mujer}`]: respuesta(200, deudas(mujer, [{ periodo: '202609', entidades: [{ situacion: 2, monto: 300 }] }])),
    })
    const p = await precalificar('30111222', { apiUrl: API }, { fetch: fn })
    expect(p).toMatchObject({ resultado: 'apto', peorSituacion: 2, entidades: 1, montoTotal: 300000, chequesRechazados: 0 })
    expect(llamadas).toContain(`${API}/Deudas/ChequesRechazados/${mujer}`)
  })

  it('situación 3 o peor es no apto', async () => {
    const { fn } = fetchPorUrl({
      [`Deudas/${hombre}`]: respuesta(200, deudas(hombre, [{ periodo: '202609', entidades: [{ situacion: 1, monto: 10 }, { situacion: 4, monto: 80 }] }])),
    })
    const p = await precalificar('30111222', { apiUrl: API }, { fetch: fn })
    expect(p).toMatchObject({ resultado: 'no_apto', peorSituacion: 4, motivo: 'Situación 4 en el BCRA' })
  })

  it('la situación máxima se puede configurar', async () => {
    const mapa = { [`Deudas/${hombre}`]: respuesta(200, deudas(hombre, [{ periodo: '202609', entidades: [{ situacion: 2, monto: 10 }] }])) }
    expect((await precalificar('30111222', { apiUrl: API, situacionMaxima: 1 }, { fetch: fetchPorUrl(mapa).fn })).resultado).toBe('no_apto')
    expect((await precalificar('30111222', { apiUrl: API, situacionMaxima: 2 }, { fetch: fetchPorUrl(mapa).fn })).resultado).toBe('apto')
  })

  it('cheques rechazados sin pagar o proceso judicial es no apto aunque la situación sea 1', async () => {
    const cheques = await precalificar('30111222', { apiUrl: API }, { fetch: fetchPorUrl({
      [`Deudas/${hombre}`]: respuesta(200, deudas(hombre, [{ periodo: '202609', entidades: [{ situacion: 1, monto: 10 }] }])),
      [`ChequesRechazados/${hombre}`]: respuesta(200, { results: { causales: [{ entidades: [{ detalle: [{ fechaPago: null }] }] }] } }),
    }).fn })
    expect(cheques).toMatchObject({ resultado: 'no_apto', chequesRechazados: 1 })

    const judicial = await precalificar('30111222', { apiUrl: API }, { fetch: fetchPorUrl({
      [`Deudas/${hombre}`]: respuesta(200, deudas(hombre, [{ periodo: '202609', entidades: [{ situacion: 1, monto: 10, procesoJud: true }] }])),
    }).fn })
    expect(judicial).toMatchObject({ resultado: 'no_apto', motivo: 'Deuda en proceso judicial' })
  })

  it('si el BCRA falla y no hay datos, queda sin verificar (el lead sigue el camino de siempre)', async () => {
    const caido = await precalificar('30111222', { apiUrl: API }, { fetch: fetchPorUrl({
      [`Deudas/${hombre}`]: respuesta(500), [`Deudas/${mujer}`]: new TypeError('fetch failed'),
    }).fn })
    expect(caido.resultado).toBe('sin_verificar')

    // Uno da 404 y el otro falla: no se puede afirmar que no tiene deudas.
    const mitad = await precalificar('30111222', { apiUrl: API }, { fetch: fetchPorUrl({ [`Deudas/${mujer}`]: respuesta(503) }).fn })
    expect(mitad.resultado).toBe('sin_verificar')
  })

  it('si falla la consulta de cheques, decide con las deudas', async () => {
    const p = await precalificar('30111222', { apiUrl: API }, { fetch: fetchPorUrl({
      [`Deudas/${hombre}`]: respuesta(200, deudas(hombre, [{ periodo: '202609', entidades: [{ situacion: 1, monto: 10 }] }])),
      [`ChequesRechazados/${hombre}`]: respuesta(500),
    }).fn })
    expect(p.resultado).toBe('apto')
  })

  it('corta por tiempo y lo trata como falla', async () => {
    const lento = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, rechazar) => {
      init.signal?.addEventListener('abort', () => rechazar(new DOMException('abortado', 'AbortError')))
    })) as unknown as typeof fetch
    const p = await precalificar('30111222', { apiUrl: API, timeoutMs: 20 }, { fetch: lento })
    expect(p.resultado).toBe('sin_verificar')
  })

  it('DNI inválido no consulta nada', async () => {
    const { fn } = fetchPorUrl({})
    expect((await precalificar('12', { apiUrl: API }, { fetch: fn })).resultado).toBe('sin_verificar')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('nota', () => {
  it('no incluye DNI ni CUIL', () => {
    const n = notaPrecalificacion({ resultado: 'no_apto', peorSituacion: 4, entidades: 2, montoTotal: 1234567, chequesRechazados: 0, motivo: 'Situación 4 en el BCRA' }, 2, 'familiar')
    expect(n).toBe('Precalificación BCRA intento 2 (familiar): NO APTO. Situación 4 en el BCRA — 2 entidad(es), deuda $1.234.567')
    expect(n).not.toMatch(/\d{7,}/)
  })
})
