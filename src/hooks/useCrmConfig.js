import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { leerConfig } from '../lib/verificacion'

// Interruptores de crm_config. Devuelve null mientras carga; si falla, todo queda apagado.
export function useCrmConfig() {
  const [config, setConfig] = useState(null)

  useEffect(() => {
    let activo = true
    supabase.from('crm_config').select('clave, valor').then(({ data, error }) => {
      if (activo) setConfig(leerConfig(error ? [] : data))
    })
    return () => { activo = false }
  }, [])

  return config
}
