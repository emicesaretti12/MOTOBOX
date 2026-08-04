/**
 * Constantes centralizadas del CRM
 * Evita duplicación y facilita mantenimiento
 */

// Estados de lead
export const LEAD_STATUS = {
  NUEVO: 'nuevo',
  CONTACTADO: 'contactado',
  EN_NEGOCIACION: 'en_negociacion',
  VENTA_CERRADA: 'venta_cerrada',
  PERDIDO: 'perdido'
}

export const LEAD_STATUS_LABELS = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  en_negociacion: 'En Negociación',
  venta_cerrada: 'Venta Cerrada',
  perdido: 'Perdido'
}

export const LEAD_STATUS_COLORS = {
  nuevo: '#2563EB',
  contactado: '#D97706',
  en_negociacion: '#7C3AED',
  venta_cerrada: '#16A34A',
  perdido: '#71717A'
}

// Orden del pipeline
export const PIPELINE_ORDER = [
  LEAD_STATUS.NUEVO,
  LEAD_STATUS.CONTACTADO,
  LEAD_STATUS.EN_NEGOCIACION,
  LEAD_STATUS.VENTA_CERRADA
]

// Orígenes de lead
export const LEAD_ORIGEN = {
  WHATSAPP: 'whatsapp',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  PRESENCIAL: 'presencial',
  REFERIDO: 'referido',
  OTRO: 'otro'
}

export const LEAD_ORIGEN_LABELS = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  presencial: 'Presencial',
  referido: 'Referido',
  otro: 'Otro'
}

// Tipos de interacción
export const INTERACTION_TYPE = {
  LLAMADA: 'llamada',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  VISITA: 'visita',
  OTRO: 'otro'
}

export const INTERACTION_TYPE_LABELS = {
  llamada: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Email',
  visita: 'Visita',
  otro: 'Otro'
}

// Roles de usuario
export const USER_ROLE = {
  ADMIN: 'admin',
  EMPLEADO: 'empleado'
}

export const USER_ROLE_LABELS = {
  admin: 'Administrador',
  empleado: 'Vendedor'
}

// Validaciones
export const VALIDATION = {
  MIN_PASSWORD_LENGTH: 6,
  MIN_DNI_LENGTH: 7,
  MAX_DNI_LENGTH: 8,
  MIN_PHONE_LENGTH: 7
}

// Límites de paginación
export const PAGINATION = {
  DASHBOARD_INTERACTIONS: 10,
  HISTORY_LIMIT: 20,
  LEADS_PER_PAGE: 50
}

// Mensajes de error comunes
export const ERROR_MESSAGES = {
  REQUIRED_FIELD: 'Este campo es requerido',
  INVALID_EMAIL: 'Email inválido',
  INVALID_PHONE: 'Teléfono inválido',
  INVALID_DNI: 'DNI inválido',
  PASSWORD_TOO_SHORT: `La contraseña debe tener al menos ${VALIDATION.MIN_PASSWORD_LENGTH} caracteres`,
  FETCH_ERROR: 'Error al cargar datos',
  SAVE_ERROR: 'Error al guardar',
  DELETE_ERROR: 'Error al eliminar',
  UNAUTHORIZED: 'No tienes permisos para realizar esta acción',
  NOT_FOUND: 'Recurso no encontrado'
}

// Mensajes de éxito comunes
export const SUCCESS_MESSAGES = {
  CREATED: 'Creado exitosamente',
  UPDATED: 'Actualizado exitosamente',
  DELETED: 'Eliminado exitosamente',
  SAVED: 'Guardado exitosamente'
}

// Configuración de UI
export const UI_CONFIG = {
  TOAST_DURATION: 3000,
  MODAL_ANIMATION_DURATION: 300,
  DEBOUNCE_DELAY: 300
}

// Estados de inventario
export const INVENTORY_STATUS_LABELS = {
  disponible: 'Disponible',
  vendido: 'Vendido',
  reservado: 'Reservado',
  en_reparacion: 'En Reparación',
};

export const INVENTORY_STATUS_COLORS = {
  disponible: '#16A34A', // Verde
  vendido: '#DC2626',    // Rojo
  reservado: '#D97706',   // Naranja
  en_reparacion: '#2563EB', // Azul
};
