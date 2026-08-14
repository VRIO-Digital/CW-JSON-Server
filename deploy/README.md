# Running it in Docker

## PostgreSQL first

The tenant's data lives in PostgreSQL now, so it is the one process nothing else works
without. `docker-compose.db.yml` runs just that — its own file, because the database is
the only service worth running on its own while developing, and its defaults match
`mock-server/db/pg.mjs`'s defaults exactly so a fresh clone configures nothing.

```bash
docker compose -f deploy/docker-compose.db.yml up -d
npm run db:reset        # create + migrate + seed, from mock-server/db.json
```

Point it somewhere else with `DATABASE_URL`, or per-part with
`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`. **A migration drops the schema and
rebuilds it**, so `db:seed` follows `db:migrate` every time — there is no migration
history because there is nothing to migrate from: the seed is a whole document.

The named volume is what makes a restart different from a re-seed. What survives is what
always survived a `commitDb` — saved graph briefs, saved reports, report audiences.
Registered sources and publications are still in the server's memory and still die with
the process. `docker compose -f deploy/docker-compose.db.yml down -v` drops the volume;
`npm run db:reset` puts the seed back.

## The app

Two images, because the app is two processes on top of the database. `npm run dev` alone
renders empty pages — there is no static fallback data anywhere in `src/` — and the same
is true in a container.

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
  graph use cases and saved reports go through `commitDb` into PostgreSQL, so those
  survive a mock restart and are lost only with the database volume. No bind mount is
  needed for them any more; the mock container holds no state worth keeping.
- **The mock image needs `npm ci`**, because `mock-server/` now has one dependency (`pg`).
  It also needs to reach the database — set `DATABASE_URL` or the `PG*` variables on that
  container, and remember `localhost` inside a container is the container.
- **`npm ci` in the web build runs the audit gate** through `postinstall`. It
  warns and exits 0 when the registry is unreachable, so an offline build still
  succeeds.
- **Run the mock with `--init`.** Node as PID 1 installs no default `SIGTERM`
  handler, so without an init process `docker stop` waits out the full grace
  period. Compose sets `init: true` for you.
