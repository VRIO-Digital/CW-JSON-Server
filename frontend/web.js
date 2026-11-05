/*
 * Serves the built SPA, and nothing else.
 *
 *     node web.js            ->  serves ./dist on PORT (8080 by default)
 *     npm run bundle:web     ->  frontend-eb.zip, this file plus ./dist
 *
 * **Why this exists at all.** `npm run build` produces static files, and static files are not an
 * application: Elastic Beanstalk's Node platform looks for `package.json`, `server.js` or `app.js` at
 * the archive root to generate a Procfile from, and past that it waits for something to listen on
 * `PORT`. A zip of `dist/` satisfies neither — the deploy sits until the command times out
 * (`Successful: 0, TimedOut: 1`), which reads as a broken environment rather than as a bundle with no
 * process in it. That is a real deploy this repo lost, on 2026-08-24.
 *
 * **Zero dependencies, like `backend/server.js`.** A static file server is `node:http` plus a MIME
 * table; `express` + `serve-static` is a dependency tree through a gate that fails on any advisory at
 * `low`, and the frontend's `package.json` is where every runtime dependency in this repo already
 * lives. It is also why the bundle ships a *generated* `package.json` with no dependencies at all: an
 * instance serving static files must not `npm install` react, antd and d3 to do it.
 *
 * **The zip's layout is deliberately the checkout's layout** — `web.js` beside `dist/` — so
 * `node web.js` locally runs exactly what the instance runs. A bundle whose paths differ from the
 * working tree is a bundle you cannot test before uploading.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants as zlibConstants, createBrotliCompress, createGzip } from 'node:zlib'

/** Where the built SPA is, relative to this file — the same place in the zip and in the checkout. */
const ROOT = resolve(fileURLToPath(new URL('./dist', import.meta.url)))
const INDEX = join(ROOT, 'index.html')

/**
 * `PORT` first, and that is not a preference.
 *
 * EB sets it to 8080 and proxies `:80` to it with nginx. A server that picks its own port makes every
 * health check fail while the application is perfectly healthy — the same reason `backend/server.js`
 * reads it. An explicit argument still wins, because a typed number beats an inherited environment.
 */
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080)

/*
 * One entry per extension the build actually emits, plus the fonts a document may pull.
 *
 * **An unknown type is `application/octet-stream`, never a guess.** A wrong content type on a script
 * is a file the browser refuses to execute with no server-side symptom, which is the same class of
 * failure as `ConnectorIcon` falling back to another vendor's logo: a default may be plainer than the
 * real thing, it must not assert something false.
 */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Vite's `assets/` filenames carry a content hash, so they may be cached forever; nothing else may.
 *
 * `index.html` names those hashed files, so caching *it* is how a deploy becomes invisible — the
 * browser keeps asking for the previous build's bundle, which is still on disk under its old name, and
 * the new version simply never appears. There is no error to read, which is why the two rules are
 * written down here rather than left to a default.
 */
const immutable = (rel) => rel.startsWith(`assets${sep}`) || rel.startsWith('assets/')

/** Files, not directories — `statSync` on a directory succeeds and would stream a folder. */
const isFile = (path) => existsSync(path) && statSync(path).isFile()

/**
 * Extensions worth compressing — text, which gzip/brotli typically shrink by 70-90%. Everything else
 * here (images, fonts) is already a dense binary format, so compressing it again spends CPU for little
 * or no gain and is skipped.
 *
 * **Why this exists at all.** Some of the documents this SPA frames (the Goals/Submission journeys,
 * the vendored report prototypes) are single HTML files several megabytes each, and this server sent
 * every byte of them uncompressed — `content-length` on the wire was the file's raw size. Over a slow
 * or cross-region link that is several seconds of transfer for every cold load, with nothing wrong
 * server-side and nothing on screen explaining it. Every browser that loads a web page advertises
 * `accept-encoding: gzip` at minimum, so this is close to free.
 */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.webmanifest'])

export function handle(req, res) {
  /* GET and HEAD only. This process serves files and holds no state, so any other method is a caller
     mistake worth naming rather than a 404 that reads as a missing page. */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
    return res.end(`${req.method} is not allowed here — this server only serves files.\n`)
  }

  /* Parsed rather than string-sliced, so a query string or a fragment cannot become part of a
     filename. The base is a placeholder: only the path is read from it. */
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('That URL cannot be decoded.\n')
  }

  /*
   * Liveness, for whatever is in front of this process.
   *
   * EB's default health check hits `/`, which a static site answers with `index.html` — so this is not
   * strictly required. It exists because a 200 with a page in it says the *file* is there, and this
   * says which build is being served and out of which directory: "healthy, serving the wrong dist" is
   * a state a page cannot express. It is not an app route, so the SPA fallback below can never shadow
   * it.
   */
  if (pathname === '/health') {
    const ready = isFile(INDEX)
    const body = JSON.stringify({
      ok: ready,
      root: ROOT,
      port: PORT,
      uptime_s: Math.round(process.uptime()),
    })
    res.writeHead(ready ? 200 : 503, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    return res.end(req.method === 'HEAD' ? undefined : `${body}\n`)
  }

  /*
   * The one security rule here: a request may not escape `dist`.
   *
   * `resolve` collapses `..` before this check, so the comparison is on the real path rather than on
   * the text of the URL — a deny-list of `..` and its encodings is the version of this that misses one.
   * `${ROOT}${sep}` and not `ROOT`, or a sibling directory whose name merely starts with "dist" would
   * pass.
   */
  const target = resolve(join(ROOT, pathname))
  if (target !== ROOT && !target.startsWith(`${ROOT}${sep}`)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('That path is outside the site.\n')
  }

  const file = pathname === '/' ? INDEX : target

  if (isFile(file)) return sendFile(req, res, file)

  /*
   * **The SPA fallback, and the case it deliberately excludes.**
   *
   * Every in-app route is client-side (`/E/reports`, `/doctor`), so a direct hit or a refresh on one
   * must return `index.html` and let the router take it from there. But a path that *names a file* —
   * anything with an extension — must 404 instead: answering a missing `assets/index-abc123.js` with
   * HTML gives the browser a script that is a web page, and the console fails with a syntax error
   * pointing at the first `<`. That is a stale `index.html` or a half-synced deploy, and the 404 says
   * so where the fallback would hide it.
   */
  if (extname(pathname) === '') return sendFile(req, res, INDEX)

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  return res.end(`Not found: ${pathname}\n`)
}

function sendFile(req, res, file) {
  const rel = file.slice(ROOT.length + 1)
  const ext = extname(file).toLowerCase()
  const size = statSync(file).size
  const headers = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': immutable(rel)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache, must-revalidate',
    'x-content-type-options': 'nosniff',
  }

  /*
   * Compressed only when there is a body to compress (never HEAD), the type is text, and the request
   * says it can decode the result — brotli preferred over gzip where both are offered, since it
   * compresses text further for a similar decode cost on every browser in use today.
   */
  const acceptEncoding = req.method === 'HEAD' ? '' : String(req.headers['accept-encoding'] ?? '')
  const compressible = COMPRESSIBLE.has(ext)
  const useBrotli = compressible && /\bbr\b/.test(acceptEncoding)
  const useGzip = compressible && !useBrotli && /\bgzip\b/.test(acceptEncoding)

  if (useBrotli || useGzip) {
    /*
     * No `content-length`: the compressed size is not known ahead of streaming it, and Node falls back
     * to chunked transfer encoding on its own when the header is absent. `vary` tells any cache sitting
     * in front of this that the reply differs by that request header, so a cache can never hand a
     * compressed body to a client that said it cannot unpack one.
     */
    headers['content-encoding'] = useBrotli ? 'br' : 'gzip'
    headers.vary = 'accept-encoding'
    res.writeHead(200, headers)
    /*
     * Brotli's own default quality (11) is tuned for serving the same bytes many times over, and on a
     * multi-megabyte document that is seconds of CPU spent *per request* — trading a slow transfer for
     * a slow compressor. Quality 5 is fast and still shrinks repetitive markup and script text well
     * past what gzip alone reaches.
     */
    const compressor = useBrotli
      ? createBrotliCompress({
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: size,
          },
        })
      : createGzip()
    return createReadStream(file).pipe(compressor).pipe(res)
  }

  headers['content-length'] = size
  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  return createReadStream(file).pipe(res)
}

/** The server, exported unstarted so a verifier can drive it on an ephemeral port. */
export const server = createServer(handle)

/*
 * Started only when this file is what was run.
 *
 * A module that listened on import would bind a port during a build step — which on Windows is
 * exactly how a wedged port outlives the process that opened it.
 */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (!isFile(INDEX)) {
    console.error(`web: ${INDEX} is missing — run "npm run build" first.`)
    process.exit(1)
  }
  server.listen(PORT, () => {
    console.log(`web: serving ${ROOT} on http://localhost:${PORT}`)
    console.log('web: health at /health · client routes fall back to index.html')
  })
  /* EB sends SIGTERM on deploy and scale-in. With a Procfile the platform runs node directly, so the
     signal reaches this process rather than an npm wrapper — which is the whole reason the Procfile
     exists, and it is wasted if nothing here closes the server. */
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)))
  }
}
