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
- **UI moderna y responsive** con paleta rojo/negro/blanco

## 🚀 Setup

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd motobox-crm
npm install
```

### 2. Configurar Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com)
2. Ejecutá el archivo SQL en el SQL Editor de Supabase: `supabase/migrations/001_initial_setup.sql`
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
│   └── Layout.jsx          # Layout principal con sidebar
├── contexts/
│   ├── AuthContext.jsx      # Contexto de autenticación (DNI login)
│   └── ToastContext.jsx     # Notificaciones toast
├── lib/
│   └── supabase.js          # Cliente Supabase
├── pages/
│   ├── DashboardPage.jsx    # Dashboard con métricas y gráficos
│   ├── LeadsPage.jsx        # Listado y gestión de leads
│   ├── LeadDetailPage.jsx   # Detalle + historial de interacciones
│   ├── LoginPage.jsx        # Login por DNI
│   └── UsersPage.jsx        # Gestión de usuarios (admin)
├── App.jsx                  # Routing y guards
├── index.css                # Estilos globales
└── main.jsx                 # Entry point
```

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
