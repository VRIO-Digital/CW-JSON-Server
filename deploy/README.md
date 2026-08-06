# Running it in Docker

Two images, because the app is two processes. `npm run dev` alone renders empty
pages — there is no static fallback data anywhere in `src/` — and the same is
true in a container.

| Image | From | Serves |
|---|---|---|
| `contextweave-mock` | `deploy/Dockerfile.mock` | the JSON API on `:4000` |
| `contextweave-web` | `deploy/Dockerfile.web` | the built SPA on `:80`, proxying `/api` to the mock |

## Both at once

```bash
docker compose up --build       # → http://localhost:8080
docker compose down
```

The mock's API is also published on `localhost:4000`, so it can be curled
directly:

```bash
curl http://localhost:4000/health
```

## Separately

```bash
docker build -f deploy/Dockerfile.mock -t contextweave-mock .
docker run --init -p 4000:4000 contextweave-mock

docker build -f deploy/Dockerfile.web -t contextweave-web .
docker run -p 8080:80 -e MOCK_ORIGIN=http://host.docker.internal:4000 contextweave-web
```

`MOCK_ORIGIN` is read at container start, not baked in — pointing the front end
at a different API is a restart, not a rebuild. Only `MOCK_*` variables are
substituted into the nginx config, so nginx's own `$uri` and `$host` survive.

`MOCK_ORIGIN` and `VITE_API_BASE` are not two names for the same thing, and
mixing them up produces a front end that calls the wrong host with no error to
read:

- **`MOCK_ORIGIN`** is where a *proxy* forwards to — nginx here, the Vite dev
  server locally. Runtime, so a restart picks it up.
- **`VITE_API_BASE`** is what the *browser* asks for. Inlined at build time, so
  it takes a rebuild.

This image wants `VITE_API_BASE=/api`, because nginx is doing the stripping. But
`npm run build` loads `.env.production`, which sets an absolute origin — for the
other case, where the built SPA is served with no proxy in front of it and has
to reach the API across origins itself. **Build the web image without overriding
that and the bundle bypasses nginx entirely**, calling the absolute host from
the browser while `MOCK_ORIGIN` sits there doing nothing.

A variable already in the environment wins over the `.env` file, so the
Dockerfile's build step is where to say so:

```dockerfile
RUN VITE_API_BASE=/api npm run build
```

Verified, not assumed: that build produces a bundle with no absolute origin in
it, while a plain `npm run build` produces one that has it.

## Things worth knowing before debugging

- **`/api` is stripped by the trailing slash on `proxy_pass`**, mirroring the
  rewrite in `vite.config.ts`. `BASE = '/api'` in `client.ts` therefore resolves
  to the same real endpoint names in a container as it does in development.
- **Unmatched paths serve `index.html`.** `/ask` and `/graph-studio/:useCaseId`
  are client routes with no file behind them; without the fallback a page
  refresh would 404.
- **State resets when the mock container restarts** — registered sources and
  profiling jobs live in memory by design, exactly as they do locally. Saved
  graph use cases are written to `db.json`, which in a container means the
  container. To keep them, uncomment the volume in `docker-compose.yml` and
  mount the **directory**, never the single file: `commitDb` writes
  `db.json.tmp` beside it and renames, which a single-file bind mount cannot
  survive.
- **The mock image installs nothing.** That folder has zero dependencies on
  purpose, so there is no `npm ci` in it and no audit gate to satisfy.
- **`npm ci` in the web build runs the audit gate** through `postinstall`. It
  warns and exits 0 when the registry is unreachable, so an offline build still
  succeeds.
- **Run the mock with `--init`.** Node as PID 1 installs no default `SIGTERM`
  handler, so without an init process `docker stop` waits out the full grace
  period. Compose sets `init: true` for you.
