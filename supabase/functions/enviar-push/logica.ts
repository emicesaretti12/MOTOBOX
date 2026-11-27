// Arma el aviso de un lead listo para comprar. Sin dependencias: se prueba con vitest.

export type LeadAviso = {
  id: string
  nombre?: string | null
  modelo_interes?: string | null
  forma_pago?: string | null
  caliente_motivo?: string | null
  bcra_resultado?: string | null
}

const PAGO: Record<string, string> = {
  contado: 'de contado',
  tarjeta: 'con tarjeta',
  anticipo_cuotas: 'con anticipo + cuotas',
}

export function textoAviso(l: LeadAviso) {
  const nombre = String(l.nombre ?? '').trim()
  const quien = !nombre || /^sin nombre/i.test(nombre) || /^cliente$/i.test(nombre) ? 'Un cliente' : nombre.split(/\s+/)[0]
  const moto = String(l.modelo_interes ?? '').trim()
  let que: string
  if (l.caliente_motivo === 'asesor') que = 'pidió hablar con un asesor'
  else if (l.forma_pago && PAGO[l.forma_pago]) que = `quiere comprar ${PAGO[l.forma_pago]}`
  else if (l.bcra_resultado === 'apto') que = 'tiene el crédito aprobado'
  else que = 'está listo para comprar'
  return {
    title: '🔥 Lead listo para comprar',
    body: `${quien} ${que}${moto && !/^\d+$/.test(moto) ? ` · ${moto}` : ''}. Escribile ahora.`,
    url: `/leads/${l.id}`,
    tag: `lead-${l.id}`,
  }
}

// A quién avisar: al vendedor asignado; si no tiene, a los admins.
export function destinatarios(vendedorId: string | null | undefined, adminIds: string[]) {
  return vendedorId ? [vendedorId] : [...new Set(adminIds)]
}
