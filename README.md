# MotoBox CRM - Sistema de Gestión de Leads

Sistema CRM completo para concesionarios de motos, desarrollado con React + Vite y Supabase.

## 🏍️ Características

- **Dashboard** con métricas en tiempo real (leads totales, ventas cerradas, tasa de conversión)
- **Gestión de Leads** con filtros por estado, origen, vendedor y búsqueda por nombre/teléfono
- **Detalle del Lead** con historial de interacciones cronológico (timeline)
- **Registro rápido de interacciones** (llamada, WhatsApp, email, visita)
- **Panel de Administración de Usuarios** (solo admin) con creación y reseteo de contraseñas
- **Autenticación por DNI** (sin emails visibles al usuario)
- **Control de acceso por rol** (admin vs. empleado)
- **UI neomórfica (Soft UI)** con modo claro/oscuro/automático y densidad configurable
- **Buscador global** (`Ctrl/Cmd + K`) sobre leads, motos y secciones
- **Kanban con arrastrar y soltar** para cambiar el estado de un lead
- **Detección de leads duplicados** por teléfono al cargar uno nuevo
- **Centro de Integraciones**: webhooks (Zapier / Make / n8n), Telegram, Slack, Discord,
  plantillas de WhatsApp, exportación a Excel/Google Sheets, contactos `.vcf`,
  agenda `.ics` para Google Calendar y formulario de captación para la web pública

## 🚀 Setup

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd motobox-crm
npm install
```

### 2. Configurar Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com)
2. Ejecutá los archivos SQL en el SQL Editor de Supabase, en orden:
   - `supabase/migrations/001_initial_setup.sql`
   - `supabase/migrations/002_database_optimizations.sql`
   - `supabase/migrations/003_new_modules_schema.sql`
   - `supabase/migrations/004_integraciones.sql` *(opcional — ver abajo)*
3. Desplegá las Edge Functions:
   - `supabase/functions/create-user/index.ts`
   - `supabase/functions/reset-password/index.ts`

### 3. Variables de entorno

Copiá `.env.example` a `.env` y completá los valores:

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

### 4. Crear usuario admin inicial

Desde el SQL Editor de Supabase, ejecutá:

```sql
-- Primero, creá el usuario auth (reemplazá los valores)
SELECT supabase.auth.admin_create_user(
  '{"email": "TU_DNI@motobox-internal.local", "password": "tu_password", "email_confirm": true, "user_metadata": {"dni": "TU_DNI", "full_name": "Tu Nombre", "role": "admin"}}'
);
```

O usá el dashboard de Supabase > Authentication > Users > Add user:
- Email: `TU_DNI@motobox-internal.local`
- Password: tu contraseña
- Confirmá el email

Luego verificá que el trigger haya creado el perfil en la tabla `profiles`.

### 5. Ejecutar en desarrollo

```bash
npm run dev
```

### 6. Deploy en Vercel

```bash
npm run build
# Conectá el repo a Vercel y configurá las variables de entorno
```

## 📁 Estructura del Proyecto

```
src/
├── components/
│   ├── Layout.jsx            # Layout principal con sidebar
│   ├── CommandPalette.jsx    # Buscador global (Ctrl/Cmd + K)
│   └── ThemeToggle.jsx       # Selector claro / oscuro / automático
├── contexts/
│   ├── AuthContext.jsx       # Contexto de autenticación (DNI login)
│   ├── ThemeContext.jsx      # Tema y densidad (localStorage)
│   └── ToastContext.jsx      # Notificaciones toast
├── lib/
│   ├── supabase.js           # Cliente Supabase
│   ├── integrations.js       # Event bus + conectores externos
│   ├── exporters.js          # CSV/Excel, vCard, ICS, WhatsApp, snippets
│   ├── constants.js          # Constantes del dominio
│   └── utils.js              # Utilidades compartidas
├── pages/
│   ├── DashboardPage.jsx     # Dashboard con métricas y gráficos
│   ├── LeadsPage.jsx         # Listado, kanban arrastrable y gestión de leads
│   ├── LeadDetailPage.jsx    # Detalle + historial de interacciones
│   ├── AgendaPage.jsx        # Agenda semanal + exportación a calendario
│   ├── InventoryPage.jsx     # Inventario de motos
│   ├── SalesPage.jsx         # Ventas
│   ├── ClientsPage.jsx       # Clientes
│   ├── IntegrationsPage.jsx  # Centro de Integraciones (admin)
│   ├── WebSettingsPage.jsx   # Configuración de la web pública (admin)
│   ├── LoginPage.jsx         # Login por DNI
│   └── UsersPage.jsx         # Gestión de usuarios (admin)
├── styles/
│   ├── neumorphism.css       # Capa neomórfica (temas claro/oscuro)
│   └── enhancements.css      # Estilos de los componentes nuevos
├── App.jsx                   # Routing y guards
├── index.css                 # Estilos base
└── main.jsx                  # Entry point
```

## 🔌 Centro de Integraciones

Panel de administración (`/integraciones`) para conectar el CRM con otras herramientas.
Todo se dispara desde el navegador: **no requiere servidor ni backend adicional**.

| Integración | Qué hace |
|-------------|----------|
| **Webhooks** | Envía un POST JSON a Zapier, Make, n8n o tu sistema cada vez que se crea/edita un lead, cambia de estado, se registra una interacción o se cierra una venta. Desde ahí llegás a Google Sheets, Gmail, Notion, Trello, ERP, etc. |
| **Telegram** | Avisos instantáneos al celular vía bot (`@BotFather`). |
| **Slack / Discord** | Avisos en el canal del equipo vía Incoming Webhook. |
| **WhatsApp** | Plantillas de mensajes con variables (`{nombre}`, `{modelo}`, `{vendedor}`, `{presupuesto}`) que aparecen en la ficha de cada lead. |
| **Calendario** | Exportación `.ics` de la agenda (con recordatorio 30 min antes) y enlace directo "Agregar a Google Calendar" en cada cita. |
| **Exportación** | Leads, ventas e inventario a CSV compatible con Excel; copiar al portapapeles para Google Sheets; contactos `.vcf` para el celular; copia de seguridad JSON. |
| **Captación web** | Genera el código del formulario para pegar en la web pública: los leads entran directo al CRM. |

### Dónde se guarda la configuración

Por defecto queda en el **navegador de cada usuario** (`localStorage`).
Para que **todo el equipo comparta las mismas conexiones**, ejecutá la migración opcional
`supabase/migrations/004_integraciones.sql`.

> Esa migración es **aditiva**: crea una sola tabla nueva (`crm_integraciones`) y
> **no modifica ni borra** `leads`, `profiles`, `interacciones`, `historial_cambios`,
> `ventas`, `clientes`, `inventario_motos` ni `configuracion_web`.
> Si no la ejecutás, el CRM funciona igual.

## ⌨️ Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `Ctrl + K` / `⌘ + K` | Abrir el buscador global |
| `↑` `↓` | Navegar resultados |
| `Enter` | Abrir el resultado seleccionado |
| `Esc` | Cerrar |

## 🔐 Roles

| Rol       | Acceso                                              |
|-----------|-----------------------------------------------------|
| Admin     | Dashboard completo, todos los leads, gestión de usuarios |
| Empleado  | Dashboard propio, solo sus leads asignados            |

## 🛠️ Stack

- **Frontend**: React 18 + Vite
- **Base de datos**: Supabase (PostgreSQL)
- **Autenticación**: Supabase Auth (DNI → email interno)
- **Gráficos**: Recharts
- **Íconos**: Lucide React
- **Deploy**: Vercel
