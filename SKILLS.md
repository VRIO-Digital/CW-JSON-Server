# SKILLS.md

How ContextWeave actually works, end to end. `CLAUDE.md` covers structure and
conventions; this file covers **flow** — what happens when a user does something,
which files are involved, and where each step can fail.

Read this before changing a flow. Every section names the files it touches.

---

## The core premise

Nothing in this app is real until a data source is connected. That single rule
explains most of the design:

- No page has static fallback data. Empty API → empty page.
- `/audit`, `/traces`, `/evals`, `/change-signals` return empty collections and
  `connected_sources: 0` until a source is connected.
- Profiled counts stay 0 after registering, because registration and profiling
  are separate events.

If you find yourself adding sample data to make a page "look right", you are
fighting the premise.

---

## Signing in

**Files:** `LoginPage.tsx` → `authStore.ts` → `client.ts` → `server.js`
(`GET /auth/roles`, `POST /auth/login`) · route gate in `RequireAuth.tsx`

Every page below is gated behind this one. `routes.tsx` wraps the whole `/`
tree in a `RequireAuth` layout route; visiting any of them signed out redirects
to `/login` with the attempted location carried in `state.from`, and signing in
sends the user back there instead of the default landing page. That default is **Ask** —
what the console is for — and `routes.tsx`’s `/` index redirect points at the same place.

### The form

Email, password, role — a `Select` populated from `GET /auth/roles`, fetched
once on mount the same way `EditDatasetsModal` populates its dataset list (a
one-shot local read, not a store). All three are required; email is checked
against antd's `type: 'email'` rule, password needs 6+ characters, both re-
checked server-side because a client rule is not a boundary.

**This is a persona demo, not real authentication, and it says so on the
page.** `POST /auth/login` has no account store to check a password against —
it validates *shape*, not identity: a well-formed email, a plausible password
length, a role that exists in `auth_roles`. Any password succeeds for any
email, same as the BigQuery/Drive consent screens never check a real Google
account. Do not build anything that assumes this login verifies a person.

### The five roles

`platform_admin`, `domain_architect`, `data_analyst`,
`business_user_executive`, `business_user_project` — each a
`{ role_id, label, access_note }` row in `db.json`'s `auth_roles`, the same
pool pattern as `graph_domains`. The dropdown shows `label`. `access_note`
travels with the session but **nothing renders it** — the sidebar's "My data
access" card was removed. Adding a sixth role is a `db.json` edit.

### What lands in the sidebar

Success returns `{ email, role_id, role_label, access_note, initials,
signed_in_at }`, and `authStore` persists it to `localStorage` — a refresh
does not force a re-login, because unlike a registered source there is no
server-side session for a restart to lose. `initials` comes from the email
(`adaeze.okonjo@…` → `AO`): there is no name field on the form, so the sidebar
avatar is derived from what was actually collected rather than invented.

The footer renders three things and no more — the avatar, the email over the
role label, and **Sign out**.

**Where it fails:** an invalid email or a short password is a 400 naming which;
an unknown `role_id` is a 400 naming it; the mock server not running shows the
usual "start `npm run mock`" message. **Sign out** (bottom of the sidebar)
clears the identity and returns to `/login` — a pure client action, since there
is no server-side session to revoke.

---

## Flow 1 — Connecting a source (BigQuery or Google Drive)

**Files:** `ConnectSourceModal.tsx` → `ConnectSourceWizard.tsx` → `client.ts` →
`server.js` · connector list in `data/connectors.ts`

Three steps, driven by local state in the wizard (not a store — it is one
self-contained transaction).

**Two connectors are real, and they are the same flow in different units.**
BigQuery discovers *datasets of tables*; Drive discovers *folders of documents*.
Read the BigQuery column below and the Drive one mirrors it line for line.

| | BigQuery | Google Drive |
|---|---|---|
| consent | `GET /sources/oauth/start?provider=bigquery` | `…?provider=drive` |
| discovery | `POST /sources/preview` | `POST /sources/drive/preview` |
| register | `POST /sources` | `POST /sources/drive` |
| allowlist | datasets | folders |
| `source_id` | `bigquery:<project_id>` | `gdrive:<drive_id>` |
| `kind` | `bigquery` | `gdrive` |

### Step 1 · Connector

Seven connectors from `CONNECTORS`. Only `available: true` ones are selectable —
**Google BigQuery**, **Google Drive** and **Gmail**, which the step's own alert names
rather than counts. The other four (SAP PM / S4HANA, OSIsoft PI, SharePoint / docs,
SQL database) render dimmed under *Product vision — not yet built*; clicking one shows
*why* via its `reason` field rather than doing nothing. `Continue` is disabled until an
available connector is picked.

**Gmail connects and is never profiled, and it is the connector where those two acts
come apart.** BigQuery and Drive are connected *so that* they can be profiled — tables
into columns, documents into entities. Gmail is connected to prove the credential
reaches a mailbox and to record what it was pointed at: which labels, which optional
Gmail search, whether attachments are in scope. It runs the same consent → preview →
finish path as the other two:

| step | call | what it does |
|---|---|---|
| consent | `GET /sources/oauth/start?provider=gmail` | asks for `gmail.readonly` and nothing else |
| | `GET /sources/oauth/callback` | who signed in, plus a session |
| | `GET /sources/oauth/mailboxes?session=&as=` | the one mailbox that consent reaches, and a handle for it |
| preview | `POST /sources/gmail/preview` | the labels this handle can see. Registers nothing |
| finish | `POST /sources/gmail` | registers `gmail:<mailbox>` with the labels, query and attachment scope |

The mailbox is the **signed-in person's own**, derived from `settings.users` rather than
held in a key beside it: a consent reaches the account that granted it, so there is no
mailbox data independent of the directory. `/sources/oauth/mailboxes` returns that one
and refuses an address the directory does not have, naming who it does. Labels are
Gmail's own six and nothing else — what the preview's heading calls them.
Step 2 asks for **nothing** — no source name and no mailbox picker. A mailbox already
carries a name the tenant wrote, so the wizard sends `display_name`; the endpoint still
validates it like the other three. The mailbox is the signed-in reader's own where the
tenant ships it, otherwise the first. There is also **no profiler** — no entry in `PROFILERS`, so `sourceRow`
reports `profilable: false`, the Data Catalog leaves it out and says why, and the Sources
table lists it like any other connected source. The attachments toggle is *recorded*, not
acted on, and the panel words it that way: promising ingestion on a connector with no
pipeline would describe a run that never happens.
**Each card carries its vendor mark**, from `ConnectorIcon` — inline SVG, so
nothing is fetched. A vision connector keeps its mark, desaturated: removing it
would leave holes in the grid that read as still loading, and leaving it at full
colour would make an unavailable card the brightest thing on the row.

**Every connector key needs a mark of its own, and `check-docs` enforces it.**
`ConnectorIcon` used to fall back to `BigQueryIcon`, so the five connectors
without one were each drawn *as BigQuery* — harmless while nothing rendered them,
a card claiming to be a product it is not the moment step 1 showed icons. The
fallback is now a neutral cylinder labelled with the key it did not recognise.

To make one usable: flip `available` and give it a real step-2 path. Its form
fields are already defined.

### Step 2 · Connection

BigQuery and Drive each get a bespoke branch (`isBigQuery` / `isDrive`, together
`isGoogle`); the five stubbed connectors fall back to the generic field loop over
`connector.fields`.

```
Login with Google
  → GET /sources/oauth/start?provider=…    issues a one-time state, scoped
  → GET /sources/oauth/callback?provider=…&as=<signed-in email>
                                           consumes it, returns the account
                                           + a session (no list)
  → GET /sources/oauth/projects?session=…  the projects, each with a handle
    GET /sources/oauth/drives?session=…    the drives, each with a handle
```

**The consent happens in a sign-in window** — `GoogleSignInWindow.tsx`, a
Google-styled click-through with two steps: choose the account, then Allow. (An
earlier one was built and removed; it was asked for again, and this is it.)

```
Login with Google  → GET /sources/oauth/start        the window opens on this response
  [account step]   → the signed-in account, and why there is no second one
  [consent step]   → one row per scope THAT RESPONSE reported
  Allow            → GET /sources/oauth/callback     the consent is spent here
                   → GET /sources/oauth/projects|drives
  Cancel           → nothing granted, nobody connected, the state goes unspent
```

**The window opens on the first call's response, not on the click.** It renders
`start.scopes`, so opening it first would mean opening blank or guessing — and Drive
asks for two. **Allow is what makes the callback**: nothing is granted while the
window sits open, `GoogleConsentPanel` shows its row per call *inside* the window
while it runs, and the window cannot be dismissed mid-request. A failure closes it
rather than offering Allow again, because the state has been spent either way and a
second press could only return "invalid or expired state" — the button underneath
starts a fresh handshake, which is the real retry.

**The account it offers is the browser's, and it says so.** `email`, `name` and
`initials` come from `useAuthStore`; there is no second account and the window
explains why rather than showing a greyed-out row that reads as something that
failed to load. Its footer states that it proves the request is well-formed, not
that a real Google account is behind it — the same honesty the login page carries.
`check-docs` asserts the window keeps no scope list of its own.

**The panel lists the scopes `/sources/oauth/start` returned**, not a per-provider
constant. Drive asks for **two** (`drive.metadata.readonly` *and* `drive.readonly`
— the second is what lets profiling read a document's text), and the first version
of this footer named one. `CONSENT_GRANT_COPY` in `data/consentStages.ts` supplies
wording keyed by scope URL; an unmapped scope renders as its bare id rather than
vanishing, and `check-docs` fails if the server can issue a scope with no copy.
`CONSENT_SCOPES` is only the fallback for stage 0, when the call that reports them
has not returned yet — before that, listing two would be a guess.

**The source name is required, and at least `SOURCE_NAME_MIN` (6) characters.**
One rule, in two halves that `check-docs` keeps equal: `sourceNameProblem` in
`data/sourceName.ts` refuses before the round trip, and its twin in `server.js`
refuses the write on all three register endpoints. **No id fallback** —
`source_name || project.display_name || project_id` used to make the field
optional in practice, and produced rows named `vrio-contextweave-demo`, which
reads as a name and is not one. The error appears once the field has been touched,
not on arrival; `Next` refuses at step 2 with the length in the message. The five
stubbed connectors get the same floor from the same constant, via `minLength` on
their `sourceName` field.

**The account it connects is the signed-in one.** `ConnectSourceWizard` reads
`useAuthStore(s => s.identity?.email)` and sends it as `as=`, because the identity
lives in the browser and the server has no session to look it up from. The success
alert then renders `connectedAs = signedInAs ?? account.email` — the store first,
the payload only as a fallback — so it reads `Connected as <the email you logged in
with>` even when the API answering is an older build (or the deployed box) that
still echoes `db.google_account`. The name the server derives comes from that email
(`displayNameFromEmail`), never invented. With no `as`, the server falls back to
`db.google_account` in `db.json` — which is what every user used to see. A
malformed `as` is a 400, not a silent fall back to the seed, and `check-docs`
asserts all four legs: the server reads `as`, the client sends it for both
connectors, the wizard sources it from the store, and both alerts render
`connectedAs`.

**Symptom to recognise:** the sidebar footer says the email you logged in with and
the wizard says `nishant.srivastav@vriodigital.com` (the `db.google_account`
seed). Those two disagree only if the alert is reading the payload — check
`connectedAs`, not the server.

**Consent and discovery are two calls, not one.** The callback says *who* signed
in; what that account can *see* is spent from the `session` afterwards — what a
real handshake does (a code becomes a token, the token lists resources), and what
gives the wizard a third stage with a real request behind it. The session is
**not** single-use, unlike the state: it stands in for an access token, so a
retried discovery works instead of forcing the sign-in again.

`/oauth/projects` and `/oauth/drives` are twins, and **each refuses the other's
session by name** — answering a Drive session with an empty project list would
read as "this account has no projects".

**Signing in is never instant or silent.** All three calls are held server-side
(`CONSENT_START_MS` 900ms + `CONSENT_MS` 1400ms + `DISCOVERY_MS` 800ms ≈ a 3.1s
sign-in, tuned together to sit in the 2–4s band with no stage short enough to
flash past) for the same reason `SUGGEST_MS` holds a draft: a handshake that
finishes before the first frame paints looks like nothing happened, and it is the
one moment a user should see which scope is being granted. `GoogleConsentPanel`
shows a row per call, labels from `data/consentStages.ts`, and **a row advances
only when its request returns**, never on a timer of its own — so the panel
cannot claim progress the handshake has not made. Add a stage only when there is
a request behind it. It renders inside the sign-in window from
stage 1 — stage 0, the `/oauth/start` call, is what opened the window.

The button reads "Opening Google…" and is disabled while that first call is in
flight and while the window is open; the success alert then reports the count read
(`3 project(s)`, `3 drive(s)` with `npm run seed:workspaces` run) — the count comes
from the response, never a written figure.

**Then the account's workspaces are picked between.** BigQuery lists its projects in
one searchable Select, by display name with the id beside it — the id is what the
source registers against, the name is what a human chooses by. Drive is picked in two
moves: **My Drive / Shared drives**, each carrying its own count, then the drive
within that kind. Both kinds are always offered; a kind the account has none of shows
`(0)` and says to pick the other, because a control that disappears reads as broken
rather than as an empty half of somebody's Drive.

**Only the success path is paced.** A replayed state, an unknown session and a
cross-provider session all answer in single-digit milliseconds — making an error
wait teaches nothing and reads as a hang.

The state is single-use — replaying it returns 400. It also **remembers which
provider it was issued for**: a BigQuery consent replayed against
`provider=drive` is a 400, not a silent cross-scope read. Selecting a project or
drive fills its credential handle and invalidates any previous preview.

There is **no raw-key path**. The "Advanced" collapse takes an id and a
credential handle only; credentials are held by reference, and the server has no
endpoint that accepts a key. Do not reintroduce one.

`Continue` requires both an id and a credential handle.

### Step 3 · Test & Finish

```
1. Run preview   POST /sources/preview        discovers datasets, registers nothing
                 POST /sources/drive/preview  discovers folders, registers nothing
2. Finish        POST /sources                registers for real
                 POST /sources/drive
```

Preview validates the handle against the project/drive (a handle for another one
gets 403) and returns the dataset or folder list, which becomes the allowlist —
all checked, because the copy says "uncheck to exclude". Finish
rejects an empty or unknown list. The Drive preview also reports page counts and
the distinct MIME types per folder: documents are *counted*, never read, until
the profiler runs.

**Both acts are paced, on the server, at `CONNECT_STEP_MS` (5s).** Discovering a
project's datasets and registering a source are the two calls here that would really
talk to Google, and both returned before their button's spinner drew a frame — an act
that finishes instantly and shows nothing teaches that it is free. The hold is on the
four endpoints rather than in the component, so the rule the consent stages follow
still holds: **a button advances when its request returns, never on a timer the client
keeps**. Only the success reply waits; every refusal above it (400/401/403/404) answers
immediately, so a mistyped handle does not take five seconds to report itself.
`check-docs` asserts both halves per endpoint, and that none of the four handlers
grows a timer of its own.

**And the act in flight is named — one small modal each, one line each.** Five seconds
behind a button spinner reads as a wedged dialog, so both acts open `ConnectRunPanel`:
a spinner and *Discovering the datasets in project vrio-contextweave-demo* under Run
preview, *Registering project vrio-contextweave-demo with the datasets you checked.* under
Finish — folders and the drive id, on Drive. **The message names what the call is made
against**: `{subject}` is interpolated with the id the request itself carries, the way
`runtime.headroom.sentence` interpolates `{room}`, because "discovering the datasets" could
be any project the account can read. There is no subject-less variant — step 2 refuses to
advance without an id, so a fallback would only mask a regression. **Two dialogs, not one
panel listing both**, because a panel that listed both had "registering the source" on screen
while nothing was being registered — an act describing work that is not running is the
same fault as a stage that ticks without a request.

Four things they keep: each opens on its own value of `busy`, the flag the buttons'
spinners already read (separate state could stay true after the call returned, which is a
dialog over a finished request); they open for the two Google connectors only, since the
generic branch has no paced call behind them; the message comes from
`src/data/connectSteps.ts` per act and in the connector's own unit, never authored in the
component; and neither act's message carries the other's verb. There is no dismiss —
nothing here is a decision, and cancelling would leave a five-second call running with
nothing on screen. The sign-in window's stage rows are `StageList`'s, which these do not
use: a single act is not a list.

**BigQuery's allowlist is a checkbox group; Drive's is a tree** (`FolderTreePicker`),
because a drive nests and a project does not. The folders arrive flat with a
`parent_id` and the tree is built in the component; **checking a folder checks the
folders inside it**, and the value handed to `POST /sources/drive` stays a plain list
of folder ids. A folder holding folders states both counts — `3 here · 41 with
subfolders` — because one number is wrong either way. A folder whose parent is not in
the list is drawn at the root; the server refuses that shape at boot (`validateDb`
checks `parent_id` across the drive, and refuses a cycle too), so the component's
tolerance and the server's refusal are the two halves of one rule.

The dialog **stays open** after Finish so the confirmation stays readable; `Close`
dismisses it. `onRegistered` refreshes the Sources table without closing.

**Where it fails:** wrong project/handle or drive/handle pairing → 403. Empty
allowlist → 400. A consent replayed against the other provider → 400. Mock server
not running → the wizard shows the "start `npm run mock`" message.

---

## Flow 2 — What a registered source looks like

**Files:** `SourcesPage.tsx` → `sourcesStore.ts` → `GET /sources`

Columns: `source name` (with the `source_id` beneath it, because that is what the
actions act on) · `status` · `project / account` · `scope` · `connected` ·
`profiled` · Actions.

`scope` and `profiled` read in the unit of the connector: `3 dataset(s)` and
`4 table(s) · 112 col(s)` for BigQuery, `3 folder(s)` and
`10 doc(s) · 168 entities` for Drive.

The four cards read Registered sources / Profiled tables / Profiled columns /
Profiled documents. **The last three stay 0** until profiling runs — that is
correct, not a bug.

Four actions, all through the store:

| Action | Endpoint | Effect |
|---|---|---|
| Edit datasets *(BigQuery)* | `PUT /sources/:id/datasets` | narrows the allowlist; Catalog follows immediately. **Disabled while disconnected** |
| Edit folders *(Drive)* | `PUT /sources/:id/folders` | the same, in folders. Same rule |
| Disconnect | `POST /sources/:id/disconnect` | revokes the credential, **keeps** the registration and everything profiled |
| Reconnect *(disconnected rows)* | `POST /sources/:id/reconnect` | re-issues the handle **in place** — the undo for Disconnect |
| Delete | `DELETE /sources/:id` | removes it, its profiled objects and their notes. No undo |

**Both destructive actions confirm with one question and nothing else** — *"Are you sure
you want to disconnect / delete this source?"*, the `Popconfirm`'s title, no
`description`. The sentence is in `src/data/sourceActions.ts`: copy rather than a
component, because a Popconfirm portals out of `renderToString` and inline copy there
cannot be asserted on, while a function can be called by a test directly.

`SourceImpactNotice` — which stated what each act did to the row, whether it could be
undone, and which pages closed when the last connected source went — **was deleted on
request**, with its stylesheet and its `othersConnected` prop. `docs/REGRESSIONS.md` has
the entry. Two things follow, and both matter when reading this flow:

- **The acts are unchanged; only the copy is gone.** Disconnect is still reversible via
  the Reconnect button and keeps every profiled object — verified end to end (1 table /
  10 columns before, after disconnect, and after reconnect). Re-registering through the
  wizard is still *not* the undo: `POST /sources` builds a fresh record and the profile
  drops to 0/0 (also verified). Delete still has none. A reader is no longer told any of
  it, so **do not read the quiet dialog as evidence that the act is harmless**.
- **What `check-docs` pins is now the shape, in one cross-layer claim.** The sentence is
  interpolated from the act, so "delete" cannot appear over a disconnect; it is written
  once, so the two dialogs cannot diverge; neither Popconfirm carries a `description`;
  and the deleted files are off disk. One claim rather than one per file, because a
  partial revival — a description back on one dialog only — is the shape that fails
  silently.

The per-page gate claims survive that removal and are now about the pages themselves:
Data Catalog, Traces and Validation render `NoSourceConnected`; Ask, Reports, the
What-if lens and Audit render `NoPublishedGraph`. Two different preconditions, and a page
that swapped one for the other would look right and be wrong.

A disconnected row shows **Reconnect** in place of Disconnect: two buttons where only
one can ever apply is a row asking a question it has already answered.

**And a disconnected row cannot have its allowlist edited.** It holds no credential, so
widening what it may profile promises access it cannot make. The button is disabled
*with a tooltip saying which reason applies* — disconnected, or a stubbed connector with
no discovery — because a greyed-out control with nothing on it reads as broken, and here
the fix is one button along. **The server refuses the same write on both `/datasets` and
`/folders`**: a disabled button is only a courtesy to whoever is looking at it, and any
other path into the route would otherwise store an allowlist nothing can act on — the
same reasoning as the fixed Settings permission. Verified end to end: 200 connected →
400 disconnected → 200 after Reconnect.

One button, two modals: the row's `kind` picks `EditDatasetsModal` or
`EditFoldersModal`. Each allowlist endpoint refuses the other connector's source
with a message naming the right one rather than half-applying an edit.

Disconnect is not deletion. A disconnected source stays listed so it remains
deletable, but stops counting as connected — so the other four pages fall back to
their empty state. There is no Reconnect yet; delete and re-register.

---

## Flow 3 — Browse → profile → watch the pipeline

This is the most involved flow and the one most likely to be misunderstood.

**Files:** `CatalogPage.tsx` (`BrowsePanel`) → `catalogStore.ts`
(`useBrowseStore`, `useJobsStore`) → `ProfilingJobsTab.tsx` → `server.js`
(`runJob`, `PIPELINE`)

**Drive files:** `CatalogPage.tsx` (`DocumentBrowsePanel`) →
`useDocumentBrowseStore` → the same `ProfilingJobsTab`.

### The source list

Left column, one card per connected source. **The `source_id` leads and the name
the user gave rides beside it as a neutral tag** (`cat-source-name`) — the id is
what every action acts on, but `bigquery:vrio-contextweave-demo` is not what
anyone is scanning for. Same pairing in the detail header. Now that a name is
required and at least six characters (Flow 1, step 2), that tag always says
something; before, it would often have echoed the project id.

Neutral tints, not `STATUS`: a name is not a state. The id ellipsises before the
name does, because its project part is repeated on the meta line under it.

### The two actions, and how a panel closes

The detail column offers exactly two moves — **Browse … for profiling** and **View
profiled …** — and both are toggles whose **fill is the state**: the one whose panel is
open is the brand orange (antd `primary`), the other is white (`default`). Neither is
permanently the primary; that ranking was wrong in both directions, since on a source
with nothing profiled the browse panel is the only way forward and on a profiled one
the dictionary is what you came for. The stylesheet paints neither — `type` decides,
so the brand colour stays declared once, in `theme.ts`.

**The panels have no ✕ of their own.** Each one carried a `close` link above its
content, which meant two controls for one piece of state and only one of them showed
what that state was. The button that opened a panel closes it — which puts real weight
on that fill, since it is now the only thing saying which panel is open. So it is never
colour alone: **`aria-pressed`** carries the same fact to a screen reader, and a line
under the row says it in words while a panel is open — and only then, or it is an
instruction for a state the reader is not in. `browseOpen` / `dictionaryOpen` are
*derived* from `panel`; a second piece of state beside it is how a button comes to look
open with nothing under it.

`check-docs` asserts the removal on all four panels at once (no `CloseOutlined`, no
`onClose`), because half of it is worse than all of it: a ✕ wired to a prop nobody
passes is a button that does nothing.

### Browse

`GET /sources/:id/browse` returns only **allowlisted** datasets with their
tables. Rendered as a checkable antd `Tree`; parent/child propagation is antd's,
and leaf keys encode `dataset::table` so a checked key converts back to an object
(`leafKey` / `parseLeaf`).

**A leaf names the object twice, and both are needed.** The id is what the run
posts back, so it leads; under it sit the view's `label` and its `grain` — a Gold
view called `e_manifest` is unusable until the tree says it is
`e-Manifest (shipments)`, one row per shipment. Both come from `db.json` and are
carried straight through `browsableObjects`, so `validateDb` refuses a document
whose tables have lost either.

`GET /sources/:id/browse-documents` is the Drive twin: allowlisted folders with
their documents, same tree, leaf keys encode `folder::document`. Its second line
is `doc_type_label · linked_entity` — what the file *is*
(`Consent Decree (modification)`) and which graph entity it maps to
(`J.R. Simplot Company Don Plant`), from the extraction map. `linked_entity` is
never synthesised: it is the join to the structured side, and a hash must not
invent it.

Ask the wrong one and you get a **400 naming the right endpoint**, not an empty
tree — an empty tree reads as "nothing to profile" and sends you debugging the
allowlist. Same for `columns` vs `documents`, and `profile` vs
`profile-documents`.

### Start Profiling

```
POST /sources/:id/profile             →  202 Accepted, job status "queued"
POST /sources/:id/profile-documents   →  202 Accepted, job status "queued"
```

**It does not do the work.** The response is a queued job. The server then walks
it through five stages on timers — which five depends on the connector, because
extracting text from a PDF is not sampling a column:

```
queued                          queued
  → 1/5 Schema fetch              → 1/5 Text extraction
  → 2/5 Statistics sampling       → 2/5 Chunking
  → 3/5 Class inference           → 3/5 Entity extraction
  → 4/5 PII detection             → 4/5 Document PII detection
  → 5/5 Candidate keys            → 5/5 Topic classification
complete                        complete
```

Both are **five stages on purpose**, so a job row reads the same either way.

Objects are committed to the source as stages pass, so `profiled_tables` /
`profiled_columns` — or `profiled_documents` / `profiled_entities` — climb
*during* the run rather than jumping at the end.

A job's work list is `objects`, never `tables`: `{parent_id, object_id, label,
units, state}`, plus `unit: 'table' | 'document'` and `kind` on the job. One
board shows runs from both connectors, and `unit` is what it prints. A re-run
sends the objects back to the endpoint the job's `kind` came from.

Two behaviours that look like bugs but are not:

- An already-profiled table or document is **skipped**. The browse panels never
  force on the first click — their footer is `Select all · Select none · Start
  Profiling`, and Profiling jobs keeps its per-row **Force** for a run that has
  already finished.
- A forced commit updates the object's record **in place** — `profiled_tables`
  and `profiled_columns` do not double on a re-run, but `profiled_at` moves.
- If everything selected is already profiled, the job completes instantly with
  `nothing to profile` instead of faking a 12-second run — **and that outcome is a
  question, not a notice.** `profilingOutcome` (`src/data/profilingOutcome.ts`,
  shared by both panels so they differ only by the noun) turns it into a confirm
  that **names the objects** — `2 table(s) already profiled: route_segments and
  transporter_manifests.` — says what re-profiling does (re-reads them, replaces
  what the profiler wrote, in place), and puts `force: true` behind its OK.

  The message this replaced was *"Nothing to profile — 2 table(s) already profiled.
  Use Force on the run in Profiling jobs to redo them."* It never said which two, so
  on a five-view source you could not tell whether the one you cared about had run;
  and the only way forward it offered was on another tab, against the job that had
  just done nothing. A partial run names its skipped objects for the same reason.
  Names are capped at `NAMES_SHOWN` (6) with the remainder counted — **no cap is
  silent**, the rule the report charts follow.

  `check-docs` asserts the Start Profiling button does not force and that the
  confirm's `onOk` is the only path that does.

### Watching it

Starting a run **switches to the Profiling jobs tab** — from the Catalog tab a
queued job is invisible, which was the whole point of making it async.

`ProfilingJobsTab` polls every 3s **only while `active_count > 0`**; the poll that
sees zero stops the loop, so there is no traffic at rest.

**So queueing a run has to tell the board — `handleQueued` loads the jobs list**, not just
the sources. A poll that stops is not a subscription: the first click
mounts the tab and its mount effect loads, but a *second* run started with the tab already
open lands on an idle board that never asks again. That is the re-profile confirm exactly —
"Profile N table(s) again" queued a run that really ran, while the list kept showing the
all-skipped job that completed instantly, which reads as a button that did nothing and
raises no error anywhere.

Active rows are
expanded by default, tracked as *opt-outs* so a job appearing mid-poll shows its
progress without a click. The bar is blue while running, green on complete, amber
on cancelled. `Cancel` → `POST /profiling-jobs/:id/cancel`; cancelling twice
returns 409.

Re-profile / Force on a finished row re-queue the same table set — `Force` sends
`force: true`; the plain one does not, so it skips whatever is already profiled.

---

## Flow 4 — The column dictionary

**Files:** `ProfiledColumnsPanel.tsx` → `useColumnsStore` →
`GET /sources/:id/columns` → `tableDictionary()` in `server.js`

Facet chips (All / Needs review / PII / IDs / Measures / Dates / Location / Flags)
filter client-side; the counts come from the server's `facets`. **They are the
classes this data actually has** — the profile uses eight (`identifier date
dimension entity address geo flag measure`) and none is `text`, so a Text chip
would have read 0 for all 206 columns. `Location` folds `address` and `geo`
together, 69 of the 206; `check-docs` asserts the server's arithmetic and the
panel's filter fold them the same way, because a chip that counts 69 and lists 41
is worse than either number alone. Below them, datasets →
collapsible table cards → the column table: `COLUMN · TYPE · DESCRIPTION ·
CLASS · PII · NULL% · DISTINCT`. Each card head repeats the view's `label` and
`grain` beside the id, because a column list means nothing until the row it
describes is named.

**For `epa_hazwaste`, the columns are real.** `column_profiles` in `db.json` holds
all **206** — ingested from ` _demo_data_package_2026-08-10/02_profiling/`
`Metadata_Profiling.xlsx`, one sheet per view — with the profiler's own
`label`, `type`, `description`, semantic `class`, `derivation`, `confidence`,
`pii`, `null_pct` and `distinct`. `tableDictionary()` serves that verbatim for any
`dataset.table` it has an entry for, and `check-docs` asserts the count matches
what the Catalog claims for each view, so the two cannot drift.

To re-ingest after the workbook changes, re-run the ingestion (a scratch script;
the reader is ~100 lines of zip + XML rather than a dependency). Rounding
`null_pct` on the way in is deliberate: the workbook carries
`88.09999999999999`, which is float noise, not a statistic.

**`needs review` means low confidence, not a missing description.** Every real
column arrives described, so "has one" would pin the facet at 0 forever. It is set
when the profiler was below the High band (**0.85**, `HIGH_CONFIDENCE`) and no
curator has confirmed it — 81 of the 206 on arrival. A curator note settles it and
decrements the facet, exactly as before.

**Column metadata is synthesised for anything else, and you need to know how.**
`synthesiseColumns()` is the fallback for a table `column_profiles` does not
cover: `db.json` stores a column *count*, and the columns come from a slice of
`column_vocabulary` chosen by hashing the table name, with every statistic derived
from a hash of table+column. That means:

- It is **deterministic** — repeat requests agree, so nothing shifts under the UI.
- Identifier columns get `distinct == row count`; other classes get plausible
  cardinalities by class.
- Names render uppercased-with-spaces in the UI (`manifest_tracking_number` →
  `MANIFEST TRACKING NUMBER`); storage stays snake_case.
- **A `_2` is only ever a second copy.** The slice starts at a hashed offset, so
  the vocabulary's lap boundary falls mid-list; suffixing by lap made a 50-column
  view show `manifest_tracking_number_2` with no `_1` anywhere. The suffix now
  counts uses *within that table*, so a table no wider than the vocabulary has
  none at all, and `e_manifest_all` (92 columns over 50 entries) has exactly 42.

Editing a description (`PATCH /sources/:id/columns`) stores a note against
`dataset.table.column` on the source and flips `description_status` to
`described`, which decrements the **Needs review** facet.

To give another table real columns, add a `column_profiles` entry keyed
`<dataset>.<table>`; `tableDictionary` already prefers it. Do not extend
`column_vocabulary` to imitate a table the profiler has already described.

### The document dictionary — the same idea, one level up

**Files:** `ProfiledDocumentsPanel.tsx` → `useDocumentsStore` →
`GET /sources/:id/documents` → `documentDictionary()` in `server.js`

Facet chips (All / Needs review / PII / Consent decrees / Complaints /
Settlements / CAFOs), then folders → collapsible document cards → the entity
table: `ENTITY · TYPE · CLASS · PII · OCCURRENCES · COVERAGE`. Each card head
carries the file's `doc_type_label` and `linked_entity` beside its name, in
neutral tints — what a document is and who it is about are categories, not state.

**The four type facets are the corpus's own kinds, not a fixed taxonomy.** They
match `doc_type`, the slug, and the map lives in one place per side
(`FACET_FOR_TYPE` in `server.js`, `TYPE_FOR_FACET` in the panel) —
`check-docs` asserts the two agree. A consent-decree *modification* files under
Consent decrees because that is what it is; only `doc_type_label` says it is a
modification. Reseed `drives` with different kinds and both maps move together.

**Each card carries the document's *resolution into the graph*, and it is real.**
`document_extractions` in `db.json` — ingested from
`08_unstructured/Entity_Extraction_Map.xlsx` — records, per file, the entity the
extractor pulled out, the facility node it resolved to (`FAC:LAD727050419`), that
node's state, and **how many inbound manifests it already carries**. That last
number is the payoff: it is what makes a consent decree connect to the manifest
stream, so it is read, never derived. Two documents about one facility resolve to
the *same* node — Chemours cd + cp → `FAC:NCD844706749`, Stericycle complaint +
settlement → `FAC:ILR000067890` — which is the entity resolution working, not a
duplicate.

A document with no entry renders **"No graph entity resolved from this document
yet."** rather than an empty strip, and `check-docs` fails if a seeded document
has no extraction, so that sentence means "nothing matched" and never "the
ingestion skipped a row".

Two deliberate differences from the column dictionary — do not "fix" them:

- **The facets count documents, not entities.** A file is the unit a curator
  reviews, so `all` is the profiled-document count and `pii` counts documents
  holding at least one PII entity.
- **The editable note is the document's `summary`, not a per-entity
  description.** `PATCH /sources/:id/documents` stores it against
  `folder.document` and flips `summary_status` to `described`, which decrements
  **Needs review**. Extracted entities are read-only: they are machine output,
  not curation.

**The entity *list* is still synthesised, and the two halves stay apart.** The map
describes one entity per file, not the dozens a 96-page decree holds, so the table
comes from `document_vocabulary` — sliced by hashing the document id, statistics
derived from a hash of document+entity, so repeat requests agree. `occurrences` is
1–2 for an identifier and recurs for prose classes; `coverage_pct` is occurrences
over the document's chunk count (`pages × 2.5`). The resolved entity is reported
in its own row rather than dropped into that list, because a fact that was read and
a fact that was hashed must not sit in the same column looking alike —
`check-docs`-adjacent coverage asserts no `FAC:` id appears among the entities.

---

## Flow 5 — Editing the data (`/db`)

**Files:** `DbEditorPage.tsx` → `dbStore.ts` → `GET|PUT /db`, `PUT /db/:section`

Reachable by URL only — routed, but commented out of `NAV_ITEMS`.

Pick a top-level key (or `whole file`), edit JSON, Save. Three layers of
protection, in order:

1. **Client parse** — `parseDraft` keeps Save disabled until the text is valid
   JSON, so nothing invalid is ever sent.
2. **Server shape check** — `validateDb` verifies all 27 required keys and
   their basic structure. A document that would crash the app is rejected with a
   message per problem.
3. **Atomic write** — temp file + rename, so a failed write cannot truncate
   `db.json`.

Then the in-memory `db` is mutated **in place**, which is what makes the edit live
without a restart.

Two limits: registered sources are not stored in `db.json` (memory only, lost on
restart), and referential integrity is not enforced — deleting a project that a
registered source points at leaves that source with no datasets.

---

## Flow 6 — How a request becomes state

The path every read takes, and what each layer contributes:

```
component
  └─ useXStore((s) => s.field)          selects narrowly; stable refs from selectors
       └─ store.load()                   try/catch lives here; sets { data | error }
            └─ client.fn()               fetch + snake→camel mapping
                 └─ request()            adds x-dataset: EPA | CAPEX | both
                      └─ validate(schema)  rejects at the boundary, names the path
                           └─ /api proxy   Vite strips /api
                                └─ server.js
                                     └─ withDataset(...)   picks the document
                                          └─ db.<key>      a Proxy over that one
```

**Which dataset answered is decided at both ends and nowhere in between.** `request()` is the only
sender of the header and the dispatcher is the only reader of it, so no store, page or endpoint
carries a dataset argument. An unrecognised value is a 400 naming the pool, and every non-GET is
refused while `both` is selected.

**Changing it is Settings → Dataset → confirm → signed out.** The confirmation names both datasets
(`src/data/datasetSwitch.ts`, interpolated so it cannot name the wrong move) and states the sign-out;
OK persists the choice, drops the identity and reloads to `/login`. The reload is the point: zustand
stores are module-level singletons, so remounting the page tree would have left them holding the
previous dataset's rows. Signing back in reads the persisted selection — its `localStorage` key is not
the identity's — and the login names the dataset it is signing into.

Failure modes and what the user sees:

| Failure | Message |
|---|---|
| Server not running | *Cannot reach the JSON server. Start it with `npm run mock`* |
| HTTP error | the server's own `error` text, verbatim |
| Malformed payload | *… came back in an unexpected shape: `sources[0].profiled_tables` should be a number, got string* |
| Stale server (old row shape) | *… running an older version of this API … Restart it* |
| Anything else | the error's own message — never swallowed |

`ApiErrorAlert` renders the load-failure case as the whole page, because with no
fallback data there is nothing else to show.

Actions differ from loads: they return `Result`, and the component decides
between `message.success` and `message.error`. No component contains a
`try/catch`.

---

## Flow 7 — New Graph: describing a use case

**Files:** `NewGraphPage.tsx` → `graphStore.ts` → `GET /graph-domains`,
`GET|POST /graph-use-cases`, `DELETE /graph-use-cases/:id`

Six steps, and the premise is inverted from every other flow: **the user
describes a business need and the AI derives the graph.** Nobody types an entity
name — do not add a field that asks for one.

```
1 Domain → 2 Personas → 3 KPIs → 4 Sources → 5 Hero questions
        → 6 Entities & relationships
```

Labels come from `WIZARD_STEPS` in `server.js` via the `/graph-use-cases`
payload, so the stepper and the server's `step` validation are the same list.
**All six steps are built.**

**'Answer requirements' was step 6 and is gone — see Flow 7 (Ask).** The citation policy
and the render format were declared once per brief; they are asked for per question on
Ask's own tab now, so nothing on a brief stores them and
`/graph-answer-formats/suggest` went with the step. A brief saved on the old step 6 or 7
opens on the new last step — `savedUseCase` clamps the stored number, because a stepper
pointing at a step the API would reject is worse than opening one screen further back.
The page keeps the count in `LAST_STEP` (one constant, because it has changed once
already); `stepTotal` still reads the server's list.

### Step gating

**A step unlocks only once the one before it is complete.** `stepIssue(step,
draft)` in `src/data/wizardSteps.ts` is the single definition of "complete" —
`Next`, the stepper's lock and the last step's build button all read it, so none of them
can disagree about whether a step is done. It returns the message shown to the
user, so each rule names the fix rather than the rule:

| Step | Complete when |
|---|---|
| 1 Domain | named *and* a domain picked |
| 2 Personas | at least one persona |
| 3 KPIs | at least one KPI |
| 4 Sources | the four checks below |
| 5 Hero questions | at least one question |
| 6 Entities & relationships | every gap decided — the build gate |

`maxStep` on the page is how far the draft has been taken, restored from the
saved `step` when a use case is opened. A step past it renders `is-locked` with a
lock in place of its number, and **stays clickable on purpose** — the click
answers with what is missing, where a disabled button would just read as broken.

Going **back is always free** and keeps the answers, so a cleared step can be
reopened and edited. Going forward re-checks every step in between
(`firstIncompleteStep`), because an answer can be deleted after it was given —
emptying step 3 relocks step 5. Jumping does not save; `Next` is the save point.

Server-side, only step 1's rule is enforced (`step > 1` or `status:
'committed'` without a domain → 400, checked on the merged value so an upsert
carrying the domain on the existing record still passes). The later steps stay
client-side deliberately: **Save draft** must be able to persist partial work
from any step, and a server rule would refuse it.

### Saved use cases

The card above the stepper lists every saved use case, newest first: name, a
`draft` / `committed · ready to build` status tag, its domain chip, and when it
was updated. `Open` loads it back into the form *at the step it was left on*;
committed rows read `Open → build`. Delete asks first, and deleting the row that
is currently open resets the form rather than leaving it editing a ghost.

Unlike a registered source, a use case is written to `db.json` through
`commitDb`, so drafts survive a restart.

### Step 1 · Domain

Use case name (what the drafts list shows) · business domain · the free-text
business need.

The three domain cards are **ranked by what the connected data can actually
support**. `GET /graph-domains` downgrades a seeded `strong` fit to `partial` or
`none` when nothing is profiled, because "already profiled for this domain" must
not be claimed over zero profiled objects — so with no source connected the order
and the notes legitimately differ from a screenshot taken with data. Connect and
profile a source and the backed domain climbs to the top.

`Next` refuses an unnamed use case or an unpicked domain, then **saves before
advancing**, so a reload never loses the last answer. The domain is also
enforced server-side, because every later step derives from it. The last step's primary
action commits — status `committed`, which is what makes a row read "ready to
build".

### Steps 2 and 3 · Personas, then KPIs

**Both steps are the same component** (`DraftedStep`) over the same server
machinery — they differ only in copy and which pool they draw from:

| | Step 2 | Step 3 |
|---|---|---|
| suggester | `POST /graph-personas/suggest` | `POST /graph-kpis/suggest` |
| pool | `graph_personas` (`focus`) | `graph_kpis` (`definition`) |
| list label | Who will ask questions of this graph? | KPIs these answers report against |
| saved as | `personas` | `kpis` |

Both answer `{ suggestions: [{ id, name, detail, why }], count, derived_from }`,
and both lists are stored as `{ name, description, source }`. Adding a step 4–7
list of the same kind means reusing `DraftedStep` and `suggestFrom`, not writing
a third variant.

`Suggest personas (LLM)` → `POST /graph-personas/suggest { domain_id,
business_need }` → up to four drafts from the `graph_personas` pool. Each row
carries an **AI-DRAFTED** tag, its `why`, a **+ Add** button and an ✕ to wave it
away (local only — a suggestion was never saved).

**+ Add** moves it into *Who will ask questions of this graph?*, keeping the
focus line as its description and `source: 'ai'`.

Below the suggestions, **Add persona** — the same primary button as the
suggester, because typing your own is not a lesser path — opens a two-field form
(**name**, **description**) with `✓ Add` disabled until the name is filled, and ✕
to cancel. It sits *above* the list it adds to.

*Who will ask questions of this graph?* renders in the same tabular form as the
suggestions: name over description, then the provenance tag — **AI-DRAFTED**
(brand tint) or **USER-DRAFTED** (neutral) — and ✕ to remove. Provenance stays
visible after adding; without it a drafted persona and a typed one are
indistinguishable the moment they land in the list.

A persona is `{ name, description, source }`. The server trims, de-duplicates by
name (case-insensitive), caps at 12, and **rejects a persona with no name** rather
than dropping it silently. A bare string is still accepted and normalised, because
that is what earlier drafts hold — an old draft opens instead of rendering
`undefined` in the chip.

Three things to keep true:

- **Suggestions are not the draft.** They live in `usePersonaSuggestStore` and
  are never saved until adopted, and opening another use case clears them —
  suggestions belong to the brief that produced them.
- **Every suggestion explains itself.** The ranking is keywords found in the
  business need, then domain fit, then a hash of the brief; the `why` states
  which it was ("matches your brief on cost, spend, escalation" vs "typical for
  this domain"), and it is deterministic for the same brief.
- **A brief that names a known use case is answered from it, not ranked.** If
  the business need contains two or more of a `graph_use_case_templates` entry's
  `match_phrases` — pasting that use case's description hits all of them — the
  step drafts exactly that use case's personas, KPIs and hero questions, whole
  and in its own order, past the four-suggestion limit. The `why` reads "named
  in the … use case" and `derived_from` names it. Two templates tying matches
  neither, and the keyword ranking answers instead.
- **Personas are tags, not permissions.** The panel says so, and the server never
  validates a persona against the suggestion pool — the user may add their own.

With no brief the suggester falls back to domain only and says so
(`derived_from`). Omitting `personas` from a save leaves them untouched; sending
`[]` clears them.

### Step 4 · Sources

**Files:** `SourcesStep.tsx` → `useGraphSourcesStore` → `GET /graph-sources`

This is the one step whose answers are not free text: it lists **what the Data
Catalog has actually profiled**, per connected source, in that connector's unit
— `epa_dataset2.manifest_header · 42 columns` for BigQuery, `Audit reports /
FY25 audit.pdf · 26 entities` for Drive.

Select a source, then keep `All profiled tables (N)` or `Choose tables…` and pick
from the box. A pick is `{ source_id, mode, objects }`; **`mode: 'all'` keeps
meaning "everything profiled here"**, so a table profiled after the draft was
saved is included without reopening the wizard, while `subset` pins an explicit
list.

**Two dead ends, two different exits.** Telling someone to connect a source when
they already have three is useless advice, so the step distinguishes them:

| State | What step 4 shows |
|---|---|
| nothing connected | `NoSourceConnected` — "Connect a source" → `/sources` |
| connected, nothing profiled | an **error** alert — "No profiled data yet — you cannot select a source", with "Open the Data Catalog to profile a source" → `/catalog`, above the cards, each tagged `nothing profiled` and disabled |
| something profiled | the selection UI; the alert disappears |

**`Next` refuses to leave step 4 empty** (its rule lives with every other step's,
in `wizardSteps.ts`), and names the fix for each case: no
sources connected → go to Sources; connected but unprofiled → go to the Data
Catalog; profiled but nothing selected → select a source; a `subset` with no
objects → pick one or switch back to all. Every later step derives from this
selection, so advancing empty would build a graph over no data.

Three refusals, all server-side too, because these answers must still be true at
build time:

- picking a source that is connected but has **nothing profiled** → 400 pointing
  at the Data Catalog. It is still *listed*, tagged `nothing profiled` and
  disabled — "not profiled yet" is a different problem from "not connected", and
  hiding it would make the two indistinguishable.
- a `subset` selecting nothing → 400 (*"an empty selection can't derive"*)
- an object that is not profiled on that source, or a source that is not
  connected → 400 naming it

Disconnecting a source removes it from what this step offers, so a stale pick
cannot survive quietly.

### Step 5 · Hero questions

**Files:** `HeroQuestionsStep.tsx` → `useQuestionSuggestStore` →
`POST /graph-questions/suggest`

The questions the graph exists to answer — and the **High** ones are its
*contract*: what it must be able to answer to count as built.

Not a `DraftedStep`, deliberately. A hero question is one long sentence rather
than a name plus a description, so it gets a card with the controls beneath it,
and its second field is a **High** checkbox rather than more text. Five are
drafted rather than four, because a contract wants a little more to choose from.

- **Suggested questions** — each card carries the question, then **what it is
  for**, then **why it was drafted**, then `AI-DRAFTED`, a **High** checkbox,
  `+ Add` and ✕. The two middle lines are the same pair `DraftedStep` gives a
  persona (`detail` then `why`) and they are not interchangeable: the first is the
  reason the brief gave for asking ("the core liability question — connects
  inbound manifests to generator compliance records"), the second is why this
  suggester surfaced it ("named in the … use case", "matches your brief on
  transporter, loads"). This step used to render **neither**, so a drafted
  question was the one suggestion in the wizard that arrived unexplained.
  A question with no stated rationale simply has no `detail` line.
  High is decided *as you accept it*, not afterwards, so the checkbox sits on the
  suggestion too. It arrives **already ticked** when the drafted question carries
  its own `priority` — a use case that already said a question is High should not
  make you say it again — and ticking or unticking still wins over that default.
  **The current use case states no priorities**, so nothing arrives ticked; that
  is the brief being silent, not a bug to fix by inventing them.
- **Your questions** — one row each: a `HIGH` badge on the left when marked,
  the text, then `AI-DRAFTED`/`USER`, a still-editable **High** checkbox, and ✕.
  Nobody gets a contract right first time, so priority stays changeable.
- **+ Add question** opens a High checkbox, a pill input and `✓ Add` (disabled
  until there is text) with a round ✕ to cancel.

Stored as `hero_questions: [{ text, priority, source }]`. `priority` is
two-valued on purpose — a third tier would invite ranking instead of choosing.
The server de-duplicates by text (case-insensitively), caps at 20, accepts a bare
string from an older draft, and **rejects a question with no text**.

### Step 6 · Answer requirements — removed

The step is gone. Citations and the render format are chosen **per question**, on Ask's
own Answer requirements tab — Flow 7 documents it. What went with it:
`AnswerRequirementsStep.tsx`, `useAnswerFormatStore`,
`POST /graph-answer-formats/suggest`, and the `citations` / `answer_formats` fields on a
saved brief. The reason is that a declaration nothing checks is worth less than a request
something reports on: Ask now says, per answer, whether the citations asked for were
really carried.

Two things a re-add would have to face, both recorded here because they were the
step's own claims: it declared how answers render *for every answer the graph would
ever give*, which the engine never consulted at runtime; and its formats were ranked
by `suggestFrom` down to three, out of a pool of ten that a reader can now see in full.

### Between 5 and 6 · the derivation run

**Files:** `LlmRun.tsx` → `useDerivationStore` → `POST /graph-derivations`,
`GET /graph-derivations/:id`

`Generate use-case brief` hands the answers to a derivation and advances
immediately. The last step then shows the run rather than a blank wait:

```
                        ◜  spinner
        Deriving the entities you need…
  Capital Project, Authorization, Purchase Order, Cost Line…
  ███████████░░░░░░░░░░░░░░░░░░░░░░░░░
  async — safe to leave; you’ll be notified · run cost so far $0.34 of $1.00 cap
```

The answer is computed up front — `graphCoverage` is deterministic — but revealed
over five stages on timers, exactly as the Metadata Profiler is, and for the same
reason: **the run is genuinely async** (it has an id, and polling resumes it), and
a wizard that jumps straight to a finished answer teaches that deriving a graph is
instant and free. Entity names stream in proportionally to the bar; cost accrues
per stage and stops at the cap.

The page polls every 700ms **only while the run is in flight**. Arriving at step 6
without a run — by clicking the stepper — reviews directly through
`/graph-coverage` instead, so the step is never blank just because the run started
elsewhere. Starting a new derivation clears any gap decisions: they were answers
about a previous derivation.

### The LLM drafting state

Every `Suggest … (LLM)` button shows an inline strip while it waits — what it is
doing (`Reading your brief · Drafting candidates · Ranking against your data`) and
what the last call cost. The suggest endpoints are **held for `SUGGEST_MS`
deliberately**: there is no model here, so they would otherwise return in about
2ms, leaving the UI nowhere to show that something was asked of an LLM and
teaching that the call is free. Cost is deterministic per brief, and the strip
shows no figure at all until a run has reported one.

### Step 6 · Entities & relationships (coverage review)

**Files:** `CoverageStep.tsx` → `useCoverageStore` → `POST /graph-coverage` ·
build gate in `data/coverage.ts`

The only step the user does not fill in — it reports what the AI derived from
everything above, **checked against the Catalog**.

**Every backed element names the profiled object it came from.** An entity *is* a
profiled table or document, so its evidence line reads
`context-weave-dev · manifest_header (1,240,500 rows) · match 0.89`. Nothing here
is invented: the entity name is the table name in title case, the row count comes
from `db.json`, and a **relationship is only claimed where two profiled objects
share an identifier column** in the column dictionary — that shared key is the
evidence (`shared key batch_id · match 0.94`). Anything looser would be a guess
dressed as a derivation.

A hero question whose vocabulary appears in no profiled column becomes a **gap**:
*"No candidates in any connected source — nothing profiled covers purchase,
orders, lived."* Each gap offers four decisions — `accept permanent`,
`drop question`, `connect source`, `defer with trigger` — stored as
`gap_decisions: [{ element_id, decision }]`.

**Save & build graph is disabled until every gap has a decision**
(`coverageIsDecided`); `Save Only` always works. An undecided gap is a question
the graph cannot answer, and shipping it silently is the failure this step exists
to prevent.

The review is **re-derived on every arrival**, never cached — narrowing a source
pick on step 4 immediately narrows what step 6 reports.

**Where it fails:** an unnamed draft → 400 (`name is required`), an unknown
domain or an out-of-range step → 400, opening a use case the server no longer has
→ 404. All surface through the store's `Result`, so the page shows a message and
keeps its state.

---

## Flow 8 — Graph Studio: a built graph becomes a published one

**Files:** `GraphStudioListPage.tsx` · `GraphStudioPage.tsx` →
`ReviewQueueItem.tsx` → `graphStudioStore.ts` → `GET /graph-studio`,
`GET|POST /graph-studio/:useCaseId…`

```
New Graph step 6 · Save & build graph
        → POST /graph-use-cases              commits the brief (pin_inputs)
        → POST /graph-studio/:id/builds       202 + a queued run
        → /graph-studio/:useCaseId            lands on Build, watching that run
/graph-studio                                every graph you have built
        → click one → Build · Review queue (6) · Canvas · Query & sanity-check
                      · Versions
```

### The Build tab

**Files:** `GraphStudioPage.tsx` → `useGraphBuildStore` → `BuildTab.tsx` →
`POST|GET /graph-studio/:id/builds`, `GET …/builds/:buildId`

Eleven stages, in dependency order — `pin_inputs`, `a01_schema_parsing`,
`join_matrix`, `entity_nomination`, `a03_relationship_inference`,
`a02_document_entity_extraction`, `a02b_document_relationship_mining`,
`a03b_cross_pipeline_reconciliation`, `a04_entity_resolution`,
`a015_comprehension`, `a05_graph_construction`.

**Each stage names its own substeps, and they are what advances.** A stage carries
2–3 (`pin_inputs` → `resolve_use_case`, `seal_coverage_evidence`,
`pin_source_versions`) — 31 in total at `BUILD_STEP_MS` (**3s**) each, so a run
takes about **1m 33s**. That is slow on purpose: a substep is paced to be narrated
while it runs, not merely to prove the work was not free.

**Build first — the other four tabs are locked until a run completes, and again while one
is in flight.** Review queue,
Canvas, Query & sanity-check and Versions read a build's output, so they
are `disabled` while this graph's history holds no `complete` run **or while a run is
running**, and one flag (`outputReadable` = `builtOnce && !buildRunning`) drives all four.
The second half matters for a rebuild: those tabs would otherwise show the *previous*
build's canvas and version list while the new run supersedes them, with nothing saying so,
and a queue row settled against a superseded canvas is a decision made on stale evidence.
The lock states itself above the tabs while it holds, in
different words while a run is in flight — which is the only sentence a rebuild can carry,
since the act is already underway. Two failure modes it avoids: the studio's
default arrival tab is the queue, so a locked tab has to be pushed off `activeKey` or antd
renders an unreachable pane (and a rebuild started from another tab moves the reader the
same way); and the queue's rows are the package's, so it looks
populated before anything has been built — which is the whole reason the gate is worth
having. Rebuilding after settling rows is still the normal case; only the reading of its
output waits.

**Because it takes minutes, the panel states the pace and the time left.** Both come
from `step_ms` in the payload, never from a number typed into the component — a
multi-minute spinner with no estimate reads as a wedged process, and an estimate the
client invented would be wrong the moment the server's pace changed.

**One cursor drives both levels.** `BUILD_STEPS` is the pipeline flattened, and a
run keeps nothing but an index into it: a substep is complete before the cursor,
running at it, pending after, and a stage is `running` exactly while the cursor
sits inside it. A stage index kept alongside a step index is two counters that can
disagree, and the screen would show a stage complete while one of its substeps
still spun. The server drives the cursor and the page polls every 350ms; a row
turns green when the server says it did, never on a timer of its own.

**Every stage and every substep is listed from the first response**, `pending`
until it runs: a list that grew a row at a time would hide how much is left, which
is the only thing the panel is for. Substeps stay visible on a stage that has not
started for the same reason. The names are printed **verbatim** so a row on screen
is greppable in a log — do not prettify them.

**Why here and not in the wizard.** A graph is built more than once: settling review
rows changes what a build produces, so **Rebuild** is the normal case. Every run is
kept in that graph's history and an earlier one stays loadable from the picker.
The wizard's job ends at starting the first one.

**Building is not publishing.** The footer names the draft version the run produced
and says to publish it from Versions; the publish gate is untouched and still
refuses while the queue or the pivot is open. `package_id` and `graph_version` are
minted per run, so a rebuild is visibly a different package.

**Where it fails:** a draft → 400 from `findBuiltGraph` naming "finish it in New
Graph"; a build the server has forgotten → 404 saying builds live in memory and a
restart clears them. If the wizard's build fails to start, the brief is still
committed and the message says both.

Every tab is built. The header carries only what is live — each tab owns its own
actions, so publishing runs from a version's own row in Versions, where the version
being published is the one you are looking at.

**There was a Quality report tab, and it is gone** — removed on request, with
`POST /graph-studio/:id/quality-check`, `runQualityCheck`, the `QualityReport` types
and the store's `report` / `checking` / `check`. It recomputed the three preconditions
`publish.blocked` already reports, so it was a second surface for one gate. The gate
is untouched: the banner over the review queue and the refusal on publish still state
those three checks.

### The list

Only graphs that have been **built** — a use case committed on the last step. Each row
carries its name, domain, `draft v15` / `published`, when it was built, and the
one number that decides whether it can ship: how many items still need a human.

A use case still in the wizard is not listed, and opening its id is **refused
with a 400 naming the fix** rather than a 404 — "not built yet" is a different
problem from "no such graph". The draft count is still shown, because that is
the answer to "where did my graph go?".

### One graph's review

Four buckets, split by confidence and by whether a *floor* was hit:

| Card | Meaning |
|---|---|
| **Must review** | below 0.85 and on a floor — these block publish |
| **Pivot** | an entity-resolution question that blocks the build outright |
| **Confirmed FYI** | 0.85–0.95, spot-checked |
| **Auto-approved** | ≥0.95, listed for the record |

**Every figure is the length of something returned.** `db.json` holds the queue, the
pivot and the totals, all ingested from the package's **trust lanes** (`autoApprove`
398 · `confirmedFyi` 12 · `mustReview` 6 · `pivot` 1, summing to its
`elements_total`). The must-review lane is entirely authored — `must_review_total`
equals the ingested row count, so nothing synthesised pads the lane a reviewer must
clear. The two spot-check buckets *are* synthesised by `studioItems` from a hash that
includes the use case id, so each built graph has its own sample and repeats agree,
and confidence is generated inside each bucket's band so a card cannot lie about its
own filter. Those return a named `*_sample`; 398 is a count, not a list.

**Five rows plus the pivot.** The package ships six must-review decisions and `rq1`
is the identity merge (Texas Molecular LP ⇄ VLS Texas Molecular), which is the one
that changes what every other row *means* — so it is ingested as the pivot and the
queue holds the other five. The arithmetic still matches the package's
`mustReviewTotal`, and `check-docs` asserts the merge is in exactly one of the two:
in both, a reviewer could answer one question two ways.

**A row's buttons are its own labels.** Each states three in its own terms — "Keep
distinct", "Declare basis = manifest", "Leave orphaned" — while the *choice* behind
each stays one of the fixed set, because what a decision means to the canvas has to be
identical on every row. The server validates against the row's own `actions` and names
them in the refusal (`"approve-causal" is not one of the choices rq4 offers — it
takes: approve, correct, reject`), and the page reads that same list, so it cannot
offer a button the API rejects. `action_set` is the fallback family for a row stating
none, and where the causal pair still lives: **Approve as causal / Downgrade to
correlational / Reject**, never a plain "Approve", because only one keeps the causal
edge. A `schema-changing` row cannot be resolved without a justification, refused
server-side.

**A row's `graph_refs` are not what it makes provisional.** Refs are what the row is
*about*; the provisional set is what its decision still governs, mapped explicitly in
the ingest. rq5 and rq6 deliberately mark nothing — rq5 declines a promotion so there
is no node to dash, and rq6 concerns three attachments below the floor that were never
drawn.

Every action answers with the whole studio, so the cards, the gate and the row
move together and no second fetch can leave them disagreeing.

### The publish gate

**The pivot is a separate precondition from the queue.** Resolving all five rows
still leaves publish blocked while it is open, because settling it changes what
the already-decided rows mean — which is why the pivot sits *above* the rows
rather than in them.

`publish.blocked` and its `reasons` are computed once, on the server. The
button's `disabled`, its tooltip, the banner and the `POST …/publish` refusal all
read that one list, so a UI that forgot to disable still cannot publish.
Publishing makes the **draft's own** version live — `draft v15` publishes as
`v15`, and the next draft becomes v16.

**Where it fails:** a plain approve on a causal row → 400 naming the three legal
choices; a schema-changing row with no justification → 400; an unknown item →
404; an unknown pivot option → 400 naming the two; publish while blocked → 400
listing the same reasons the banner shows; opening an unbuilt draft → 400 telling
you to finish the wizard.

Decisions and the pivot live **in memory**, keyed `useCaseId:itemId` so two
graphs cannot answer each other's rows — a review pass is a working session, not
something a mock writes back over its seed.

### Canvas

**Files:** `src/graph-viewer/` (vendored) + `fromCanvas.ts` → `GET /graph-studio/:id/canvas`

The ontology as nodes and edges, drawn by the **vendored graph viewer** — a d3-force
graph with its own simulation, drag, zoom, search box, type legend and inspector sidebar.
It was vendored the same way `src/reports/` was: its hook, its lib, its types and its
stylesheet are its own, and it was imported rather than reimplemented. The standalone app it
came from lived at `vendor/graph-viewer-source/` until 2026-08-18, when it was deleted —
nothing imported it, so it was a second copy of the viewer with nothing keeping it in step.
`src/graph-viewer` is the only copy; the original is in git history.

**It replaced a hand-written inline SVG, and that is why d3 is here.** The old canvas drew
the ingest's precomputed positions: 189 nodes in a fixed arrangement, which reads as a
hairball whatever the palette does. "Prefer ~100 lines to a package" still holds elsewhere
— the answer charts and the What-if drawings are still hand-written — but a settling force
layout with drag and zoom is not 100 lines. `npm audit` was 0 advisories before and after.

**What went with it, so nobody looks for it:** the four-hue origin-class fill and the
ontology ring inside it, `LABEL_AT_ZOOM` label gating, the `getScreenCTM` pan/zoom and its
non-passive wheel listener, `src/components/GraphCanvas.tsx`, `NodeInspector.tsx` and
`src/data/canvasLegend.ts`. The payload still carries `group` (the origin class) and
`validateDb` still checks it — it is the graph's own account of how an element was built —
but the drawing no longer encodes it.

**Four changes were made to the folder, and no others.**

| change | why |
|---|---|
| it takes its graph as a **prop** | the folder shipped with a synthetic demo dataset; the graph here is the tenant's, and that data was dropped rather than ported so it cannot render by accident — `check-docs` asserts `src/graph-viewer/data` does not exist |
| its root carries **`cw-graph`** | its stylesheet is scoped under that class. Unscoped, `.link`, `.tab`, `.dot`, `.side` and its *dark* `:root` tokens restyle the whole app — the report prototype's trap, with worse selectors |
| `useForceGraph` gained **`highlight`** | the Query tab promises an answer's evidence lights up on the canvas. The dim/highlight mechanism already existed for the clicked neighbourhood, so the answer path feeds that rather than a second highlight with its own rules |
| it **fills a container**, not a document | the root was the document's flex root at `100vw` and declared no width, so in the full view's flex row it sized to content: the drawing collapsed to min-content beside the 360px panel and two thirds of the page went blank. `width: 100%` *and* `flex: 1 1 auto` + `min-width: 0`, so it fills a block container and a flex one — and the simulation measures its box (`clientWidth` is 0 before layout, which piles every node into the corner) with a `ResizeObserver` re-centring it after |

**`fromCanvas` renames; it does not invent.** The shapes were already close, which is what
made vendoring possible: `element_class` is exactly the viewer's three classes (only
`measure_element` → `measure`), our ontology `type` is the key its `TYPE_COLORS` is written
against, `source` becomes the `provenance` its inspector prints, `sublabel` becomes its
`subtype`, and the studio's review state becomes its amber L2 note — **only where there is
something to say**, because an absence has no note. `r` is deliberately not passed: the
viewer sizes a node by element class and degree, and two radius rules disagree silently.

**The ingest's positions still do work.** `x`/`y` are handed over as each node's *starting*
position, which is how d3 reads an existing `x`/`y`, so a run settles from the arrangement
`npm run ingest:graph` wrote rather than from a random scatter. That is why the picture is
recognisably the same graph each time, and why re-running the ingest is still how the
layout changes.

**It draws the demo package's knowledge graph**, ingested from
`05_knowledge_graph/knowledge_graph.json`: **189 nodes, 241 edges**, one hub (VLS
Texas Molecular, 61 relationships), 49 facilities, 40 evaluations, 38 violations, 31
enforcements, 11 sampled manifests, 7 enforcement documents, 7 concepts, 3 measure
elements and 3 aliases.

**The graph is an index, not a copy.** Spec-faithful AGB Layer 1, three element
classes: `concept` (type-level, one node however many rows), `thin_instance`
(identity + provenance *only* — no attributes, no measures, no dates) and
`measure_element`. Every figure on a sublabel or an edge tooltip comes from the
package's `demo_display` block, its cache of what Layer 2 would federate at query
time. Do not move a value onto a node to make rendering easier: the separation is what
is being demonstrated.

**Column values are not nodes, by decision.** The earlier graph promoted 13
`WasteCode`, 9 `ViolationType` and 5 `EnforcementType`; the package's `not_nodes`
lists all three with `was_wrongly` beside them — a code on a row is an attribute of
the shipment. The events those columns described are nodes instead. `check-docs`
fails if a retired type reappears, and rq5 in the queue is the standing offer to
promote them anyway, declined by default.

**Colour is the ontology type now.** Nine hues rather than four — a categorical palette stops
being reliably distinguishable past four when any two nodes can end up adjacent. The ground is
**white**, matching every other surface in the app; the viewer arrived dark and was turned over,
which meant retoning all nine (the dark set measured 1.95:1–3.36:1 on white) to their ~5:1 shades
in one luminance band, so they separate by hue and not by lightness. `check-docs` asserts every
type the canvas draws has a hue (`colorFor` otherwise falls through to grey, honestly but
silently) and recomputes each against `--bg` as the stylesheet declares it, at 3:1 — so the ground
is stated once and the guard follows it. Size is the viewer's own rule: `radiusFor` by element
class, then degree, so the hub is biggest because 61 edges land on it.

**Reading it:** drag a node, scroll to zoom, drag the background to pan, **Reset view**
returns. Clicking a node dims everything outside its neighbourhood — the interaction that
makes 189 nodes readable, since "which of these lines are mine" is not answerable by
looking. The search box narrows by label or id; the legend rows filter by type, each with
its count. The sidebar's two tabs are the viewer's own: **Inspect** (the node, its
provenance, its relations, its L2 note) and **How it's built**.

**Full view** opens the same graph in a **new tab** at
`/graph-studio/:useCaseId/canvas`, using the whole window — the studio tab keeps its
place, its queue and whatever the reader had zoomed to. It is the **same viewer on the
same payload**; only the frame differs, because a full view that drew its own graph would
be a second truth about it. Three things about the route:

- It is declared **before** the `App` tree. `graph-studio/:useCaseId` matches the
  parent segment, so declared after it the studio page would render at the full view's
  URL — a wrong page with no error anywhere.
- It sits **outside** `App`, the only page besides `/login` that does, and for the
  opposite reason: `/login` has nothing to navigate to yet and this has nothing to
  spare. Still inside `RequireAuth`.
- It is **URL-only**, like `/audit`, `/trace`, `/validation` and `/db` — reached by the
  button, never advertised in the sidebar.

The button lives on the studio's canvas tab, not inside the viewer: `src/graph-viewer` is
vendored and knows nothing about this app's routes. The full view does **not** render one —
a link to the page you are already on is a dead control, and the absence is what makes it
impossible rather than merely unlikely.

**The canvas and the review queue are the same truth.** A node or edge carrying a
`review_item_id` is *proposed* exactly while that row is undecided — approve rq2 and
the Chemours `DESCRIBED_BY` edge un-dashes, correct rq4 and the `quantity_tons`
measure element becomes `studio-authored` (which is what the fourth filter chip
counts). The inspector says so and links back to the queue.

The one state shown is "proposed", and it carries a dashed outline and the word as
well as a colour. Filter chips show counts, so an empty result reads as "none match"
and not as a broken chip.

**An edge whose endpoint is not a node fails the boot.** An earlier package shipped 20
such edges — three alias names and an unitemised enforcement type its node roster
omitted — and the symptom was silence: those relationships were skipped while drawing,
so 17 facilities looked like they had no enforcement. `validateDb` checks canvas
endpoints across keys. **This build resolves cleanly**, so the ingest materialises
nothing and throws if it would have to, and `check-docs` asserts the canvas is exactly
the roster — a canvas larger than the package means something is being invented.

### Query & sanity-check

**Files:** `GraphStudioPage.tsx` → `POST /graph-studio/:id/query`

A question asked of the **draft**, before anyone commits to it — by one of two
routes, and the payload always says which. The answer comes back as a canvas with the
walk marked, which is what the glow on the Canvas tab is; there is no second request
and no second truth.

**A recorded check wins, and names itself.** `graph_studio.sanity_checks` holds the
five the package wrote in `graph_studio.json`: a hero question (`hq4`, `hq2`, `hq1`,
`hq13`, `hq10`), a verdict, the context chips, the Cypher the engine would plan, its
cost against the budget, and the sub-graph it walks. They are offered as chips under
the box, because a chip is a promise the brief already made. Matched exactly as
`ask_answers` are and at **the same `ASK_MATCH_MIN`** — two thresholds over one
tenant's questions would let the studio pass what Ask declines — with `recorded: true`
and `check_id` on the payload, so a written verdict is never read as something the
walk derived. A recorded check names its hops by `edge_id`, so the highlight is exactly
the relationships it used.

**A recorded traversal is a sub-graph, not a chain.** `pathLabels` is empty on one and
the hops are listed from `edgesUsed` instead: sc3 walks three generators and three
enforcement actions that all meet at the receiving TSDF, and arrow-joining those seven
ids would claim a route nobody walked.

Anything unrecognised falls through to **the walk**. There is no engine: the entities
named are matched to nodes and the path between them is walked over the edges that
actually exist, so the path *is* the evidence.

Three honest failures, and they are the point:

- a question naming **no** entity in the graph → not answerable
- naming **one** → "a question needs two things to relate"
- naming two that **nothing connects** → says so rather than inventing a hop

An answer crossing an undecided edge is answerable **and provisional**, and says
which decision it is resting on — publishing would change it. **A recorded check is
not exempt**: its caveats come from the edges it actually used, so sc1, which rides
the Chemours `DESCRIBED_BY` edge that rq2 has open, is answerable and flagged.

Matching requires the whole label or a word that is **rare and not a type name**.
Three ways a bare shared word answers a question nobody asked:

- it is a *kind* — "which facility do we accept waste from" holds "facility" and
  "waste", which name the type `Facility` and an edge label, so no instance may claim
  them. The stoplist is read off the graph's own `type` and edge-label vocabulary, so
  a new node type stops its own word without anyone remembering to.
- it is common — "texas" is in five labels here, so it names none of them.
- **it is the whole label of a concept node.** The rebuild put 7 type-level nodes on
  the canvas labelled exactly "Facility", "Manifest", "Document" — and the whole-label
  shortcut bypassed the stoplist, so "tell me about the Denka facility" resolved to
  `CONCEPT:Facility` and reported the two had nothing between them. A concept *is* the
  type, so concepts are excluded from instance matching and the shortcut clears the
  stoplist too.

The rule was once "unique to one node", and it broke the moment a facility and the
consent decree about it shared a name: "what does the chemours consent decree say
about the facility we accept waste from" matched nothing, and that question is the
whole point of the graph. Rarity replaced uniqueness — a word naming at most 5% of
the nodes is taken as naming them deliberately — and the word floor is four
characters, because "the" is rare across these labels and matched *The* Chemours
Company Fayetteville Works on the article.

### Versions

**Files:** `GraphStudioPage.tsx` → `VersionsTab.tsx` →
`POST …/versions/:sha/publish`, `POST …/versions/:sha/unpublish`

**A version is a build.** Every run that finishes records one row, newest first:

```
facility manifest · v2   loaded  gate passed  published   11/08/2026, 14:57
8 entities · 4 relationships · graph 9ff33f44… · sha256 67da70212ac5… · from job d2aee040…
[ Load this version's job ]  [ Unpublish ]   immutable — content-addressed; …
```

**Content-addressed and immutable.** `sha256` is the identity — two builds of one
brief differ there and nowhere else. **Each build also takes its own number — v1, v2, v3**,
assigned when the run starts and never recomputed, so a published `v2` stays `v2` however many
builds follow. The number names the build; the hash is still the identity. (It used to name the
brief's *config* and moved when the brief was committed, so several rows read `v2` — the wrong
reading of a list of builds.)
Publishing flips a pointer (`studioLive`, one content hash per graph); it never
rewrites a row, and unpublishing clears the pointer. The sentence on every row says
so, so it must stay true.

**Two acts, not three:**

| Act | Endpoint | What it means |
|---|---|---|
| publish | `POST …/versions/:sha/publish` | Ask may query **this** build |
| unpublish | `POST …/versions/:sha/unpublish` | take it out of Ask; the row survives |

**Publishing an older row is the rollback**, and it works because any row may be
published. This replaced an earlier publish → approve → activate chain, and the
cost is stated plainly: there is **no recorded human sign-off** any more, and no
separate activate step. The gate is unchanged — an unreviewed graph is refused
whichever row is chosen.

**Publish is offered even when the gate is blocked**, because the refusal names
what is outstanding; that is more use than a disabled button with no reason. The
tooltip says it before the click.

The badges are facts about a row, so only two are `STATUS` coloured: `gate passed`
and `published`. `gate unknown` is neutral — it means nobody had reviewed the graph
when that build finished, which is not a failure. `loaded` marks the row the Build
tab is showing and takes a brand tint, because being loaded is navigational.

**Where it fails:** publishing while the gate is blocked → 400 naming every reason;
publishing or unpublishing an unknown hash → 404 saying versions live in memory;
unpublishing a row that is not the published one → 400.

---

## Flow 9 — Ask: querying a published graph

`AskPage.tsx`, `AnswerRequirementsPanel.tsx` → `askStore` → `GET /ask` · `POST /ask`

Where the graph gets used. Everything before this flow produces a graph; this is
the flow that spends it.

**Two tabs: Ask, and Answer requirements.** The second is where step 6 of the New Graph
wizard went — see Flow 6. Both sit behind the one publish gate; only `PageHeader` and the
graph picker are outside it.

### History — New chat, and this session's threads

**Files:** `AskChatRail.tsx`, `AskAnswerView.tsx`, `src/data/askChats.ts` → `sessionStorage`

**It is a collapsible panel called History, shut by default.** The toggle names it and carries
the thread **count**, so nothing is hidden without a trace; collapsed, the component returns
early and the rows are not in the markup — a shut panel still in the DOM is a narrower page
rather than a lighter one, and it is the difference an assertion can see. `aria-expanded` states
which it is. Expanded, it is the panel below. Two acts shut it again — New chat and opening a
thread — because both end in reading, and reading wants the width.

Asking appends a **turn** — the question plus the answer it got — to the active chat, and the
thread renders every turn oldest-first. Before this the page kept one `answer` and replaced it,
so the question before last was simply gone and there was nothing for a history to be a history
*of*. `AskAnswerView` was extracted at the same time: one turn's worth of markup, rendered per
turn rather than copied.

| rule | why |
|---|---|
| a chat is created **by asking** | "New chat" only clears the active id, so the list never fills with empty threads somebody opened and left |
| the thread is the **only** home for an answer | read through `selectActiveChat`; a second copy in the store is how the thread and the history disagree |
| switching graphs starts a **new** thread | an answer belongs to the version that produced it, and reading it under another graph's heading is a claim about content that never answered it |
| `sessionStorage`, keyed by the signed-in **address** | a chat is a working session, like a registered source or a review decision; and the identity is client-held, so two people sharing a browser must not read each other's questions |
| signed out reads and writes **nothing** | "signed out" is not a user, and a shared bucket is exactly how one reader sees another's |
| **validated on read** | `sessionStorage` is hand-editable, like the `/db` editor, and a restored chat is rendered by the components that render a validated answer. `loadChats` drops what fails — one bad entry costs that entry, and a turn with no answer (a tab closed mid-stream) is dropped rather than restored as an eternal spinner |
| the rail **states the limit** | `CHATS_KEPT` (20), that closing the tab ends the session, and that nothing is stored on the server — a rail that looked like an archive would promise one that does not exist |

**The agent's messages are the server's stages.** The in-flight turn renders the streamed
`stage` lines, then the summary, then each block, paced *between* the pieces (`ASK_STAGE_MS`
420ms, `ASK_BLOCK_MS` **5s**) so a five-block answer takes ~25s and a one-line abstention does
not. The page holds no timer of its own — a stage appears because a stage happened. Switching
chats mid-answer is refused with a sentence rather than allowed to strand the stream.

**Each paragraph still to come is a shimmer, counted from `block_count`.** The summary event
states how many blocks follow — the answer is composed before the stream opens, so the server
knows — and `AnswerBlocks` draws `block_count − landed` placeholders. That number matters: a
client-side guess would leave a placeholder under a finished answer, which is a promise nothing
keeps. Three ragged lines rather than one bar, `aria-hidden` (the working line says the same
thing in words), and the pan drops under `prefers-reduced-motion`.

**The Answer requirements tab is switched off** — its tab item and the five hooks feeding it are
commented out together in `AskPage.tsx`, and `check-docs` reads that through `codeOnly` so the
claim cannot pass over a comment. Everything behind it is intact (`AnswerRequirementsPanel`, the
served pool, the request fields, the per-answer verdict); every question is asked with the
served default `required` while it is off, and two uncomments bring it back.

**Where it fails:** storage disabled or full is silent by design (the page runs without history,
which is the same state as a fresh tab); a chat whose graph is no longer published still reads
back, because the turns are what was said and the answers name the version that said it.

### What can be asked

Only a graph that is **live** — published, and the version currently serving.
`GET /ask` walks the built graphs, keeps the ones `liveVersion()` answers for,
and returns each with the facts the page prints:

| Field | Where it comes from |
|---|---|
| `version` | the live published version, never the draft counter |
| `published_at` / `published_by` | the publish record in Graph Studio |
| `caveats` | the coverage step's gap decisions, read back through `GAP_CAVEAT` |
| `suggested_questions` | the use case's hero questions, verbatim |
| `entity_count` / `relationship_count` | the canvas |

Nothing here is page copy dressed as data. A suggestion chip is a hero question
the brief already committed to; a chip for something the graph was never built
for would be a trap.

**A graph no longer carries a citations policy.** It was the brief's, declared on the
removed step 6 and inherited by every answer; it is the reader's per question now, so it
rides on the *answer* rather than on the graph. A graph-level copy would be a second
answer to "what did this reader require".

### Answer requirements — what a reader asks an answer to carry

`AnswerRequirementsPanel` renders the pool `GET /ask` serves as
`answer_requirements`: the two citation options with their labels, the default, the ten
formats with their recipes, and the note. **Served, not written into the component** —
for the reason the consent screen renders the scopes the endpoint returned, because a
client-held list can offer a value `POST /ask` refuses. The pick travels with the
question (`citations`, `formats: [format_id]`), and `selectCitations` in `askStore` is the
single definition of the effective value: the reader's choice, or the served default.

**The answer reports on it, computed rather than asserted.** Every envelope carries
`requirements: { citations, formats, satisfied, note }`:

- **Citations really apply.** `satisfied` is `citations !== 'required' || cited > 0`, so
  asking for citations and getting an answer that cites nothing is false and the page
  tags it `warn`. An abstention says nothing was answered, so there is nothing to cite.
- **A format is stated, not applied**, in those words. A recorded answer holds the blocks
  the tenant wrote; claiming it was rendered to order is a claim the screen underneath
  disproves. Same two-gate honesty as a report's audience versus its data scope.

**Where it fails:** an unknown `format_id` → 400 naming the pool; a `citations` value
outside the two → 400 naming them. Both refuse **before the stream opens** — an error
must never arrive as an event inside a 200 — and neither is paced.

### The empty page

**`NoPublishedGraph`, the same component Reports, the What-if lens and Audit &
Governance render.** Ask had its own copy of it — same gate, different title and
its own *Open Graph Studio* button — so one precondition read as two problems;
`check-docs` now asserts all four use the component and none hand-rolls a second.
Ask passes only its own `detail` sentence and `footnote`.

Three different sentences inside it, because they have three different fixes:

- **built but unpublished** (`built_count > 0`) → "publish it in Graph Studio",
  and the button goes there.
- **only drafts** (`draft_count > 0`) → finish the wizard first.
- **nothing at all** → describe a business need.

Getting this wrong sends someone to New Graph to fix a graph that only needed
publishing, which is why the two counts ship separately rather than as one
"nothing to ask".

### Asking

**Two sources of answer, and the recorded one wins.**

`ask_answers` in `db.json` holds the tenant's **40 written answers** — ingested
from `06_queries/query_set.json`, 13 tied to hero questions, 22 standard, 5
declines — each an ordered list of **blocks** (`text` | `metric` | `chart` |
`table`) with its evidence and a stated confidence. `matchAskAnswer` serves one
when the typed question is the same question, or shares **at least
`ASK_MATCH_MIN` (0.6)** of its words *and* beats the runner-up. A tie matches
nothing, exactly as `matchTemplate` treats one: a near-miss served confidently is
worse than an abstention. Every recorded answer reports **which** it was —
`Answered from the recorded query set · Q01 (hero, hq1)` — so nobody reads a
written answer as something the walk derived.

Anything unrecognised falls through to `studioQuery` — **the same walk the
studio's sanity check uses**, so a check that passed before publishing cannot
disagree with the answer after it. That path carries four steps of working
(grounded → planned the route → routed to source systems → composed), one
citation per relationship walked, and a confidence that is the **weakest node on
the route**.

**The answer is streamed, because it is composed.** `POST /ask` answers with
`text/event-stream`: a `stage` per step of working, then `summary`, then one
`block` at a time, then `done` carrying the whole envelope. `askQuestionStreaming`
in `client.ts` reads it and **validates every event by its own schema** — `done`
is validated as a whole object, which is the one the store keeps, so the answer on
screen has never been assembled from unchecked fragments. A five-block answer
takes longer than a one-line abstention (`ASK_STAGE_MS` 420 + `ASK_BLOCK_MS` 380
per piece), which is the honest shape.

Refusals are still plain JSON 400s **before the stream opens** — an error must
never arrive as an event inside a 200, and errors are never paced.

**A recorded answer's evidence carries no per-row confidence.** The query set
states one score for the whole answer, so `citations[].confidence` is `null` on
that path and the page prints the figure only where there is one. Inventing a
number per source view is the failure this avoids.

**An abstention is a real answer.** No entity named, only one named, or two with
nothing between them → `answered: false`, `reason` says which, and `answer` and
`confidence` are `null`. The page tags it `warn`, not `crit`: declining to guess
is the behaviour, not a fault. **A recorded decline obeys the same rule**: the
query set scores its own declines `0.99`, which is certainty that it *cannot*
answer — reporting that in `confidence` would read as a 0.99 answer, so it stays
`null` and only the decline's text is shown.

**The blocks are rendered from scratch.** `AnswerBlocks.tsx` handles prose,
figures and tables; `AnswerChart.tsx` draws the charts as inline SVG — no chart
library, for the reason the ontology canvas has none. **The chart form is chosen
by the data's job, not by the `chart` field** (the package's own note says the
rendering team picks): `bar` → horizontal bars, `line` → a line with its peak
marked, a **2-slice `donut` → a meter** (a ratio is not a two-slice donut), a
`pie` of ≤ 4 → a 100% stacked bar, and a `pie` of more → bars, because past ~7
classes the answer is a table or bars and never more colours. One hue for
magnitude; the four categorical hues are a validated set and every segment is
directly labelled, since their contrast against the surface is below 3:1. Every
chart ships a collapsed **Values** table, so nothing is colour-only. Status tints
appear on a metric's `flag` and nowhere else — a share is not a state.

**Where it fails:** no `use_case_id` → 400 "choose a graph"; unknown id → 404;
a draft → 400 from `findBuiltGraph`; built but never published → 400 naming
Graph Studio; an empty question → 400. Every one of them is shown verbatim, so
each is written as a sentence to a user.

---

## Flow 10 — What-if: judging a load before accepting it

**Files:** `WhatIfPage.tsx` + `ScenarioColumn.tsx` + `PublishScenarioDialog.tsx` ->
`whatifStore` -> `GET /whatif`, `POST /whatif/resolve`, `POST /whatif/scenario`,
`POST|DELETE /whatif/saved`, `POST|DELETE /whatif/saved/:id/publish`. Data from
`09_What if lens/whatif_vls_data.json` via `npm run ingest:whatif`; the publish flow is
the package's v2 prototype (`what if lenses/`), whose copy that ingest authors because
the JSON predates it.

The question is "what would this load cost us", asked **before** the load is accepted.
A scenario admits a candidate generator hypothetically and the watched measures
recompute by traversal to its federal record: RCRAInfo evaluations and violations,
ECHO enforcement and penalties, an extracted consent decree. Nothing is predicted, and
nothing is written.

### A dataset can ship the lens instead of computing it

**CAPEX does.** It has no pool of candidates to admit — `generators` and
`candidate_pools` are empty, and its own `_not_applicable` block says why — so it ships
a rendered page, `frontend/src/Capex/what-if-lens/W1_what_if_lens.html`, and the What-if
page frames it in an `iframe` through the same `DocumentViewer` the Library uses for a
CAPEX report.

| | EPA | CAPEX |
|---|---|---|
| what a lens *is* | a traversal, computed per request | a finished document |
| where the figures live | `whatifScenario` on the server | inside the file, never transcribed |
| `whatif.document` | `null` | `{file, title, version, stage, heading, subtitle, tabs}` |
| the publish gate | applies — the lens overlays the published graph | applies too, on request: publish first, then the lens opens |

Three things to keep when touching this:

- **`publishedCount` is tested before `frame.document`**, and the server agrees rather than
  being second-guessed: it sends `document: null` while the gate is closed. The ordering
  was the other way round for one turn and was reversed on request — publish the graph,
  then Reports and What-if open. `check-docs` compares the indices.
- **The gate is satisfiable because the dataset ships the brief that names its graph.**
  `graph_use_cases` was empty while `graph_studio` held a whole canvas, so Studio listed
  nothing and neither section could ever open. `npm run ingest:capex` writes one committed
  brief derived from the dataset's own use-case template — never typed — and upserts it, so a
  draft of yours is not deleted. Building, reviewing and publishing stay in memory, so after
  a restart it is: Studio → Build (≈1m 33s) → settle 7 rows + the pivot → publish.
- **The row is read out of the document by `npm run ingest:capex`**, which owns
  `db.CAPEX.json` for the reports too — one writer per document. It reads the `<title>`
  stamp for the name, stage and version and the tab buttons for the tabs, and refuses to
  write rather than storing a row nothing can label. No title, subtitle or tab label may
  appear as a literal in the page or the viewer.
- **The fixture is already there and is not this script's to rewrite.** `slices`,
  `levers`, `locked_slices` and `program` are a verbatim extract of the same file; only
  `document` and `copy.tabs` are written, and `whatif` is spread rather than replaced.
- **It renders `seamless`: the document is the page, not a file on display.** No bar —
  so no Back, no **Export PDF** and no label restating the document's own title — no
  border on the frame, and three rules injected into it rather than edited in: `body`
  painted white, the publish dialog's scrim painted white (it washed the lens grey), and
  the page behind that dialog locked from scrolling. Losing the print button is the
  stated cost.
- **One scrollbar, and that took measuring the frame.** `82vh` plus the header plus the
  shell's padding overflowed the viewport, so the app scrolled *and* the document did —
  two bars at one edge. The frame is fitted to the viewport left below it: measured from
  its document-relative top, minus the space below it (never the shell's padding by
  name), before paint. It still **keeps a fixed height** rather than the content's,
  because the document positions its overlay and toast with `position: fixed` against
  the iframe's viewport — a content-height frame opens the dialog off screen for anyone
  scrolled down.

### It never writes back

The copy promises this three times, so the code keeps it: `POST /whatif/scenario`
computes and returns, storing nothing, and the saved library holds **generator ids,
never figures**. That is why computing is a call and not a calculation — re-open a
saved scenario next week and it shows next week's record. A store that cached the
numbers would cache an answer that quietly went stale, and `check-docs` asserts both
halves.

### Nothing connected shows the gate and nothing else

`GET /whatif` answers with empty collections, `facility: null` and `connected_sources: 0`
— but it still returns the copy, so the page has strings it must not print yet. Only
`PageHeader` is shared between the two branches; the pill, the "What this lens is built
on" banner, the tabs and the provenance note are all inside `WhatIfLens`, which renders
only when a source is connected. Otherwise the banner's "36 inbound generators" appears
one line above `NoSourceConnected`. `check-docs` asserts the gate names none of that copy
and the lens names all of it.

### Authoring sets the frame, in three steps

1. **Watched measures** — chips for the four governed measures, each showing the
   relationship it grounds to. Plus a text box: type a measure and the *graph* answers.
2. **Candidate pool** — which generators a scenario may draw from, each pool carrying
   its count, with a preview of the first 8. The Runtime dropdowns offer this pool and
   nothing else, which is what makes the step more than decoration.
3. **Review** — the frame in one sentence, and the read-only guarantee.

The rail is clickable **backwards only**: a later step's question depends on this one's
answer, so jumping ahead would ask it against nothing. Step 1 refuses to continue with
no measure watched, and step 2 with an empty pool — both with the reason, not a silently
disabled button.

### A measure must ground before it can be watched

`POST /whatif/resolve` gives one of three verdicts:

| verdict | what happens | example |
|---|---|---|
| `resolved` | the measure it grounded to is added | "inherited penalty dollars" -> MEAS:penalty_amount |
| `grounds_not_inherited` | nothing is added, and it says why | "tonnage" grounds, but measures the Manifest, not inherited risk |
| `refused` | nothing in this graph resolves it | "days of sunshine" |

**The keyword list is deliberately absent from `GET /whatif`.** A client holding it
could answer for itself, and the refusal would be theatre — so the graph is asked, and
`check-docs` asserts the list never reaches the payload. Paced like the suggesters: a
resolution that returns instantly reads as a lookup in a list the client already had.

### Runtime swaps loads inside that frame

Up to 3 columns, each `{ generatorId, name, savedId }`. Swap the dropdown and that
column recomputes. Each measure reports three different things — `inherited` (what the
load brings), `baseline` (what the facility already carries) and `value` (the sum, judged
against the appetite line) — and a measure with **no** baseline reports `null` rather
than `0`, because a consent decree is not something a facility keeps a running count of
and 0 would be a claim. A load that moves nothing says so instead of printing "+0".

Every figure cites its federal source, and the trace panel repeats them against the
specific records. A **clean** load says "nothing connects" rather than showing an empty
trace, which would read as "not checked". The **residual** — risk from records not yet
connected to a generator — is stated on every scenario.

**Headroom** is the inverse question: how many more enforcement-carrying loads fit
before the appetite line. The package states the formula, the ingest computes it per
pool, and the page prints it — arithmetic on a measure in a component would be a second
source for a number.

**The breach rule is real but currently unreachable**, and that is the data's answer:
the appetite is 10 actions, the baseline is 0, and the largest single load carries 4.
Headroom says 5 more loads. Do not manufacture a breach to exercise the red styling;
`check-docs` asserts CLAUDE.md and the roster agree about whether one load can cross it.

### Two graph references, both drawn

The pool step opens the **frame** (every candidate fanned into the facility, capped at the
package's 7 and saying so) and a runtime column opens the **traversal** (evaluations →
violations → enforcement → the generator → the TSDF, with any consent decree). Inline SVG in
`WhatIfGraph.tsx`, no library. The node types, their labels and their colours are
`graph_reference.node_types`; the frame's centre, edge and cap are `graph_reference.frame`;
and the scenario's nodes and edges come from the server with every edge label drawn from the
graph's declared relationships. **An absence has no circle** — a clean load draws no
enforcement node.

### A scenario is the frame plus its cases, and that is what gets saved

Step 3 asks for a **name**, because the scenario — this frame plus every case in it — is
the object the library holds and the publish dialog shares. There is no Save on a case:
the **scenario bar** above the compare strip carries Save/Update and Publish, and states
which of three things the runtime currently is (not saved · in library · published, with
its reader count). Opening a library entry loads its measures and pool back into
Authoring and **recomputes every case** — it stores loads, so re-opening is a computation
rather than a restore.

### Publishing shares the whole scenario, and both pools are the app's own

`POST /whatif/saved/:id/publish` records three decisions, each checked server-side:

| decision | pool | refused when |
|---|---|---|
| readers | `db.settings`'s users, served on the frame with their persona | empty, or an address the directory does not have — named in the refusal |
| graph | the graphs *currently published* | not live; the message names the ones that are |
| freshness | the presets `db.whatif.publishing` declares | unknown preset/unit/time, or a weekly custom schedule with no day |

`?as=<email>` says who published it, written every time — client-held identity, so the
route has to be told, and a re-publish that names nobody must stop crediting whoever went
last. A malformed `as` is a 400, never a quiet fallback.

**A case is never separately shareable**, and the dialog's first line says why: a figure
without its frame is a number without a question. Publishing an unsaved scenario saves it
first rather than refusing — the dialog needs an entry to hang off, and making the reader
press Save first would be the page enforcing its own storage model.

**Sharing is not access control**, in those words on the panel: the directory is real but
the role is client-held, and the API serves every scenario to a caller that names none.
Each reader's persona scope is **stated**, never applied — no roster here is filtered per
persona.

**A successful publish opens a receipt** — `PublishedConfirm`, over `publishing.done`.
It reads the stored publication back (cases and readers by name, the bound graph with its
build date, the freshness preset's own sentence) and states no figure, because the record
holds none. It opens on a **first** publish only, decided before the write; the link on it
is `published.link`, composed on the server. Its panel is exported apart from its `Modal`
for the same portal reason as the one below it.

`PublishScenarioPanel` is exported separately from the `Modal` that wraps it, for the
reason `ConnectSourceWizard` is: `renderToString` does not traverse a portal, so a check
about the dialog's contents would otherwise pass over nothing.

**Where it fails:** an empty typed measure -> 400 before the pace; a load outside the
pool -> 404 naming the frame, or a 400 naming the pool when a *case* leaves its frame; an
unwatched measure key -> 400 naming the step that adds it; a scenario watching nothing or
holding no case -> 400; a saved id that does not exist -> 404. Adding a case past
`compare.max` is refused with a sentence rather than a disabled button that does nothing,
and the last case cannot be removed — an empty compare strip has no control that would
bring one back.

Deleting a library entry leaves the runtime open, just **unlinked**: the reader was
looking at those cases. Unpublishing keeps the scenario, and says so.

---

## Flow 11 — Reports: the vendored authoring prototype

**Files:** `src/pages/ReportsPage.tsx` (the gate, the mount, and the governance it passes down) ->
`src/reports/**` (the prototype: `App.tsx` owns all state, `panes/` the three authoring steps plus
the library, `components/blocks/` the six block bodies, `data/dataset.json` the figures,
`reports-prototype.css` the styles) -> `src/pages/ReportsPage.css` (integration rules authored
here: the `.rp-host` margins, the portal scope class, and the Library's chip bar) ->
`GET /reports` for the publish counts, the published graphs, and `governance`.

**It is vendored, not written here.** `src/reports/` is a port of
`vls_demo_data_package_2026-08-10/repor code`, imported whole. Read its own README in the
package for how its state flows; the short version is that `App.tsx` owns the step, the prompt,
the four assumptions, the filters, the block list and edit mode, and the panes are
presentational.

### Four changes were made to it, and nothing else

Its `main.tsx` and `Sidebar` were dropped (this app has a sidebar, and the prototype's named a
different persona than the signed-in one); its `ToastProvider` and `MenuProvider` wrap the page
rather than the app; and its stylesheet was **scoped** to `.cw-reports`. That last one is not
optional — the original sets `*`, `body`, `button`, `h1,h2,h3`, `table`, `th` and `td` as bare
selectors and would restyle every other page silently. `check-docs` asserts it stays scoped and
that the page mounts it in a matching wrapper.

Its two authoring steps were also **paced** — `READ_MS` 2s for the read-back, and the build at
`BUILD_STAGE_MS` (**5s**) **per step**, ≈**25s** over the five — because both were instant, and an act that returns instantly
teaches that it is free. Client-side only because these steps have no request behind them; the refusal
for an empty question is not paced, and the timer is cleared on unmount.

**Build the report opens a dialog and narrates itself.** `buildStages()` (`src/reports/lib/buildSteps.ts`)
returns the five things composing a report does, each naming the value this run used — the graph, the rows
`selectRows` returned, the measure, the blocks — and `BuildRunDialog` lists all five from the first frame,
ticking each as it completes, then the report opens. The run is the list's length times the pace, so adding
a step lengthens it and no duration is typed into the component. A spine that is not the generator register
states its scope line rather than a generator count, because `selectRows` never selected against it.

**Unless the dataset ships the account itself — then the spec is framed instead.** CAPEX has one
specification page per report in `frontend/src/Capex/Steps-building-report/`, pointed at by
`reports.documents[].spec_file` (written by `npm run ingest:capex`, matched on the id **inside** the
spec rather than its filename, refusing a document with no spec or a spec with no document), resolved
by `reportDocuments.ts`'s fourth glob, handed to the prototype as URLs and framed by
`BuildSpecDialog`. The five steps still run in front of it, held for `SPEC_RUN_MS` (**10s**) in
*total* rather than `BUILD_STAGE_MS` each — a total, so adding a step shortens each row here where it
lengthens the narrated build, and `specStepMs` divides one by the other. The frame itself has no timer:
a document is paced by being read, so **Open the report** or Escape ends the wait and the draft is
composed on the way out. It is keyed to `specFor`, the report
the reader actually named, never `starter.id`: a typed question falls back to `STARTERS[0]`, and
framing the first report's spec over a question nobody asked of it is a document asserting the wrong
thing. A report with no spec narrates the five steps exactly as before.

It is also one of the two stylesheets exempt from the `--sp-*` rule — the graph viewer's is the
other, and `check-docs` holds the list at exactly those two vendored paths — and it carries a
**do-not-hand-edit** rule, so anything this repo
adds to the section is styled from `ReportsPage.css` instead, on the `--sp-*` scale, scoped under
`.cw-reports` so it inherits the prototype's own colour tokens. The Library's chip bar is the
current example.

### What is real and what is not

**Real:** the gate, and the whole Library — the five governed definitions, their lifecycle chips,
their four actions, who each is shared with, and whether the signed-in role may open it. The section
opens once a graph is published (the same precondition Ask and the What-if lens have, through the
same `NoPublishedGraph`) and the page reads `published_count` / `built_count` / `draft_count`.

**The report list is the tenant's five definitions, Reports 1–5, all seeded `published`** — the same
five the package's `07_reports` describes, which is also where the prototype's five authoring
starters come from. That shared origin is what makes **Open report** and **Edit report** work on a
row that arrived from the API: `fromGoverned` matches a row to its starter on `report_tag`.

**Four actions per row**, each offered only where it can be carried out:

| Action | Endpoint | Notes |
|---|---|---|
| Open report | — | loads the starter behind the row, read-only |
| Edit report | — | the same, in edit mode |
| Share | `PATCH /reports/governance/:id/audience` | `[]` is private, and private is a decision |
| Delete | `DELETE /reports/governance/:id` | drops the **governance row**; a re-seed restores it |

The same four are on the session cards, over the same dialog — but Share there writes `viewerRoles` on
the local row and nothing else: a session report has no governance row, so the dialog and the card both
say the choice stays in this browser.

### Publishing asks three things, and none of them is an approval

`PublishDialog` used to ask for a name and then state *"A Domain Architect approves before the audience
sees it"* — which stopped being true when publish → approve → activate collapsed to publish/unpublish.
The report went live immediately either way, so the dialog promised a step nothing performs. Both the
sentence and the toast that repeated it are gone, and `check-docs` asserts neither comes back.

| It asks | Stored as | Source |
|---|---|---|
| a **name** | `SavedReport.name` | reserved across the whole list by `nameProblem`, checked as you type |
| **who can open it** — people, from Settings' four users | `viewerRoles` (role ids) | `governance.people`, served |
| **how fresh** the figures stay | `SavedReport.freshness` (a preset id) | `governance.publishing.freshness` |

**People are picked; their role is what is stored.** `viewer_roles` is the audience model the
entitlement matrix and `?as_role=` already read, so an address there would be a second one. There is
no invite option: the personas are the pool, and offering to invite an address would promise a reader
this app cannot create.

**Each reader's scope is stated, never counted.** Beside the name is that persona's declared
`data_scope` row and its masked columns. A figure like "sees 32 of 36 generators" would claim a filter
no roster here runs — gate 2 is declared, not applied, which the Operations tab's own note says.

Every string in the dialog is served on `governance.publishing`, authored by
`npm run seed:governance`. The seed **refuses to write** a preset with no sentence, a default naming
no preset, a lead claiming an approval step, or a caveat missing "not access control"; `validateDb`
re-checks the same block at boot, because losing it renders a publish flow that asks for nothing
rather than throwing.

Publishing a session report keeps its readers in the browser — the prototype does not post its saved
reports — so the dialog gets `localOnly` and says so.

**It is one list, not two groups.** Governed definitions and session reports share a grid, told apart by
the card (`GovernedCard` / `SessionCard`) rather than by a heading. A session report answers to its own
*Saved here* chip — never the tenant's Published — and the chip counts come from the same `inState` the
grid filters with, because the server cannot count rows it has not been told about.

**A published name is unique.** `nameProblem` is the one rule, applied across the whole list; the publish
dialog checks live and Save draft checks before writing. Drafts may share a name, case and space do not
make a name different, and a report never collides with itself.

**Delete drops the governance row, and `npm run seed:governance` restores it.** That is also the fix when
a definition has gone missing from the list — the confirmation says so rather than promising "gone for
good".

**A missing report says so.** `governance.ungoverned` names every definition with no governance row and
the Library states them above the list with the served restore command, because a list that is merely one
card shorter reads as data loss. It also names the cause a re-seed cannot fix: **a mock server serving an
older `db.json` from memory.** That is the likely answer whenever the file and the screen disagree — and
`PUT /db` reloads a running server in place, keeping the in-memory publication that a restart would clear.

**The picker is a dialog at `App`'s root, not a panel in the card.** Inline it stretched its whole grid
row and left the sibling cards with their buttons a screen below their text; `LibraryPane` only opens
it. The governed grid also takes a wider column (`minmax(400px, 1fr)`) with `white-space: nowrap` on
the buttons, because four actions in a 330px card broke every label mid-phrase.

**There is no access gate on a row, and there was one.** A per-row `access` block decided whether the
signed-in role could open a report; a reader outside the audience saw *Request access* / *Access pending
approval* **instead of** the four actions. Removed on request, along with `POST /reports/access-requests`,
`db.reports.access_requests` and `requestReportAccess`. The audience is still stated on the row and acted
on nowhere.

`check-docs` guards the absence on **every layer at once** — server, client, card and stylesheet —
because a partial revival is the dangerous shape: a card gating on `access` while the payload no longer
sends one renders a row with no actions at all, which is the symptom that prompted the removal. Re-adding
it deliberately means deleting that claim in the same commit. `docs/REGRESSIONS.md` records what it was.

**None of it is access control**, and `SharePicker` says so on the page: the role is the browser's,
and the API still serves every row to a caller that names none. That is also why the gate's removal lost
nothing real.

The chip bar is `governance.statuses` from `GET /reports`: **All current** plus every state the
tenant declares (`Published` · `Pending approval` · `Blocked` · `Archived`), each with the count
`reportGovernanceView` computed, filtering the definitions above the shelf. With all five published,
three of those chips sit at 0 — which for a lifecycle means nothing is blocked, not a broken chip.
`ReportsPage` passes `governance` in, `App` holds the selected state, `LibraryPane` draws both. Three
rules hold it together:

- **The count is printed, never computed.** `LibraryPane` renders `s.count` and its `current` filter
  is the server's own rule (everything not archived), so bar and grid cannot disagree.
- **The chips do not reach the shelf.** A report saved in this browser never left it — the prototype
  does not `POST /reports/saved` — so it sits under *Saved in this session* and is not counted as a
  governed definition. Hosted, that shelf **starts empty**: the prototype's four seeded rows are its
  own fiction and would read as four more reports that do not exist beside the real five.
- **The prototype declares the payload's shape itself** (`Governance` / `GovernedRow` /
  `GovernanceState` in `App.tsx`) rather than importing `client.ts`, exactly as it does for
  `GraphOption`. Drop the props and it is the standalone prototype again.

**Not real:** every figure. The prototype renders its own `dataset.json`; nothing reads
`db.json` for a measure, nothing calls `/reports*` for a chart, and publishing inside it does not
leave the browser. The rest of the `/reports*` API is still served and still typed in `client.ts` —
see the **Reports** section of `CLAUDE.md` for what it guarantees — and wiring the figures is a
separate job.

### Where it fails

Nothing published -> `NoPublishedGraph`, naming the fix from the two counts. `GET /reports`
failing -> `ApiErrorAlert` with a retry, because the gate is the one thing here that can fail.
The prototype's own failure modes are its: an unrecognised question is read as the generator
register, and the field picker lists what the graph cannot serve with the reason attached rather
than hiding it.

### If you wire it to the API

The dataset's vocabulary is the tenant's — the same starters, scopes, measures and horizons as
`db.reports` — so the frame it builds is one `POST /reports/build` would accept. Start there,
and keep the two definitions from drifting.

## Flow 12 — Audit & Governance: who sees what

**Files:** `AuditPage.tsx` + `GovernedArtifactCard.tsx` + `AccessRuleEditor.tsx` ->
`governanceStore` -> `GET /governance`, `PATCH /governance/scope/:roleId`,
`POST|DELETE /governance/artifacts/:id/readers`, `POST /governance/artifacts/:id/unpublish`.
Copy from `npm run seed:governance`.

Two gates and a trail. The page opens once a graph is published — the same precondition Ask, the
What-if lens and Reports have, through the same `NoPublishedGraph` — because everything on it is
about published artifacts.

### Gate 1 — who can open it

Each published artifact lists its readers as **people**, and the server writes back to whichever
pool that artifact keeps: a **report** stores persona ids (`viewer_roles`), a **what-if scenario**
stores addresses. Neither is translated into the other, and each row says which it is. Adding
somebody to a report therefore names their persona — anyone else holding it is named too, and the
row states that rather than leaving it to be discovered.

**Unpublish appears only on a scenario.** That publication is a record this server keeps; a report
definition has no such act, and the refusal names the equivalent — an audience of nobody. Removing
the *last* reader of a scenario is refused for the same reason and points at unpublish.

### Gate 2 — what they see inside, recorded but not enforced

An access rule per persona: a **basis** (a field) plus the **values** it admits.

| | where it comes from |
|---|---|
| the bases | the register’s identity column plus every `fields.filterable` entry — derived, so a basis no report could slice by cannot be offered |
| the values | the roster’s own distinct values, each carrying how many rows it admits |
| the resolution | computed on the server against the live 36-generator register, naming the rows as well as counting them |

**Say it in these words: a rule is recorded, not enforced.** No roster in this app is filtered per
persona, so the resolution is what a rule *would* admit and never what somebody saw. The sentence
is served (`copy.not_enforced`), printed beside the rules, checked by `validateDb` on the phrase
rather than the key, and refused by the seed if it goes missing.

Two personas start `full` because their authored predicate is literally `TRUE`; the other two
start with no rule, because `receiving_facility` is not a column here and `FALSE` is the absence
of one. A persona with no rule says **“No rule authored yet”** — not “opens empty”, which would be
a claim about enforcement.

### The trail

What this server has seen: rule changes, readers added and removed, scenarios withdrawn — each
with who did it, from `?as=`. In memory, like publication. **Opens are absent and the page says
why**: nothing here serves a report to a reader, so an “opened” row would be an event that never
happened.

**Where it fails:** a basis the register does not offer -> 400 naming the ones it does; a value not
on the roster -> 400; an unknown persona -> 404; a reader outside Settings -> 400 naming the
directory; unpublishing a report -> 400 naming its equivalent; removing a scenario’s only reader ->
400 pointing at unpublish; a malformed `as` -> 400 rather than a quiet fallback.

---
## Flow 13 — Settings: users, personas and what each one sees

**Files:** `db.settings` (its own subtree of `backend/db.json`) + `backend/scripts/seed-settings.js` ->
`GET /settings` / `PATCH /settings/personas/:roleId/nav` / `POST …/reset` ->
`src/api/client.ts` -> `src/store/settingsStore.ts` (the one place visibility is decided) ->
`src/pages/SettingsPage.tsx` -> `src/components/settings/UsersPanel.tsx` and
`src/components/settings/PersonaPermissionsPanel.tsx` +
`src/components/settings/ReportPermissionsPanel.tsx` (all pure, so all assertable) ->
`src/nav.ts` + `src/components/shell/Sidebar.tsx` for the effect.

**The flow:** Settings → Persona Configuration → pick a persona → toggle a navigation item → the
sidebar changes on the next render, and the change is saved.

**And its twin:** Settings → Report View → pick a persona → toggle `open` / `edit` / `delete` → that
persona's Library rows offer those buttons and no others. Same shape throughout —
`PATCH /settings/personas/:roleId/reports`, `report_permissions` + `report_defaults` beside the
navigation pair, `reportActionsFor` as the one place the rule lives (the twin of `visibleNavItems`), and
`src/components/settings/ReportPermissionsPanel.tsx` pure and assertable. Two things to keep in mind
when touching it: the acts are declared once as `REPORT_ACTIONS` in `server.js` and re-declared in the
seed because a script cannot import the server, so `check-docs` compares them; and the gating is done by
**withholding a handler** in `src/reports/App.tsx`, never by a permission field on `GovernedCard` —
a card that tested one is the shape of the access gate this section removed, which rendered rows with no
actions at all.

**A dataset whose reports are documents:** switch to CAPEX in Settings → Dataset → Reports lists the
three rendered HTML reports. `src/Capex/Report/*.html` → `npm run ingest:capex` (reads each file's own
report registry, refuses on a missing field, carries `audience` forward) → `db.CAPEX.json`
`reports.documents` → `GET /reports` on **both** branches, because the publish gate is about questions and
a rendered document asked nothing of a graph → `src/data/reportDocuments.ts` resolves the filename to a
bundled URL through `import.meta.glob` → `DocumentLibrary` (four acts, Report View permissions honoured)
→ `DocumentViewer` frames it in an iframe. Two things to hold on to: the files stay in
`src/Capex/Report` with **one copy** — a duplicate in `public/` is a whole 2.5 MB report that can go
stale — and **Edit opens the authoring exploration**, which is what editing a finished document can
honestly mean.

A third: **their figures are rescaled, and the transform is `npm run scale:capex`.** The fixture inside
each file is a $152B, 4,500-project programme whose 60 projects are a 1.54% sample, so the Variance
Report opened on `$5.00B` where the demo's range is $50M. One factor (÷100) across every capital figure,
so every ratio the documents state stays exactly true; the tiles now read `$50.0M · $44.1M · −$5.91M`.
Because these are generated files that forbid hand-edits, the safety is in the script: literals found by
**path** rather than key name, every number in a report's own containers classified money or not-money
with an unclassified one refusing the run, the arithmetic (`periodVariance = periodActual − periodPlan`,
`sampleBudget` against the sixty budgets, the heatmap against both margins) re-checked on the file that
was written, and the prose figures — *"does not sum to $113.1B"* — listed one by one so `1.1 million
gallon` stays a volume. Platform spend and the unprinted five-year programme figures are left alone;
`check-docs` reads the tiles back out of all three documents, so a re-export in billions fails the build.

A fourth: **the frame is held until the document opens its report.** These files paint the prototype's own
sidebar, topbar and Knowledge-graphs screen while the 2.6 MB parses, because the style that hides them and
the script that opens the report are the file's last lines. `DocumentViewer` hides the frame
(`visibility`, so it keeps loading and stays measurable), names what it is waiting for, and reveals it when
the document's own `#v-reports` carries `on` — observed, not timed — or at `REVEAL_CAP_MS` if it never says
so, because a renamed view must cost a slow open rather than an empty frame.

**Where a report leaves the app:** open one from the Library → `Export PDF` → the browser's print
dialog. `window.print()` over the `@media print` rules in `PublishedReportPane.css`, which hide `body *`
and reveal `.prp` — there is no PDF renderer here, by dependency decision, and the hint sits in
`src/data/reportExport.ts` because a `Tooltip` portals out of `renderToString`.

**And where a *framed* report leaves the app:** `Export PDF` on `DocumentViewer`'s bar calls
`contentWindow.print()`, so the document prints as its own page and this app's print rules never come
into it. What that needed was `PRINT_CSS`, injected into the frame: the document is the prototype app at
`height: 100vh` with `overflow: hidden` and one scrolling `.content`, so printing clipped it at the
first sheet — `1/1` and cut mid-block, with nothing erroring and no sign in the file that pages were
lost. The injected `@media print` block unclips those three ancestors, keeps a card whole across the
fold, forces backgrounds so the bars print, and drops the head's own buttons and the fixed session
chrome that `position: fixed` would otherwise stamp onto page one.

### Its own key

`db.settings` holds only what this page administers — users, each persona's navigation access, and the
authored `defaults` those reset to.

**It was `backend/settings.json`, a file of its own**, on the reasoning that two stores with one job
each cannot damage one another: a settings write could not touch a report, and an ingest rebuilding
`db.reports` could not drop a permission. It was folded into `db.json` on request, so the separation is
now by key — and the guarantee moved to a stronger place rather than being lost. `settings` is a
`DB_SHAPE` key, so `validateDb` refuses a document without it and `commitDb` validates it before
**every** write, not just this page's. That covers the case two files never did: a writer that rebuilds
*some other* subtree and forgets to carry this one, which is how `db.reports.governance` was nearly lost.

`validateSettings` and `commitSettings` both survive, because the message is the point — the refusal a
permission needs names `npm run seed:settings`, not "restart the server". `commitSettings` validates for
that message and then hands the whole document to `commitDb`.

**It persists**: a permission survives a restart, unlike a registered source. `npm run seed:settings`
re-authors it — reading the whole document and replacing one key, because a script that owns a subtree
and rewrites its parent is how a subtree gets deleted — and the server refuses to boot on a bad one,
naming that command.

### What it stores and what it does not

**Stores:** the four users, the live permissions, the authored defaults, and the read-only rule.

**Does not store:** persona labels. `db.auth_roles` / `GET /auth/roles` is the one place the four are
declared, and the server resolves labels on the way out — so a rename reaches every surface at once.
`check-docs` fails if a label appears in `db.settings` or a user names a role the tenant lacks.

**Nor the navigation list twice:** the seed's `NAV_KEYS` is compared to `nav.ts`, so a key it has that
the sidebar lacks (a permission nobody can exercise) or one the sidebar has that it lacks (an item no
persona can hide) fails the build.

**Removing an item is four edits, and the seed's carry-forward is the one that bites.** `nav.ts` loses
the `NAV_ITEMS` entry, the `NavKey` and the icon import; the seed loses the `NAV_KEYS` key; then
`npm run seed:settings`. `defaults` is re-authored every run but `nav_permissions` is *kept* — those are
somebody's decisions — so a blind spread left the removed key alive in the live set while the defaults
dropped it, and `validateSettings` refuses that pair by name ("different navigation keys in defaults and
nav_permissions"). The carry-forward is narrowed to `NAV_KEYS`, so the seed cannot write a file the
server then refuses to boot on while naming the seed as the fix. Removing Knowledge Graphs found it.

### The login has no role picker

`POST /auth/login` takes `{ email, password }`. The persona is the one on that address's row in
`db.settings`, so an unknown address is **refused**, naming who is set up. The form used to ask, which
meant one address could sign in as any persona; `LoginPage` no longer reads `GET /auth/roles` at all.
Still not authentication — the password is length-checked and nothing more.

### Five rules the code has to keep

- **A group is a heading, never a permission.** `NAV_GROUPS` in `nav.ts` orders the three — Explore,
  Build & Configure, Trust & Operations — and `SidebarMenu` builds them from the list `visibleNavItems`
  returned, dropping any group left with nothing under it. A heading over empty space reads as a section
  that failed to load, not as one the persona may not open. `NAV_ITEMS` is in group order and the seed's
  `NAV_KEYS` is compared to it *literally*, so reordering the sidebar means reordering the seed and
  re-running `npm run seed:settings`.

- **One place decides visibility.** `visibleNavItems` in `settingsStore`; the sidebar filters through it
  and nothing else does. `App`'s mobile header reads the *unfiltered* list on purpose — it names the page
  you are on, and a hidden page is still reachable.
- **Settings belongs to Platform Admin**, on and **fixed** there, off-but-configurable elsewhere. The
  lock is enforced by the **server**, which refuses a change to a fixed key with a sentence rather than
  ignoring it — a disabled switch is a courtesy to whoever is looking at it, and any other path into the
  store could otherwise strand the one persona that can grant everything.
- **`defaults` and `nav_permissions` must carry the same keys**, and a locked row must be on in *both*.
  Reset copies the defaults over the live set, so a gap there arrives later rather than never. A break
  test found that hole.
- **Hiding is not authorising.** `/settings` is routed unconditionally, so a persona whose sidebar drops
  it can still reach the page — and the tab warns when that state is reached and names the URL. The Alert
  says "this controls what is shown, not what is permitted" in those words.

### Where it fails

`GET /settings` failing -> the page shows `ApiErrorAlert` with a retry; a failed *reload* keeps the
previous data and says so, and until the first load returns every navigation item is visible, so a slow
or unreachable server never empties the sidebar. A persona with no entry -> the server refuses to boot
rather than serving an undefined sidebar. An unknown navigation key or a non-boolean in a write -> a 400
naming the real keys.


## When a page is blank: `/doctor`

**Start here rather than reading code.** `/doctor` is the frontend's `GET /health` and it exists
because four unrelated faults look identical from the app: the API is unreachable, this bundle is
calling a *different* API, the `x-dataset` header is not arriving, or the tenant has published no
graph. Each row states the fact it read and the fix for the state it found.

| row | what it settles |
|---|---|
| Where this bundle calls the API | `apiBase()` and the mode — and `crit` when an https page names an http API, which the browser blocks with no server-side symptom |
| The API answers | port, uptime and the datasets validated at boot; `crit` names `npm run mock` |
| Which store the server read | `s3`, or `file` — `warn` behind an absolute base, because a remote box on local files is serving documents frozen at deploy time |
| The dataset sent vs answered from | `crit` on a mismatch, naming `access-control-allow-headers` — the preflight failure `curl` cannot see |
| The selected dataset exists | the persisted-selection failure that bricked the app once |
| Who this browser is signed in as | `crit` when the persona is one the tenant no longer has |
| Connected sources · Published graphs | the two preconditions, with `built`/`draft` so the fix names the right screen |

**Reachable when the app is not** — outside `RequireAuth` and outside `/:ds`, URL-only, changes
nothing. **Its verdicts are `diagnose()` in `src/data/doctor.ts`**, a pure function, so they are
asserted without rendering the page; the page renders what it returns and decides nothing. *Copy
report* renders the same checks as text. Add a check by adding it there — a `tone:` literal in the
component fails `check-docs`.

**Where it fails.** A row that inferred something the payload does not carry: a wrong diagnosis costs
more than a missing one, which is why the store row is *absent* rather than guessed when `/health`
did not answer, and why an unreadable persona pool strands nobody. The four calls are
`Promise.allSettled` — with `all`, one refusal would leave this page as blank as the page it is
diagnosing.


## Adding things

**A new endpoint**

1. Route in `server.js` (and its line in the header comment).
2. Response schema in `client.ts` — not optional; the boundary check is what
   turns a malformed payload into a readable message.
3. Fetcher in `client.ts`, mapping snake_case for any field the UI touches.
4. Store action returning `Result`, with the `try/catch`.
5. Component reads the store.

**A new page**

`src/pages/X.tsx` → route in `routes.tsx` → entry in `nav.ts` (`NavKey` *and*
`NAV_ITEMS`) → gate it on `connected_sources` with `NoSourceConnected` if its data
derives from a source.

**A new connector**

Entry in `data/connectors.ts` with its `fields`. `available: false` needs a
`reason`. Making it real means a step-2 branch in the wizard and server support;
`ConnectorIcon` needs a mark, or it falls back to BigQuery's.

Google Drive is the worked example of making one real — copy its shape rather
than inventing a third: `kind` on the record, its own preview/register/browse/
profile/dictionary endpoints, its own `PIPELINE`-length stage list, and a 400
from every endpoint of the *other* connector naming the right one. Reuse the job
machinery (`queueJob`, `runJob`, `objects`) instead of adding a second board.

**Verifying any of it**

`npm run preflight`, then an SSR smoke script for the behaviour — exercise the
failure paths, not just the happy one. Most of the real bugs found in this
codebase were wrong shapes and stale processes, and both show up only when you
check what happens when things go wrong.
