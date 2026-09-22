# CHANGELOG - MotoBox CRM v3.0

## [3.0.0] - Rediseño neomórfico + Centro de Integraciones

> ⚠️ **Sobre la base de datos:** esta versión **no modifica ningún dato ni ninguna tabla
> existente**. Los leads, ventas, clientes, inventario y usuarios quedan exactamente como
> estaban. La única migración nueva (`004_integraciones.sql`) es **opcional y aditiva**:
> crea una sola tabla nueva y el CRM funciona igual si no se ejecuta.

---

### 🎨 Diseño — Neomorfismo (Soft UI)

- **Nueva capa visual** (`src/styles/neumorphism.css`) que reescribe superficies, sombras y
  colores sin tocar la estructura ni los nombres de clase existentes. Es reversible: si se
  quita el archivo, el CRM vuelve al diseño anterior.
- **Superficies extruidas**: tarjetas, KPIs, botones y tarjetas de kanban con sombra doble
  y estados `hover` / `pressed` reales.
- **Campos hundidos**: inputs, selects y buscadores con sombra interior; foco con halo azul.
- **Modo claro / oscuro / automático**, con selector en la barra superior y en *Mi Perfil*.
  La preferencia se guarda en el navegador (`localStorage`), nunca en la base.
- **Sin parpadeo al cargar**: el tema se aplica antes de que React monte.
- **Densidad configurable** (cómoda / compacta).
- **Gráficos sincronizados con el tema** (grilla, ejes y tooltips de Recharts).

---

### ⚡ Funcionalidad

- **Buscador global (`Ctrl/Cmd + K`)**: leads por nombre, teléfono, email o modelo; motos
  del inventario; y salto a cualquier sección. Navegación con flechas y Enter.
- **Kanban con arrastrar y soltar**: mover una tarjeta cambia el estado del lead, lo
  registra en el historial y dispara el evento. Si la base rechaza el cambio, vuelve atrás.
- **Detección de leads duplicados** por teléfono, con enlace a la ficha existente.
- **Filtros y orden en Leads**: "Sin asignar"; orden por recientes, antiguos, presupuesto,
  próxima cita o nombre. La búsqueda ahora incluye el email.
- **Plantillas de WhatsApp configurables** con variables `{nombre}`, `{modelo}`,
  `{vendedor}`, `{presupuesto}`, `{empresa}`.
- **Agenda conectada al calendario**: "Agregar a Google Calendar" en cada cita y descarga
  `.ics` (semana o completa) con recordatorio 30 minutos antes.
- **Exportaciones mejoradas**: CSV con BOM UTF-8 y separador `;` para Excel en español.
  Exportación de ventas desde su propia pantalla.

---

### 🔌 Centro de Integraciones (`/integraciones`, sólo admin)

- **Webhooks salientes** (Zapier, Make, n8n o endpoint propio) con selección de eventos,
  botón de prueba y registro de envíos.
- **Telegram**, **Slack** y **Discord**.
- **Eventos**: lead creado, lead editado, cambio de estado, lead asignado, interacción
  registrada, venta cerrada, moto publicada en la web.
- **Exportación**: leads / ventas / inventario a Excel-CSV, copiar para Google Sheets,
  contactos `.vcf`, agenda `.ics`, backup JSON.
- **Captación web**: código del formulario listo para pegar en el sitio público.

**Dónde se guarda la configuración:** en `localStorage` por defecto. Con la migración
opcional `004_integraciones.sql` se comparte con todo el equipo.

---

### 🐛 Correcciones

- **Ventas**: al registrar una venta se marcaba la moto como `'vendida'`, valor que no existe
  en el enum `inventario_estado` (es `'vendido'`). El update fallaba en silencio y la moto
  quedaba disponible. Ahora usa el valor correcto y avisa si falla.
- **Leads**: el canal de tiempo real ahora siempre usa la versión actual de la función de
  recarga (antes dependía de los valores del primer render).
- **Historial de cambios**: si el registro en `historial_cambios` falla, ahora se informa en
  consola en lugar de ignorarse en silencio.
- **Modo oscuro**: colores fijos (`#18181B`, `#fff`) reemplazados por tokens del tema.
- **Integraciones**: lecturas y escrituras con tiempo límite para no colgar la pantalla.
