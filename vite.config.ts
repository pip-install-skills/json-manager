import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const base = process.env.VITE_BASE_PATH ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // The app ships as a single chunk, so the preload polyfill has nothing to
    // preload. Dropping it leaves a bundle with no network calls at all, which
    // makes the offline promise something you can verify by grepping dist/.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
