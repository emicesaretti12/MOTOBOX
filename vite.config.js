import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // App instalable en el celular (Android y iPhone): ícono en la pantalla de inicio, pantalla completa
    // y arranque rápido. Los datos siempre se piden en vivo a Supabase: solo se guarda la app en sí.
    VitePWA({
      // La actualización la maneja src/actualizarApp.js: recarga sola apenas no interrumpe (ver ahí).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon-64.png'],
      manifest: {
        name: 'MotoBox CRM',
        short_name: 'MotoBox',
        description: 'Leads, conversaciones y ventas de MotoBox',
        lang: 'es-AR',
        start_url: '/hoy',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0a0a0a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Para vender hoy', url: '/hoy', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Agente en vivo', url: '/agente', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        importScripts: ['/sw-extra.js'],
      },
    }),
  ],
  server: {
    port: 5173,
    open: true
  },
  build: {
    // Optimizaciones de build
    minify: 'terser',
    sourcemap: false, // Desabilitar en producción por seguridad
    terserOptions: {
      compress: {
        drop_console: true, // Remover console.log en producción
        drop_debugger: true
      }
    },
    // Code splitting para reducir tamaño de bundle
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-charts': ['recharts'],
          'vendor-icons': ['lucide-react']
        }
      }
    },
    // Aumentar límite de warning de chunk
    chunkSizeWarningLimit: 600,
    // Reportar tamaño de bundle
    reportCompressedSize: true
  },
  // Optimizaciones de dependencias
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@supabase/supabase-js',
      'recharts',
      'lucide-react'
    ]
  }
})
