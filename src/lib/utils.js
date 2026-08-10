/**
 * Utilidades compartidas del CRM
 * Centraliza lógica común para evitar duplicación y mejorar mantenibilidad
 */

// Re-exportar constantes desde constants.js para conveniencia
export {
  LEAD_STATUS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  PIPELINE_ORDER,
  LEAD_ORIGEN,
  LEAD_ORIGEN_LABELS,
  INTERACTION_TYPE,
  INTERACTION_TYPE_LABELS,
  USER_ROLE,
  USER_ROLE_LABELS,
  VALIDATION,
  PAGINATION,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  UI_CONFIG,
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_COLORS
} from './constants'

/**
 * Formatea un número como moneda argentina
 * @param {number} value - Valor a formatear
 * @returns {string} Valor formateado o '-' si es nulo
 */
export function formatCurrency(value) {
  if (!value && value !== 0) return '-'
  return '$' + Number(value).toLocaleString('es-AR')
}

/**
 * Formatea una fecha con hora en formato legible
 * @param {string|Date} date - Fecha a formatear
 * @returns {string} Fecha formateada o '-' si es nula
 */
export function formatDateTime(date) {
  if (!date) return '-'
  try {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return '-'
  }
}

/**
 * Formatea una fecha sin hora
 * @param {string|Date} date - Fecha a formatear
 * @returns {string} Fecha formateada o '-' si es nula
 */
export function formatDate(date) {
  if (!date) return '-'
  try {
    return new Date(date).toLocaleDateString('es-AR')
  } catch {
    return '-'
  }
}

/**
 * Calcula tiempo transcurrido desde una fecha
 * @param {string|Date} date - Fecha de referencia
 * @returns {string} Texto relativo (ej: "Hace 5 min")
 */
export function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000)
  if (seconds < 60) return 'Ahora'
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} hs`
  return `Hace ${Math.floor(seconds / 86400)} días`
}

/**
 * Genera URL de WhatsApp para un teléfono
 * @param {string} phone - Número de teléfono
 * @returns {string|null} URL de WhatsApp o null si es inválido
 */
export function getWhatsAppLink(phone) {
  if (!phone) return null
  const cleaned = phone.replace(/\D/g, '')
  const formatted = cleaned.startsWith('54') ? cleaned : '54' + cleaned
  return `https://wa.me/${formatted}`
}

/**
 * Extrae iniciales de un nombre
 * @param {string} name - Nombre completo
 * @returns {string} Iniciales en mayúsculas (máx 2 caracteres)
 */
export function getInitials(name) {
  if (!name) return '??'
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * Valida un email
 * @param {string} email - Email a validar
 * @returns {boolean} true si es válido
 */
export function isValidEmail(email) {
  if (!email) return true // Campo opcional
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

/**
 * Valida un teléfono (mínimo 7 dígitos)
 * @param {string} phone - Teléfono a validar
 * @returns {boolean} true si es válido
 */
export function isValidPhone(phone) {
  if (!phone) return true // Campo opcional
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 7
}

/**
 * Valida una contraseña (mínimo 6 caracteres)
 * @param {string} password - Contraseña a validar
 * @returns {boolean} true si es válida
 */
export function isValidPassword(password) {
  return password && password.length >= 6
}

/**
 * Valida un DNI (números solamente, 7-8 dígitos)
 * @param {string} dni - DNI a validar
 * @returns {boolean} true si es válido
 */
export function isValidDNI(dni) {
  if (!dni) return false
  const digits = dni.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 8
}

/**
 * Compara dos objetos para detectar cambios
 * @param {object} original - Objeto original
 * @param {object} updated - Objeto actualizado
 * @returns {array} Array de cambios [{field, oldValue, newValue}]
 */
export function getChanges(original, updated) {
  const changes = []
  const fields = new Set([...Object.keys(original), ...Object.keys(updated)])
  
  for (const field of fields) {
    const oldVal = String(original[field] || '')
    const newVal = String(updated[field] || '')
    if (oldVal !== newVal) {
      changes.push({
        field,
        oldValue: oldVal || null,
        newValue: newVal || null
      })
    }
  }
  
  return changes
}

/**
 * Exporta datos a CSV
 * @param {array} data - Array de objetos
 * @param {string} filename - Nombre del archivo
 */
export function exportToCSV(data, filename = 'export.csv') {
  if (!data || data.length === 0) return

  const headers = Object.keys(data[0])
  const rows = [headers]
  
  data.forEach(item => {
    rows.push(headers.map(h => {
      const val = item[h]
      // Escapar comillas y envolver en comillas si contiene comas
      const str = String(val || '')
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str
    }))
  })

  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
}

/**
 * Debounce para funciones
 * @param {function} func - Función a debounce
 * @param {number} delay - Delay en ms
 * @returns {function} Función debounceada
 */
export function debounce(func, delay = 300) {
  let timeoutId
  return function debounced(...args) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }
}

/**
 * Throttle para funciones
 * @param {function} func - Función a throttle
 * @param {number} limit - Limit en ms
 * @returns {function} Función throttleada
 */
export function throttle(func, limit = 300) {
  let inThrottle
  return function throttled(...args) {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * Manejo seguro de errores de Supabase
 * @param {object} error - Error de Supabase
 * @returns {string} Mensaje de error legible
 */
export function getErrorMessage(error) {
  if (!error) return 'Error desconocido'
  if (typeof error === 'string') return error
  if (error.message) return error.message
  if (error.error_description) return error.error_description
  return 'Error desconocido'
}
