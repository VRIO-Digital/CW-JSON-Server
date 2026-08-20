# Deploying to Elastic Beanstalk

**Backend on Elastic Beanstalk, frontend on S3 + CloudFront.** EB runs a Node process, which is what
the backend is; the console is static files, which S3 serves better and far cheaper than an EB
environment. The code already supports this split — `VITE_API_BASE` names the API's origin at build
time, and the server sends `access-control-allow-origin: *` on every response including the `OPTIONS`
preflight.

---

## 1. The backend

### Once, per environment

```bash
cd backend

eb init --platform "Node.js 22 running on 64bit Amazon Linux 2023" --region us-east-1
eb create contextweave-api --single          # --single: no load balancer, one instance
```

**`--single` is not a cost decision.** It is the same requirement `ecosystem.config.js` records for PM2:
every writer hands `commitDb` the whole document and the write chain is per process, and the live state —
registered sources, profiling jobs, studio decisions, publications — never reaches storage. Two instances
mean silent lost writes and a publish that takes effect for one request in two.

**And the enforcement is the environment type, not a config file.** `.ebextensions/01-app.config`
deliberately sets only `Application Healthcheck URL` and the environment properties. It used to pin
`aws:autoscaling:asg` `MaxSize: 1` and set `HealthCheckPath` under
`aws:elasticbeanstalk:environment:process:default` — both **load-balancer namespaces**, which a
single-instance environment rejects. The deploy then fails with *"Your source bundle has issues that
caused the deployment to fail"*, which names the bundle and says nothing about the setting; the zip is
fine and you lose an hour on it. A single-instance environment has no Auto Scaling group to pin, which is
what the Elastic IP in the create log is telling you.

### The credentials, which are not in the repo

```bash
eb setenv AWS_ACCESS_KEY_ID=AKIA... AWS_SECRET_ACCESS_KEY=... 
```

`S3_BUCKET`, `AWS_REGION` and `NODE_ENV` are already set by `.ebextensions`. The two secrets are
deliberately not, so they live in the environment's configuration rather than in a tracked file.

**`.ebignore` is what keeps them out of the bundle, and it needs saying:** the moment that file exists
the EB CLI stops reading `.gitignore`, so every rule that protected a secret had to be restated. Its
first two lines are `.env.local` and `.env.local.backup` for exactly that reason.

### If you upload a zip instead of using the CLI

Three things go wrong with a hand-made bundle, and two of them are silent:

- **The app files must be at the archive root.** Zipping the *folder* gives `backend/server.js` inside the
  zip, EB sees one directory, and you get *"failed to generate a 'Procfile'... Provide one of these files:
  'package.json', 'server.js', or 'app.js'"*.
- **`.ebignore` does not apply.** It is read by the `eb` CLI only, so a manual zip will happily include
  `backend/.env.local` — the AWS credentials — and upload them to the environment's S3 bucket. This has
  happened once.
- **`Compress-Archive` writes backslash separators.** EB then does not recognise `.ebextensions\…` and
  silently ignores the whole directory, so you get an environment with none of your configuration and no
  error saying so.

`npm run bundle:eb` builds one correctly and asserts all three before writing it.

### Deploy

```bash
eb deploy
eb open           # or: curl https://<env>.elasticbeanstalk.com/health
```

`/health` answers `{ ok, datasets, store, port, uptime_s }`. It exists because EB's default check hits
`/`, which the dispatcher 404s with a "this server may be stale" message — read by a load balancer as a
failing application, so the environment goes red while every endpoint is fine.

**`store` in that reply is the line to read after a deploy.** `"s3"` means it is reading the bucket;
`"file"` means `S3_BUCKET` did not reach the process and it is serving the copy frozen into the bundle
at deploy time. Both work; only one is current.

---

## 2. The frontend

Build against the API's real origin, then sync:

```bash
cd frontend
echo 'VITE_API_BASE=https://<env>.elasticbeanstalk.com' > .env.production
npm ci
npm run build

aws s3 sync dist/ s3://<your-web-bucket>/ --delete
aws cloudfront create-invalidation --distribution-id <id> --paths '/*'
```

**`VITE_*` values are inlined at build time**, so changing the API origin is a rebuild, not a restart —
and none of them can ever hold a secret.

**CloudFront needs the SPA fallback.** Every in-app route (`/E/reports`, `/C/ask`) is client-side, so a
direct hit on one must return `index.html`: add a custom error response mapping **403 and 404 → 200
`/index.html`**. Without it a refresh anywhere other than `/` gives an S3 error page.

### The one thing that will bite you

EB gives you `http://`. A CloudFront site is `https://`, and **an https page cannot call an http API** —
the browser blocks it as mixed content, with no server-side symptom at all. Either put a certificate on
the EB environment (ALB + ACM, which means dropping `--single`… see the single-instance note, so prefer a
CloudFront behaviour that proxies `/api/*` to the EB origin instead), or serve the console over http too
while demoing.

Routing `/api/*` through CloudFront to the EB origin is the tidier answer: one https origin, no CORS at
all, and `VITE_API_BASE=/api`.

---

## What is not deployed

`backend/scripts/` is excluded from the bundle. The seeds and ingests author documents from a demo
package that is not on the instance; they are development tools. The flow stays: re-seed locally, check
the diff, `npm run db:push`, and the instance picks the new document up on its next boot.
