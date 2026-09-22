import { useTheme } from '../contexts/ThemeContext'
import { Sun, Moon, Monitor } from 'lucide-react'

const OPCIONES = [
  { valor: 'light', icon: Sun, titulo: 'Modo claro' },
  { valor: 'dark', icon: Moon, titulo: 'Modo oscuro' },
  { valor: 'auto', icon: Monitor, titulo: 'Seguir al sistema' },
]

export default function ThemeToggle() {
  const { mode, setMode } = useTheme()

  return (
    <div className="theme-toggle" role="group" aria-label="Apariencia">
      {OPCIONES.map(({ valor, icon: Icon, titulo }) => (
        <button
          key={valor}
          type="button"
          className={`theme-toggle-btn ${mode === valor ? 'active' : ''}`}
          onClick={() => setMode(valor)}
          title={titulo}
          aria-label={titulo}
          aria-pressed={mode === valor}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}
