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
 *     MOCK_ORIGIN=http://18.205.228.143:4000 npm run dev
 *
 * This proxy does not exist in a build. A production bundle reaches the API by
 * whatever VITE_API_BASE in .env.production names, which is why that file
 * carries the deployed origin and this one does not.
 */
const MOCK_ORIGIN = process.env.MOCK_ORIGIN 

/*
 * The hostnames the dev and preview servers will answer to besides localhost.
 *
 * Vite refuses a request whose `Host` header it does not recognise — *"Blocked request. This host is
 * not allowed"* — and that check is not noise: a dev server binds a local port with the project's
 * source and its `/api` proxy behind it, and DNS rebinding is how a page on the open web reaches a
 * port on the machine that opened it. So the answer is to *name* the host it is being served under,
 * never `allowedHosts: true`, which is the same instruction with the protection removed.
 *
 * `cw.vriodigital.com` is where this console is served from behind a proxy. Another host for one run
 * needs no edit here, the way `MOCK_ORIGIN` does not:
 *
 *     DEV_ALLOWED_HOSTS=demo.example.com,staging.example.com npm run dev
 *
 * It applies to `npm run dev` and `npm run preview` alike — the same block reaches both, because
 * being served under a real hostname is exactly when somebody reaches for `preview` and would meet
 * the identical refusal with no line in this file mentioning it.
 *
 * None of this exists in a built bundle: it is a property of the two servers Vite runs, so a
 * production deployment behind nginx or CloudFront is unaffected either way.
 */
const ALLOWED_HOSTS = [
  'cw.vriodigital.com',
  ...(process.env.DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: { allowedHosts: ALLOWED_HOSTS },
  server: {
    allowedHosts: ALLOWED_HOSTS,
    // `npm run mock` serves the dummy API. Requests keep their real paths
    // (/backend/sources/preview, /backend/sources/oauth/start) with only /api
    // stripped — `/backend` is the API's own prefix, appended by client.ts and
    // stripped by the server's dispatcher, so it must survive this rewrite.
    proxy: {
      '/api': {
        target: MOCK_ORIGIN,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
