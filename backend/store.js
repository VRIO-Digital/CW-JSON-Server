/**
 * Where the two JSON databases actually live — the local filesystem, or an S3 bucket.
 *
 * `server.js` owns what a document *means*: the conflict-marker check, the line-and-column parse
 * error, `validateDb`, the in-memory swap and its rollback. This file owns only how the bytes get
 * in and out, so the storage can change without any of that reasoning being rewritten.
 *
 * **A document is named by a ref, and the ref says where it is.** An absolute path is a file;
 * `s3://bucket/key` is an object. That is the whole dispatch — one string, readable in a log and in
 * `GET /db`'s reply, which is why the handle is a ref rather than a name plus a mode flag. A box
 * with no `S3_BUCKET` set builds file refs and behaves exactly as it always has: **local is the
 * default at every layer**, the same rule `VITE_API_BASE` follows, so a fresh clone needs no AWS.
 *
 * **Zero dependencies, on purpose.** `@aws-sdk/client-s3` is ~40 transitive packages through an
 * audit gate that fails on any advisory at `low`, for two HTTP calls. Node 22 has `fetch` and
 * `node:crypto`, so SigV4 is signed here instead — the "prefer writing ~100 lines to pulling in a
 * package" trade this repo makes everywhere except d3.
 */

import { createHash, createHmac } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

/** The separator SigV4 joins its canonical form with. Named so no editor can reflow it to CRLF. */
const LF = '\n'

const sha256 = (data) => createHash('sha256').update(data, 'utf8').digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest()

/* ---------------- where the documents are ---------------- */

/**
 * The bucket this tenant's documents live in, and the prefix they live under.
 *
 * **Hardcoded, on request, and these three are not secrets.** A bucket name and a key prefix are
 * addresses — they appear in every log line and in `GET /db`'s reply — so committing them costs
 * nothing and saves setting up an environment. The **credentials are a different kind of value**
 * and are not here: they are read from `backend/.env.local`, which `.gitignore` covers via
 * `*.local`. An access key in a tracked file is scraped off GitHub by bots within minutes of a
 * push, and that is not a hypothetical failure mode.
 *
 * Each is still overridable by its environment variable, and `S3_BUCKET=off` forces the local
 * files — which is how the test suite and an offline machine still run.
 */
const DEFAULT_BUCKET = 'contextweave.com'
const DEFAULT_PREFIX = 'EPA'
const DEFAULT_REGION = 'us-east-1'

export const region = () =>
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? DEFAULT_REGION

/** `s3://bucket/key` to `{ bucket, key }`, or `null` for anything else (which is a path). */
export function parseS3Ref(ref) {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(ref)
  return m ? { bucket: m[1], key: m[2] } : null
}

/**
 * The ref for one document a **server** reads.
 *
 * **The local file is the default, and `S3_BUCKET` is what asks for the bucket.** This was the other
 * way round: S3 was the default because the local documents had been deleted once the bucket held
 * them, so there was no file to fall back to and a silent fallback would have served an empty app
 * rather than saying why. **That premise expired on 2026-08-19**, when the JSON documents were
 * committed — the repo is how they reach a box with no bucket credentials, so every checkout now has
 * a complete, valid `db.json` sitting beside this file. With a real document there, defaulting to a
 * bucket means a fresh clone cannot start without AWS credentials it does not need, which is exactly
 * the failure this flip removes: `node backend/server.js` reads `backend/db.json`.
 *
 * **What the flip costs, stated rather than glossed.** The fallback is no longer empty, so the old
 * hazard is gone; the new one is *staleness* — a box that means to read the bucket and does not set
 * `S3_BUCKET` will quietly serve the committed copy instead, which is a real document with real
 * figures that may be months behind. Two things hold that: the deployed process sets `S3_BUCKET`
 * explicitly in `ecosystem.config.js` rather than relying on any default, and the boot banner names
 * the store and the ref it actually read on every start. A wrong-but-plausible document is only
 * dangerous while nobody is told which one it is.
 *
 * `S3_BUCKET=off` still forces the files, and is now the same answer as leaving it unset. It is kept
 * because it is *explicit*: a test or a script that must not touch the network says so.
 *
 * **The prefix is an argument, because a prefix is a dataset.** It used to be read from the
 * environment here and nowhere else, which made it a property of the *process* — so a second
 * dataset meant a second server, and `dataset=both` was not expressible at all. `S3_PREFIX` is
 * still the default, so a box that set it keeps behaving exactly as it did; `datasets.js` passes
 * one explicitly per document instead. `localPath` is suffixed to match, or two datasets reading
 * files would share one `db.json`.
 */
export function docRef(name, localPath, prefix) {
  const bucket = process.env.S3_BUCKET
  const chosen = (prefix ?? process.env.S3_PREFIX ?? DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '')
  if (!bucket || bucket === 'off') return localFor(localPath, chosen)
  return `s3://${bucket}/${chosen ? `${chosen}/` : ''}${name}`
}

/**
 * The ref for one document in the **bucket**, whatever the server would read.
 *
 * `npm run db:push` and `npm run db:pull` are the two commands whose entire job is the bucket, so
 * they cannot go through `docRef`: with the default flipped, that would hand them a local path and a
 * push would become a file copied onto itself — a command reporting success while uploading nothing,
 * which is the worst possible failure for the one tool that moves data between the two stores.
 *
 * `DEFAULT_BUCKET` is the committed address, so these work with no environment set up; `S3_BUCKET`
 * still overrides it, for a box pointed at a different bucket. `S3_BUCKET=off` is handled by the
 * sync tool itself, which refuses rather than silently syncing a file with itself.
 */
export function s3Ref(name, prefix) {
  const bucket = process.env.S3_BUCKET && process.env.S3_BUCKET !== 'off'
    ? process.env.S3_BUCKET
    : DEFAULT_BUCKET
  const chosen = (prefix ?? process.env.S3_PREFIX ?? DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '')
  return `s3://${bucket}/${chosen ? `${chosen}/` : ''}${name}`
}

/**
 * The local file standing in for one dataset's document when `S3_BUCKET=off`.
 *
 * The primary keeps the plain name it always had — `backend/db.json` is what every command in
 * CLAUDE.md, `npm run db:pull` and the seeds all name — so only a non-default prefix takes a suffix
 * (`db.<PREFIX>.json`). Sharing one path across datasets would have each boot overwrite the last,
 * which reads as a dataset that will not stay switched. There is one dataset today and this is
 * still what a second one would need, so it is kept rather than inlined away.
 */
export function localDocPath(localPath, prefix) {
  if (!localPath || !prefix || prefix === DEFAULT_PREFIX) return localPath
  return localPath.replace(/\.json$/, `.${prefix}.json`)
}

const localFor = localDocPath

/** What kind of store a ref names, for the boot banner and `GET /db`. */
export const storeKind = (ref) => (parseS3Ref(ref) ? 's3' : 'file')

/* ---------------- credentials ---------------- */

/*
 * Static env credentials, or the EC2 instance role. The role is the one to use in production: an
 * access key in a file beside the code is the thing this app tells its own users not to do, and a
 * key that never rotates is a key that leaks eventually.
 *
 * IMDSv2 only — the token-less v1 is disabled on hardened AMIs, and falling back to it would work
 * on a laptop and fail on the box that matters.
 */
let cached = null

async function imdsToken() {
  const res = await fetch('http://169.254.169.254/latest/api/token', {
    method: 'PUT',
    headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' },
    signal: AbortSignal.timeout(2000),
  })
  if (!res.ok) throw new Error(`IMDSv2 token answered ${res.status}`)
  return res.text()
}

async function imds(path, token) {
  const res = await fetch(`http://169.254.169.254${path}`, {
    headers: { 'x-aws-ec2-metadata-token': token },
    signal: AbortSignal.timeout(2000),
  })
  if (!res.ok) throw new Error(`IMDS ${path} answered ${res.status}`)
  return res.text()
}

async function credentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  if (accessKeyId && process.env.AWS_SECRET_ACCESS_KEY) {
    /*
     * **A session token belongs to temporary credentials, and only to those.** An `ASIA…` key is
     * issued by STS and is meaningless without its token; an `AKIA…` key is a long-term IAM key and
     * must be sent *without* one. Reading `AWS_SESSION_TOKEN` unconditionally pairs a long-term key
     * with whatever token happens to be in the environment — which is how this first ran: a stray
     * 912-character token, no matching key, and S3 answering `400 InvalidToken`. That reads as "the
     * credentials are bad" and sends you to rotate a key that was fine.
     */
    return {
      accessKeyId,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: accessKeyId.startsWith('ASIA') ? process.env.AWS_SESSION_TOKEN : undefined,
    }
  }
  /* Re-fetched a minute before expiry: role credentials are short-lived, and a 403 an hour into a
     run reads as a permissions problem rather than as an expired token. */
  if (cached && cached.expires - Date.now() > 60_000) return cached
  try {
    const token = await imdsToken()
    const role = (await imds('/latest/meta-data/iam/security-credentials/', token)).trim()
    const doc = JSON.parse(await imds(`/latest/meta-data/iam/security-credentials/${role}`, token))
    cached = {
      accessKeyId: doc.AccessKeyId,
      secretAccessKey: doc.SecretAccessKey,
      sessionToken: doc.Token,
      expires: new Date(doc.Expiration).getTime(),
    }
    return cached
  } catch (error) {
    throw new Error(
      'no AWS credentials — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or give the ' +
        `instance an IAM role (${error.message})`,
    )
  }
}

/* ---------------- SigV4 ---------------- */

/**
 * Sign one S3 request, and return the headers it should carry.
 *
 * **Pure, and exported, because a signature is arithmetic.** Signing inside the fetch would make
 * this unverifiable without a bucket and a network, so it takes its clock and its credentials as
 * arguments instead — which is what lets `scripts/verify-sigv4.js` check it against AWS's own
 * published test vector. A signing bug is otherwise a 403, and a 403 reads as a permissions
 * problem: you would go and edit the bucket policy, which is not where the fault is.
 *
 * Headers are built lowercase from the start: the canonical request sorts and joins them, and a
 * second casing convention is how a signature comes to disagree with the request it signed.
 */
export function sigv4({
  method,
  host,
  path,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  payloadHash,
  amzDate,
  extra = {},
  /**
   * Query parameters, which are part of the signature.
   *
   * `readDoc` and `writeDoc` address an object by path alone and pass none — but this was
   * originally hardcoded to the empty string, and the first caller to need one (listing a bucket,
   * which takes `list-type` and `prefix`) got a 403 `SignatureDoesNotMatch` naming neither. An
   * unsigned parameter is invisible in the request and fatal to it, so the slot exists rather than
   * waiting to be discovered.
   */
  query = {},
}) {
  const dateStamp = amzDate.slice(0, 8)

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v])),
  }

  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((h) => `${h}:${String(headers[h]).trim()}${LF}`).join('')
  const signedHeaders = names.join(';')
  /* Sorted by key and each side encoded — S3 rebuilds this to check the signature, so an ordering
     that differs by one position is a 403 with nothing else to go on. */
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')
  const canonical = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(LF)

  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join(LF)

  let signing = hmac(`AWS4${secretAccessKey}`, dateStamp)
  for (const part of [region, 's3', 'aws4_request']) signing = hmac(signing, part)
  const signature = createHmac('sha256', signing).update(stringToSign, 'utf8').digest('hex')

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/**
 * Where a bucket is addressed, and it is not always the same place.
 *
 * **A bucket whose name contains a dot must be addressed path-style.** The virtual-hosted form puts
 * the name in the hostname — `contextweave.com.s3.us-east-1.amazonaws.com` — and AWS's certificate
 * is `*.s3.us-east-1.amazonaws.com`, whose wildcard matches exactly one label. A dotted name is two
 * or more, so TLS fails outright before any request is sent: *"Hostname/IP does not match
 * certificate's altnames"*. That is not a permissions error and not a signing error, and it is worth
 * naming here because the next person to read it will be holding a stack trace that mentions
 * neither S3 nor this file.
 *
 * Path-style puts the bucket in the path instead, against the plain regional host — and the
 * canonical request has to carry it there too, or the signature covers a different resource than
 * the request does.
 */
function addressing(bucket, key, reg) {
  /* Each segment encoded, the slashes kept: an object key may hold spaces, and encodeURIComponent
     over the whole key would encode the separators too. */
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  return bucket.includes('.')
    ? { host: `s3.${reg}.amazonaws.com`, path: `/${bucket}/${encoded}` }
    : { host: `${bucket}.s3.${reg}.amazonaws.com`, path: `/${encoded}` }
}

/** The same signature, wrapped around an actual request. */
async function signedFetch({ method, bucket, key, body, extra = {} }) {
  const reg = region()
  const { accessKeyId, secretAccessKey, sessionToken } = await credentials()

  const { host, path } = addressing(bucket, key, reg)

  const headers = sigv4({
    method,
    host,
    path,
    region: reg,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    payloadHash: sha256(body ?? ''),
    amzDate: new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
    extra,
  })

  return fetch(`https://${host}${path}`, { method, headers, body })
}

/**
 * A time-limited URL that opens one object, for somebody who has no AWS account.
 *
 * **An export nobody can open is not an export.** The bucket is private, so a report written to it
 * is reachable only through the console or the CLI — which is not what "share this with the
 * regional manager" means. Presigning moves the signature into the query string, so the URL is the
 * whole credential and any browser can follow it until it expires.
 *
 * Two consequences worth stating rather than discovering. The link **is** the permission: anyone
 * holding it can read that object, so it is a share, not an access-control decision — the same
 * distinction the report section draws between telling somebody and entitling them. And it
 * **expires**, which is why `expires_in` is reported beside it rather than left implicit; a link
 * that has quietly stopped working reads as a broken report.
 *
 * The payload hash is the literal `UNSIGNED-PAYLOAD`, which is what S3 expects for a presigned GET
 * and is part of the signed string rather than a placeholder.
 */
export async function presignGet(ref, expiresIn = 3600) {
  const s3 = parseS3Ref(ref)
  if (!s3) throw new Error(`${ref} is a file, not an object — nothing to presign`)

  const reg = region()
  const { accessKeyId, secretAccessKey, sessionToken } = await credentials()
  const { host, path } = addressing(s3.bucket, s3.key, reg)

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const scope = `${amzDate.slice(0, 8)}/${reg}/s3/aws4_request`

  /* Sorted by key, each side encoded — S3 rebuilds this string to check the signature, so an
     ordering or an encoding that differs by one character is a 403 with no other symptom. */
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    ...(sessionToken ? { 'X-Amz-Security-Token': sessionToken } : {}),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')

  const canonical = [
    'GET',
    path,
    canonicalQuery,
    `host:${host}${LF}`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join(LF)
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join(LF)

  let signing = hmac(`AWS4${secretAccessKey}`, amzDate.slice(0, 8))
  for (const part of [reg, 's3', 'aws4_request']) signing = hmac(signing, part)
  const signature = createHmac('sha256', signing).update(stringToSign, 'utf8').digest('hex')

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

/* ---------------- read and write ---------------- */

/**
 * Read one document. Returns its text and its version — an S3 ETag, or `null` for a file, which has
 * no cheap equivalent and does not need one while a single process owns it.
 */
export async function readDoc(ref) {
  const s3 = parseS3Ref(ref)
  if (!s3) return { text: await readFile(ref, 'utf8'), etag: null }

  const res = await signedFetch({ method: 'GET', bucket: s3.bucket, key: s3.key })
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `no object at ${ref} — upload one with: npm run db:push`
        : `S3 answered ${res.status} for ${ref} — ${(await res.text()).slice(0, 300)}`,
    )
  }
  return { text: await res.text(), etag: res.headers.get('etag') }
}

/**
 * Write one document, and return the version it now has.
 *
 * **A file gets temp-then-rename; an object does not need it.** The rename is there because a
 * crashed `writeFile` leaves a truncated file; `PutObject` is atomic per object, so a reader sees
 * the old bytes or the new ones and never half of either. What S3 adds instead is a way to catch
 * the write this app could never catch on a file: `If-Match` fails with 412 if the object moved
 * under us, which means a second writer, and a lost update is what that would otherwise be.
 */
export async function writeDoc(ref, text, etag, contentType = 'application/json') {
  const s3 = parseS3Ref(ref)
  if (!s3) {
    const tmp = `${ref}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, ref)
    return null
  }

  const res = await signedFetch({
    method: 'PUT',
    bucket: s3.bucket,
    key: s3.key,
    body: text,
    extra: {
      /* Stated per object rather than assumed JSON: an export opened through a presigned URL is
         served with whatever this says, so an HTML report typed as JSON downloads instead of
         rendering — which is the difference between a link that works and one that appears to. */
      'content-type': contentType,
      /* Absent only for a document this process never read, which cannot happen: boot refuses to
         start without one. */
      ...(etag ? { 'if-match': etag } : {}),
    },
  })

  if (res.status === 412) {
    throw new Error(
      `${ref} was changed by something else since this server read it. Nothing was written. ` +
        'Restart the server so it reads the current document — this process has been running ' +
        'against a copy that is now stale.',
    )
  }
  if (!res.ok) {
    throw new Error(`S3 answered ${res.status} writing ${ref} — ${(await res.text()).slice(0, 300)}`)
  }
  return res.headers.get('etag')
}
