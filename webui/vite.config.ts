import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Inference server to proxy to (override with VITE_PROXY_TARGET if the server
// runs on a non-default port). Routing /api + /ws through the dev server means
// only port 5173 needs to be reachable (one SSH tunnel) for the live demo.
const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws':  { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
})
