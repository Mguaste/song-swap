import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:5050', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5050', ws: true, changeOrigin: true },
    },
  },
})