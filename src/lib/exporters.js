/**
 * Exportadores y generadores de enlaces hacia herramientas externas.
 * Todo corre en el navegador: no consulta ni modifica la base de datos.
 */

/* ------------------------------------------------------------------ */
/* Descarga genérica                                                   */
/* ------------------------------------------------------------------ */

export function downloadFile(contenido, nombreArchivo, mime = 'text/plain;charset=utf-8') {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function stamp() {
  return new Date().toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* CSV / Excel                                                         */
/* ------------------------------------------------------------------ */

function escapeCell(valor, separador) {
  if (valor === null || valor === undefined) return ''
  const texto = String(valor)
  const necesitaComillas =
    texto.includes(separador) || texto.includes('"') || texto.includes('\n') || texto.includes('\r')
  return necesitaComillas ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * Construye un CSV correctamente escapado.
 * @param {string[]} headers
 * @param {Array<Array<any>>} rows
 * @param {string} separador ';' funciona mejor con Excel en español
 */
export function buildCSV(headers, rows, separador = ';') {
  const lineas = [headers.map(h => escapeCell(h, separador)).join(separador)]
  rows.forEach(fila => lineas.push(fila.map(c => escapeCell(c, separador)).join(separador)))
  return lineas.join('\r\n')
}

/** CSV con BOM UTF-8 para que Excel respete los acentos. */
export function downloadCSV(headers, rows, nombreArchivo, separador = ';') {
  const csv = buildCSV(headers, rows, separador)
  downloadFile(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), nombreArchivo)
}

/** TSV al portapapeles: se pega directo en Google Sheets o Excel. */
export async function copyAsSheet(headers, rows) {
  const tsv = [headers.join('\t'), ...rows.map(r => r.map(c => String(c ?? '').replace(/\t|\n|\r/g, ' ')).join('\t'))].join('\n')
  try {
    await navigator.clipboard.writeText(tsv)
    return true
  } catch {
    return false
  }
}

/** Copia de seguridad legible en JSON (sólo lectura, no restaura nada solo). */
export function downloadJSON(data, nombreArchivo) {
  downloadFile(JSON.stringify(data, null, 2), nombreArchivo, 'application/json;charset=utf-8')
}

/* ------------------------------------------------------------------ */
/* Contactos: vCard                                                    */
/* ------------------------------------------------------------------ */

function vcardEscape(v) {
  return String(v ?? '').replace(/[\;,]/g, m => '\\' + m).replace(/\n/g, '\\n')
}

/** Genera un .vcf con todos los contactos: se importa en el celular de una. */
export function buildVCards(contactos) {
  return contactos
    .filter(c => c.nombre)
    .map(c => {
      const lineas = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${vcardEscape(c.nombre)}`,
        `N:${vcardEscape(c.nombre)};;;;`,
      ]
      if (c.telefono) lineas.push(`TEL;TYPE=CELL:${vcardEscape(c.telefono)}`)
      if (c.email) lineas.push(`EMAIL;TYPE=INTERNET:${vcardEscape(c.email)}`)
      lineas.push('ORG:MotoBox')
      const nota = [c.modelo_interes && `Modelo: ${c.modelo_interes}`, c.estado && `Estado: ${c.estado}`]
        .filter(Boolean)
        .join(' · ')
      if (nota) lineas.push(`NOTE:${vcardEscape(nota)}`)
      lineas.push('END:VCARD')
      return lineas.join('\r\n')
    })
    .join('\r\n')
}

export function downloadVCards(contactos, nombreArchivo = `contactos_motobox_${stamp()}.vcf`) {
  downloadFile(buildVCards(contactos), nombreArchivo, 'text/vcard;charset=utf-8')
}

/* ------------------------------------------------------------------ */
/* Calendario: ICS + Google Calendar                                   */
/* ------------------------------------------------------------------ */

function icsDate(fecha) {
  const d = new Date(fecha)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsEscape(v) {
  return String(v ?? '').replace(/[\;,]/g, m => '\\' + m).replace(/\n/g, '\\n')
}

/**
 * Archivo .ics con todas las citas: se importa en Google Calendar, Outlook,
 * Apple Calendar o el calendario del celular.
 */
export function buildICS(citas, duracionMin = 45) {
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MotoBox CRM//Agenda//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Agenda MotoBox',
  ]

  citas
    .filter(c => c.fecha_agenda)
    .forEach(c => {
      const inicio = new Date(c.fecha_agenda)
      const fin = new Date(inicio.getTime() + duracionMin * 60000)
      const descripcion = [
        c.telefono && `Teléfono: ${c.telefono}`,
        c.modelo_interes && `Modelo: ${c.modelo_interes}`,
        c.estado && `Estado: ${c.estado}`,
        c.vendedor && `Vendedor: ${c.vendedor}`,
        c.notas && `Notas: ${c.notas}`,
      ]
        .filter(Boolean)
        .join('\\n')

      lineas.push(
        'BEGIN:VEVENT',
        `UID:${c.id || Math.random().toString(36).slice(2)}@motobox-crm`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(inicio)}`,
        `DTEND:${icsDate(fin)}`,
        `SUMMARY:${icsEscape(`Cita: ${c.nombre}${c.modelo_interes ? ` — ${c.modelo_interes}` : ''}`)}`,
        `DESCRIPTION:${descripcion}`,
        'BEGIN:VALARM',
        'TRIGGER:-PT30M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Recordatorio de cita MotoBox',
        'END:VALARM',
        'END:VEVENT'
      )
    })

  lineas.push('END:VCALENDAR')
  return lineas.join('\r\n')
}

export function downloadICS(citas, duracionMin = 45, nombreArchivo = `agenda_motobox_${stamp()}.ics`) {
  downloadFile(buildICS(citas, duracionMin), nombreArchivo, 'text/calendar;charset=utf-8')
}

/** Enlace directo "Agregar a Google Calendar" para una cita puntual. */
export function googleCalendarLink(cita, duracionMin = 45) {
  if (!cita?.fecha_agenda) return null
  const inicio = new Date(cita.fecha_agenda)
  const fin = new Date(inicio.getTime() + duracionMin * 60000)
  const detalles = [
    cita.telefono && `Teléfono: ${cita.telefono}`,
    cita.modelo_interes && `Modelo: ${cita.modelo_interes}`,
    cita.notas && `Notas: ${cita.notas}`,
  ]
    .filter(Boolean)
    .join('\n')

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Cita MotoBox: ${cita.nombre || ''}`.trim(),
    dates: `${icsDate(inicio)}/${icsDate(fin)}`,
    details: detalles,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/* ------------------------------------------------------------------ */
/* WhatsApp / teléfono / email                                         */
/* ------------------------------------------------------------------ */

/** Normaliza un teléfono argentino a formato internacional para wa.me. */
export function normalizePhone(telefono, prefijoPais = '54') {
  if (!telefono) return null
  const limpio = String(telefono).replace(/\D/g, '')
  if (!limpio) return null
  if (limpio.startsWith(prefijoPais)) return limpio
  return prefijoPais + limpio.replace(/^0/, '')
}

export function whatsappLink(telefono, mensaje, prefijoPais = '54') {
  const numero = normalizePhone(telefono, prefijoPais)
  if (!numero) return null
  const base = `https://wa.me/${numero}`
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base
}

/**
 * Reemplaza las variables de una plantilla.
 * Variables soportadas: {nombre} {modelo} {vendedor} {presupuesto} {empresa}
 */
export function renderTemplate(plantilla, datos = {}) {
  const valores = {
    nombre: datos.nombre || '',
    modelo: datos.modelo_interes || datos.modelo || 'moto',
    vendedor: datos.vendedor || '',
    presupuesto: datos.presupuesto_estimado ? '$' + Number(datos.presupuesto_estimado).toLocaleString('es-AR') : '',
    empresa: datos.empresa || 'MotoBox',
    telefono: datos.telefono || '',
  }
  return String(plantilla || '').replace(/\{(\w+)\}/g, (match, clave) =>
    Object.prototype.hasOwnProperty.call(valores, clave) ? valores[clave] : match
  )
}

export function mailtoLink(email, asunto, cuerpo) {
  if (!email) return null
  const params = new URLSearchParams()
  if (asunto) params.set('subject', asunto)
  if (cuerpo) params.set('body', cuerpo)
  const qs = params.toString()
  return `mailto:${email}${qs ? '?' + qs.replace(/\+/g, '%20') : ''}`
}

/* ------------------------------------------------------------------ */
/* Snippet de captación para la web pública                            */
/* ------------------------------------------------------------------ */

/**
 * Genera el HTML+JS de un formulario que inserta leads directo en Supabase
 * usando la clave pública (anon). Se pega en la web y listo.
 */
export function buildWebFormSnippet({ supabaseUrl, anonKey, origen = 'otro' }) {
  return `<!-- Formulario de captación MotoBox — pegar en la web pública -->
<form id="motobox-lead-form">
  <input name="nombre" placeholder="Tu nombre" required />
  <input name="telefono" placeholder="Tu WhatsApp" required />
  <input name="modelo_interes" placeholder="¿Qué moto te interesa?" />
  <button type="submit">Quiero que me contacten</button>
</form>

<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

  const supabase = createClient('${supabaseUrl || 'TU_SUPABASE_URL'}', '${anonKey || 'TU_SUPABASE_ANON_KEY'}')

  document.getElementById('motobox-lead-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = new FormData(e.target)
    const { error } = await supabase.from('leads').insert([{
      nombre: form.get('nombre'),
      telefono: form.get('telefono'),
      modelo_interes: form.get('modelo_interes'),
      origen: '${origen}',
      estado: 'nuevo',
      notas: 'Ingresó desde el formulario de la web'
    }])
    if (error) { alert('No pudimos enviar tu consulta, probá por WhatsApp.'); return }
    e.target.reset()
    alert('¡Listo! Te contactamos a la brevedad.')
  })
</script>`
}
