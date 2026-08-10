import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Validar variables de entorno
if (!supabaseUrl || !supabaseAnonKey) {
  const missingVars = []
  if (!supabaseUrl) missingVars.push('VITE_SUPABASE_URL')
  if (!supabaseAnonKey) missingVars.push('VITE_SUPABASE_ANON_KEY')
  
  const errorMsg = `Missing required environment variables: ${missingVars.join(', ')}. Please set them in your .env file.`
  console.error(errorMsg)
  
  // Lanzar error en desarrollo para visibilidad
  if (import.meta.env.DEV) {
    throw new Error(errorMsg)
  }
}

/**
 * Cliente Supabase configurado
 * Incluye validaciones y manejo de errores mejorado
 */
export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
)

/**
 * Wrapper para queries con mejor manejo de errores
 * @param {Promise} query - Query de Supabase
 * @param {string} context - Contexto para el error
 * @returns {Promise} {data, error}
 */
export async function executeQuery(query, context = 'Query') {
  try {
    const result = await query
    if (result.error) {
      console.error(`${context} error:`, result.error)
      return { data: null, error: result.error }
    }
    return result
  } catch (err) {
    console.error(`${context} exception:`, err)
    return { data: null, error: err }
  }
}

/**
 * Obtiene datos con reintentos automáticos
 * @param {function} queryFn - Función que retorna la query
 * @param {number} retries - Número de reintentos
 * @returns {Promise} Resultado de la query
 */
export async function queryWithRetry(queryFn, retries = 3) {
  let lastError
  
  for (let i = 0; i < retries; i++) {
    try {
      const result = await queryFn()
      if (!result.error) {
        return result
      }
      lastError = result.error
      
      // Esperar antes de reintentar (exponential backoff)
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100))
      }
    } catch (err) {
      lastError = err
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100))
      }
    }
  }
  
  return { data: null, error: lastError }
}

/**
 * Obtiene la sesión actual de forma segura
 * @returns {Promise} {user, session}
 */
export async function getCurrentSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error
    return { session, user: session?.user || null, error: null }
  } catch (err) {
    console.error('Error getting session:', err)
    return { session: null, user: null, error: err }
  }
}

/**
 * Cierra la sesión de forma segura
 * @returns {Promise} {error}
 */
export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    return { error: null }
  } catch (err) {
    console.error('Error signing out:', err)
    return { error: err }
  }
}
