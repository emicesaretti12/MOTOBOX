import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
    // Cada archivo de tests SQL levanta su propio Postgres en memoria: tarda unos segundos.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
