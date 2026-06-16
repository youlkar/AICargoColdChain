import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL || 'http://localhost:8000'
  const wsBackend = backendUrl.replace(/^http/, 'ws')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': backendUrl,
        '/ws/events': { target: wsBackend, ws: true },
        '/ws/stream': { target: wsBackend, ws: true },
      },
    },
  }
})
