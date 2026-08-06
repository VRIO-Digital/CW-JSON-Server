import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * The dev proxy's target, and the only place development differs from
 * production about where the API is.
 *
 * Local is the default on purpose: `npm run dev` plus `npm run mock` must work
 * with no environment set up at all. Point it elsewhere for one run without
 * editing this file — the app still calls /api, so nothing else changes:
 *
 *     MOCK_ORIGIN=http://44.203.214.206:4000 npm run dev
 *
 * This proxy does not exist in a build. A production bundle reaches the API by
 * whatever VITE_API_BASE in .env.production names, which is why that file
 * carries the deployed origin and this one does not.
 */
const MOCK_ORIGIN = process.env.MOCK_ORIGIN || 'http://localhost:4000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run mock` serves the dummy API. Requests keep their real paths
    // (/sources/preview, /sources/oauth/start) with only /api stripped.
    proxy: {
      '/api': {
        target: MOCK_ORIGIN,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
