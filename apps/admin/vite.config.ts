import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_SHA__: JSON.stringify((process.env.GIT_SHA || 'dev').slice(0, 7)),
  },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: {
    rollupOptions: {
      output: { manualChunks: { charts: ['recharts'], react: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
})
