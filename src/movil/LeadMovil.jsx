import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { MessageCircle, Phone, ClipboardCheck, BadgeCheck, MoreHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { LEAD_STATUS_LABELS, LEAD_ORIGEN_LABELS } from '../lib/constants'
import { comoPaga, formatoPlata } from '../lib/hoy'
import { mensajeCaliente } from '../lib/calientes'
import { useLead, abrirWhatsApp } from './datos'
import { Pantalla, Avatar, Seccion, Fila, Segmentos, Pastilla, Vacio, MenuAcciones } from './ui'
import { HojaResultado, HojaVenta } from './hojas'
import Conversacion, { useChatLead } from './Conversacion'

const TONO_ESTADO = { nuevo: 'azul', contactado: 'naranja', en_negociacion: 'violeta', venta_cerrada: 'verde', perdido: 'gris' }
const fechaLarga = (f) => (f ? new Date(f).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')

function textoDni(l) {
  if (l.estado_dni === 'aprobado' || l.bcra_resultado === 'apto') {
    const m = formatoPlata(l.monto_aprobado)
    return { texto: m ? `Aprobado · ${m}` : 'Aprobado', tono: 'verde' }
  }
  if (l.estado_dni === 'rechazado' || l.bcra_resultado === 'no_apto') return { texto: 'No califica', tono: 'rojo' }
  if (l.estado_dni === 'pendiente') return { texto: 'En revisión', tono: 'naranja' }
  return { texto: 'Sin DNI', tono: 'gris' }
}

export default function LeadMovil() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { addToast } = useToast()
  const { lead, error, cargar, setLead } = useLead(id)
  const eventos = useChatLead(lead)
  const [vista, setVista] = useState(null)
  const [hoja, setHoja] = useState(null) // 'resultado' | 'venta' | 'mas' | 'estado'

  if (error) return <Pantalla titulo="Lead" atras sinTituloGrande><Vacio titulo={error} /></Pantalla>
  if (!lead) return <Pantalla titulo="" atras sinTituloGrande><div className="mv-chat-cargando"><span className="mv-spinner" /></div></Pantalla>

  // Si escribió por el bot, abre en el chat; si no, en los datos.
  const pestana = vista ?? (lead.sendpulse_contact_id || eventos?.length ? 'chat' : 'datos')
  const pago = comoPaga(lead)
  const dni = textoDni(lead)
  const cerrado = ['venta_cerrada', 'perdido'].includes(lead.estado)

  async function cambiarEstado(estado) {
    const previo = lead.estado
    setLead({ ...lead, estado })
    const { error: e } = await supabase.from('leads').update({ estado }).eq('id', lead.id)
    if (e) { setLead({ ...lead, estado: previo }); addToast('No se pudo cambiar el estado', 'error') }
    else addToast(`Ahora está "${LEAD_STATUS_LABELS[estado]}"`, 'success')
  }

  const acciones = [
    { Icono: MessageCircle, texto: 'WhatsApp', clase: 'wa', off: !lead.telefono, onClick: () => { abrirWhatsApp(lead.telefono, mensajeCaliente(lead, profile?.full_name)); setHoja('resultado') } },
    { Icono: Phone, texto: 'Llamar', off: !lead.telefono, onClick: () => { window.location.href = `tel:${String(lead.telefono).replace(/[^\d+]/g, '')}` } },
    { Icono: ClipboardCheck, texto: 'Resultado', off: cerrado, onClick: () => setHoja('resultado') },
    { Icono: BadgeCheck, texto: 'Vendido', clase: 'verde', off: lead.estado === 'venta_cerrada', onClick: () => setHoja('venta') },
    { Icono: MoreHorizontal, texto: 'Más', onClick: () => setHoja('mas') },
  ]

  return (
    <Pantalla titulo={lead.nombre || 'Sin nombre'} atras sinTituloGrande className={`mv-pantalla-lead ${pestana === 'chat' ? 'en-chat' : ''}`}>
      <div className="mv-ficha">
        <Avatar nombre={lead.nombre} tam={64} />
        <h2>{lead.nombre || 'Sin nombre'}</h2>
        <div className="mv-ficha-pastillas">
          <Pastilla tono={TONO_ESTADO[lead.estado]}>{LEAD_STATUS_LABELS[lead.estado]}</Pastilla>
          <Pastilla tono={pago.tono}>{pago.texto}</Pastilla>
        </div>
        <div className="mv-acciones-redondas">
          {acciones.map(({ Icono, texto, clase, off, onClick }) => (
            <button key={texto} className={clase || ''} disabled={off} onClick={onClick}>
              <span><Icono size={20} /></span>{texto}
            </button>
          ))}
        </div>
        <Segmentos opciones={[{ valor: 'chat', texto: 'Chat' }, { valor: 'datos', texto: 'Datos' }]} valor={pestana} onCambio={setVista} />
      </div>

      {pestana === 'chat' ? (
        <Conversacion lead={lead} eventos={eventos} />
      ) : (
        <div className="mv-datos">
          <Seccion titulo="Qué quiere">
            <Fila titulo="Moto" der={lead.modelo_interes || '—'} />
            <Fila titulo="Forma de pago" der={pago.texto} />
            {formatoPlata(lead.anticipo) && <Fila titulo="Anticipo" der={formatoPlata(lead.anticipo)} />}
            {lead.usada_detalle && <Fila titulo="Entrega usada" sub={lead.usada_detalle} />}
            <Fila titulo="Crédito con DNI" der={<Pastilla tono={dni.tono}>{dni.texto}</Pastilla>} />
          </Seccion>
          <Seccion titulo="Contacto">
            <Fila titulo="Teléfono" der={lead.telefono || '—'} onClick={lead.telefono ? () => { window.location.href = `tel:${String(lead.telefono).replace(/[^\d+]/g, '')}` } : undefined} />
            {lead.email && <Fila titulo="Email" der={lead.email} />}
            <Fila titulo="Vino por" der={LEAD_ORIGEN_LABELS[lead.origen] || '—'} />
            <Fila titulo="Vendedor" der={lead.vendedor?.full_name || 'Sin asignar'} />
          </Seccion>
          <Seccion titulo="Seguimiento">
            <Fila titulo="Entró" der={fechaLarga(lead.created_at)} />
            <Fila titulo="Último contacto" der={fechaLarga(lead.ultimo_contacto_at)} />
            <Fila titulo="Próximo contacto" der={fechaLarga(lead.proximo_contacto_at)} />
            {lead.fecha_agenda && <Fila titulo="Visita" der={fechaLarga(lead.fecha_agenda)} />}
            {lead.contacto_intentos > 0 && <Fila titulo="Intentos" der={lead.contacto_intentos} />}
          </Seccion>
          {lead.notas && (
            <Seccion titulo="Notas">
              <div className="mv-notas">{lead.notas}</div>
            </Seccion>
          )}
        </div>
      )}

      <HojaResultado lead={lead} abierta={hoja === 'resultado'} onCerrar={() => setHoja(null)} onGuardado={(c) => setLead({ ...lead, ...c })} />
      <HojaVenta lead={lead} abierta={hoja === 'venta'} onCerrar={() => setHoja(null)} onGuardada={cargar} />
      <MenuAcciones
        abierto={hoja === 'mas'}
        onCerrar={() => setHoja(null)}
        titulo={lead.nombre}
        acciones={[
          { texto: 'Cambiar estado', onClick: () => setTimeout(() => setHoja('estado'), 50) },
          lead.telefono && { texto: 'Copiar teléfono', onClick: () => navigator.clipboard?.writeText(lead.telefono).then(() => addToast('Teléfono copiado', 'success')) },
          !cerrado && { texto: 'Marcar como perdido', destructiva: true, onClick: () => setTimeout(() => setHoja('resultado'), 50) },
        ]}
      />
      <MenuAcciones
        abierto={hoja === 'estado'}
        onCerrar={() => setHoja(null)}
        titulo="Cambiar estado"
        acciones={Object.entries(LEAD_STATUS_LABELS).filter(([k]) => k !== lead.estado && k !== 'venta_cerrada').map(([k, v]) => ({ texto: v, onClick: () => cambiarEstado(k) }))}
      />
    </Pantalla>
  )
}
