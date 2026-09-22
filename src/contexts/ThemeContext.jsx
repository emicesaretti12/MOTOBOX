import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'

/**
 * Tema visual del CRM (neomorfismo).
 * - mode: 'light' | 'dark' | 'auto'  → apariencia
 * - density: 'comfortable' | 'compact' → densidad de la interfaz
 * Todo se guarda en localStorage: NO toca la base de datos.
 */

const THEME_KEY = 'motobox.theme'
const DENSITY_KEY = 'motobox.density'
const ThemeContext = createContext(null)

function readStored(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* modo incógnito / storage bloqueado: se ignora */
  }
}

function prefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function resolveMode(mode) {
  if (mode === 'dark') return 'dark'
  if (mode === 'light') return 'light'
  return prefersDark() ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => readStored(THEME_KEY, 'light'))
  const [density, setDensityState] = useState(() => readStored(DENSITY_KEY, 'comfortable'))
  const [resolved, setResolved] = useState(() => resolveMode(readStored(THEME_KEY, 'light')))

  // Aplicar al <html> para que el CSS reaccione
  useEffect(() => {
    const next = resolveMode(mode)
    setResolved(next)
    const root = document.documentElement
    root.setAttribute('data-theme', next)
    root.style.colorScheme = next
  }, [mode])

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
  }, [density])

  // Seguir al sistema cuando el modo es 'auto'
  useEffect(() => {
    if (mode !== 'auto') return undefined
    let mq
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return undefined
    }
    const onChange = () => {
      const next = prefersDark() ? 'dark' : 'light'
      setResolved(next)
      document.documentElement.setAttribute('data-theme', next)
      document.documentElement.style.colorScheme = next
    }
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [mode])

  const setMode = useCallback(nextMode => {
    setModeState(nextMode)
    writeStored(THEME_KEY, nextMode)
  }, [])

  const setDensity = useCallback(nextDensity => {
    setDensityState(nextDensity)
    writeStored(DENSITY_KEY, nextDensity)
  }, [])

  const toggleMode = useCallback(() => {
    setMode(resolveMode(mode) === 'dark' ? 'light' : 'dark')
  }, [mode, setMode])

  const value = useMemo(
    () => ({ mode, resolved, density, setMode, setDensity, toggleMode, isDark: resolved === 'dark' }),
    [mode, resolved, density, setMode, setDensity, toggleMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

/**
 * Paleta para los gráficos de Recharts, sincronizada con el tema activo.
 */
export function useChartTheme() {
  const { isDark } = useTheme()
  return useMemo(
    () => ({
      grid: isDark ? '#333a44' : '#d7dfea',
      axis: isDark ? '#8b94a3' : '#7c8798',
      tooltipBg: isDark ? '#262b32' : '#eef2f8',
      tooltipBorder: isDark ? '#333a44' : '#d7dfea',
      tooltipText: isDark ? '#f0f3f7' : '#1c1f24',
      bar: '#007AFF',
      cursor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.07)',
    }),
    [isDark]
  )
}
