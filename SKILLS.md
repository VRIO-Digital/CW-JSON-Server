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

## Flow 1 — Connecting a source (BigQuery, Google Drive or Gmail)

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

**Step 1 is a searchable directory** — `ConnectorDirectory`, over a search box and a
`Filter: All / Available now / Product vision` select, with a card per connector and the count
on each section heading. `filterConnectors` in `src/data/connectorSearch.ts` is the predicate,
out of the component because this grid sits inside a `Modal` that `renderToString` will not
traverse. It searches the **name, blurb and type label** and nothing else: matching the `key`
would let `osipi` find OSIsoft PI, a string this app never shows, and matching the `reason`
would return vision cards for words that appear only after one is clicked. A search that
matches nothing names the query rather than saying "no connectors".

**The two sections survive the search, and that is the point of them.** Available registers a
source; vision explains why it cannot. One flat grid ordered by relevance would let a reader
click three cards in a row and be told "not yet built" three times, so the search narrows
*within* the sections and a section left empty is dropped rather than drawn as a heading over
nothing.

Eleven connectors from `CONNECTORS`, and **six of them are pickable** — the two kinds of
pickable card sit in one section, because a third heading was removed on request:

| section | connectors | what clicking one does |
|---|---|---|
| *Available now — pick one* | **Google BigQuery**, **Google Drive**, **Gmail** | consent → preview → finish, and the source carries a catalogue |
| | **MySQL**, **PostgreSQL**, **Snowflake** | step 2 asks for that engine's own connection details; Finish registers the source and nothing profiles it |
| *Product vision — not yet built* | **Microsoft Outlook**, SAP PM / S4HANA, OSIsoft PI, SharePoint / docs, SQL database | shows its `reason` rather than doing nothing |

`Continue` is disabled until an available card is picked — an unavailable one sets `blocked`
instead of `selected`, which is what draws its reason.

**Which of the six carry a catalogue is stated on the cards, not by the heading.** Each database
card's blurb reads *"registers a connection — no profiler yet"*, on the grid beside its name;
`check-docs` asserts it on all three, because with one section for both kinds that line is the
only thing telling a database card from BigQuery. `connectorGroup` still derives the three
groups from `available` and `profiles`, and its one remaining reader is the step's note.

**The step's own note names the connectors in each group rather than counting them**, composed
by `connectorPickerNote` from the directory: a count goes stale the day a fourth lands, and a
group with nothing in it contributes no sentence. It read *"the rest below are product vision
only"* until a database card could be clicked.

**Outlook is vision because of the corpus, not the API.** Microsoft Graph's mail endpoints
are the easy half; what a mail connector has to produce here is a mailbox with an address,
a set of filing labels and correspondence a question can be read against. Gmail derives all
three from things this tenant really holds — `settings.users`, Gmail's own six labels, and
the recorded answers whose runtime citations name it. There is no Outlook equivalent, and
both ways to fake one are dishonest: reusing Gmail's labels puts Gmail's filing on a
Microsoft mailbox, and inventing folders puts mail in the console nobody sent. The mail
pipeline itself is connector-agnostic and would be reused as-is.

**Gmail is profiled for its catalogue and read at question time.** Connecting proves the
credential reaches a mailbox and records what it was pointed at: which labels, which
optional Gmail search. Profiling is a second act,
started from the Data Catalog, exactly as it is for a project or a drive — see Flow 3. It
runs the same consent → preview → finish path as the other two:

| step | call | what it does |
|---|---|---|
| consent | `GET /sources/oauth/start?provider=gmail` | asks for `gmail.readonly` and nothing else |
| | `GET /sources/oauth/callback` | who signed in, plus a session |
| | `GET /sources/oauth/mailboxes?session=&as=` | the one mailbox that consent reaches, and a handle for it |
| preview | `POST /sources/gmail/preview` | the labels this handle can see. Registers nothing |
| finish | `POST /sources/gmail` | registers `gmail:<mailbox>` with the labels and the query |

The mailbox is the **signed-in person's own**, derived from `settings.users` rather than
held in a key beside it: a consent reaches the account that granted it, so there is no
mailbox data independent of the directory. `/sources/oauth/mailboxes` returns that one
and refuses an address the directory does not have, naming who it does. Labels are
Gmail's own six and nothing else — what the preview's heading calls them.
Step 2 asks for **nothing** — no source name and no mailbox picker. A mailbox already
carries a name the tenant wrote, so the wizard sends `display_name`; the endpoint still
validates it like the other three. The mailbox is the signed-in reader's own where the
tenant ships it, otherwise the first.

There **is** a profiler — `MAIL_PIPELINE`, five stages like the other two — so `sourceRow`
reports `profilable: true` and the Data Catalog lists a mailbox beside a project and a
drive. **What it profiles is the attached document, never the message**: a mailbox's
documents are the files that arrived in it, and nothing samples a message body. What is
unchanged is where that profile may travel: `gmail` is still the one member of
`RUNTIME_KINDS`, its extractions are observations resolved at question time, and nothing in
its catalogue becomes a graph element. The overlap between the two maps is declared in
`CATALOGUE_ONLY_KINDS` and both drift directions are refused at boot.

**The attachments toggle is gone — removed on request — and its whole apparatus with it.** It
was *recorded and not acted on* while nothing read the attachments, then briefly decided whether
the source had any documents at all; that made an empty tree ambiguous, so the profile route
refused such a source by name and `attachments_in_scope` was served so the browse panel could
tell a decision apart from a mailbox that simply carries none. Both messages that apparatus
printed ended *"re-run the connect wizard to include them"* — impossible to carry out with the
toggle gone, the same fault as the orphaned name gate above — so attachments are now always in
scope and an empty list has one cause left.

**Its allowlist cannot be changed afterwards.** Labels are settled by the consent, so there
is no `PUT /sources/:id/labels`; the Sources row's Edit button is disabled saying so, and
`wrongScope` refuses the two allowlist routes with the same sentence. Re-run the wizard to
change them.
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
  [account step]   → one row per account THAT RESPONSE reported; picking one signs in as it
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

**The accounts it offers are `start.accounts`, the tenant's own directory.** It offered exactly
one — the browser's, out of `useAuthStore` — and explained why there was no second. There is a
second now, and a third: `db.settings.users`, served on the same response as the scopes and
rendered as returned. The objection the single row answered is unchanged and still met — a chooser
listing *invented* people would be a claim about who has signed in to Google — and this is the same
pool `/sources/oauth/mailboxes` refuses an unknown address against, so no row here is one the
handshake would turn down. The reader's own is **marked**, never sorted to the top; there is no
*Use another account*, because this window cannot create one.

**Picking a row is what the connection is made as.** `connectingAs` (`chosenAs ?? signedInAs`) is
the single definition, read by the `as=` on all three callbacks, by Gmail's mailbox match, and by
the *Connected as …* alert — and a new handshake clears the pick, so a cancelled sign-in leaves no
stale account behind. The alert's own rule is untouched: the **client's** answer beats the payload's,
since the login authenticates by shape and the server has nothing to look an identity up from.

**And the console becomes that person.** The callback answers with `identity`, the directory row it
resolved through `identityFor` — the login's own lookup, so the two can never report different
personas for one address — and `adoptConsentIdentity` hands it to `useAuthStore.adoptIdentity`.
Every reader of that store moves at once: the sidebar's address, avatar and persona, which pages it
lists, what a Library row offers, whose chat history Ask shows, and every `saved_by` /
`published_by` / `?as=` field. It takes the **whole** identity (an email without its persona is one
person's name under another's navigation), it moves `activePersonaId` as well (`syncActivePersona`
adopts only when none is active, so a live session would keep the old sidebar), it does nothing for
an address the directory does not hold, and it is announced by `IDENTITY_SWITCH` naming both people
and the way back. `check-docs` asserts all five layers in one claim.

Its footer states that it proves the request is well-formed, not that a real Google account is
behind it — the same honesty the login page carries. `check-docs` asserts the window keeps no scope
list and no directory of its own, and that the `provider` it is given is a three-way lookup: as a
pair (`isDrive ? 'drive' : 'bigquery'`) it drew Gmail's sign-in narrating BigQuery's stages.

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

### The credential branch — MySQL, PostgreSQL, Snowflake

**The steps are the same three; what differs is that there is no Google in them.** Step 2 is the
generic field loop over `selected.fields` — one `Form.Item` per declared field, with
`fieldControl(field)` as the child antd wires — and step 3 is a check plus `POST /sources/generic`.

**Each engine's fields are its own, which is why these are three cards and not one Engine dropdown**
(that dropdown is what is left of the `sql` card, now narrowed to *MSSQL · Oracle*):

| | MySQL | PostgreSQL | Snowflake |
|---|---|---|---|
| addressed by | Host + Port (3306) | Host + Port (5432) | Account identifier — **no host, no port** |
| reads | Database | Database + optional Schema | Database + Schema, on a Warehouse, through a Role |
| transport | TLS mode (MySQL's own five) | SSL mode (libpq's own six, in libpq's spelling) | — |
| identity | Username | Username | Username + Role |
| secret | `secret://…` pointer | `secret://…` pointer | `secret://…` pointer |
| Sources row prints | Host · Database | Host · Database | Account · Database |

**No password field on any of them.** Step 2's alert promises the raw secret is never persisted, and
a password box under that sentence would make the sentence false. `check-docs` asserts the absence.

**Which two cells the Sources row prints is declared, not guessed.** `accountField` and `scopeField`
name a *field*, so the wizard reads the value out of the form and a card cannot state an account it
never asked for. Both optional; absent means the row prints an em dash, which is what a generic row
did before — `0 dataset(s)` would say the source reaches nothing rather than that a dataset count is
not what it has. They replaced `values.clientId`, a field name **no connector declares**, so that
cell was `undefined` for every generic source however much the form collected.

**Step 3's check says what it checked.** It read *Run connection test* → *Connection succeeded*: a
claim about a database, made by a 900ms timer. That was scenery while every connector here was a
stub; it is a false statement with a real host and TLS mode typed in above it. Nothing in this repo
holds a database driver, so it is *Check these details* → *These details are well-formed*, and the
alert **names where the connection is actually proven** — the first time something reads from the
source. Then *Connect source* registers it and the dialog closes.

**Where it fails:** a name under `SOURCE_NAME_MIN` → the server refuses with the length, exactly as
it does for the Google connectors. A missing required field → antd highlights it and `Continue` does
not advance. `Connect source` stays disabled until the check has run — the same deliberate second act
`force` is on a profiling run.

**And what a registered database source cannot do, it cannot do loudly.** Nothing profiles it: the
Data Catalog leaves the row out and counts it in words, step 2 of the New Graph wizard never lists it
(that step lists profiled state), and asking it for a model is refused by `wrongStructuredOnly` naming what it
holds. Giving one a profiler is a `PROFILERS` entry, a `CATALOGUE_ROUTES` row and flipping
`profiles` — and `connectorGroup` then moves the card into *Available now* by itself.

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
| Delete | `DELETE /sources/:id` | removes it, its profiled objects and their notes, **and gives back the acceptances its Data Modeling declarations carry** (`releaseDeclarations`). No undo |

**Delete is the only act that can return a relation to *Curated by AI*.**
`POST /data-model/entities` deliberately carries a stored `confirmed_by` *forward* where the caller
sends none — so editing a rationale cannot strip somebody's acceptance off a row — which means
nothing in the ordinary flow can undo one. A deleted source is meant to be profiled, suggested and
reviewed again from the top, so its declarations' `confirmed_by` is cleared: the entity's and each
relationship's, scoped to the tables that source had **profiled**, both ends, the way
`POST /data-model/relationships/accept` scopes the act that granted them. The declarations
themselves stay — they are keyed by `table_key` because they are facts about the tables.

**Where it fails:** wiring it to Disconnect. That act is advertised as reversible and `Reconnect`
keeps every profiled object, so clearing a curator's work there breaks its one promise — `check-docs`
asserts the absence beside the presence. And dropping the registration before the write, which would
delete a source and then fail on a document the commit refuses. Verified against a live server on a
scratch copy: 18 tables profiled, delete released `{entities: 1, relationships: 59}` with all 18
entities and 59 relationships still in the document; a two-table profile released exactly the one
relation between them; disconnect released nothing.

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

**Gmail files:** `MailBrowsePanel.tsx` → `useMailBrowseStore` →
`ProfiledMailDocumentsPanel.tsx` → `useMailDocumentsStore` → the same `ProfilingJobsTab`.

### The source list

Left column, one card per connected source **that carries a catalogue** — the list filters
on the served `profilable`, and the sources it leaves out are counted in a sentence below
it, because a list that is merely shorter is not a message. What it leaves out is the four
stubbed connectors; all three real ones are catalogued.

**The nouns on this page are declared per connector, in `src/data/catalogUnits.ts`.** It
described itself with nine `isDrive ? a : b` ternaries — two tiles of labels, two of counts,
both button labels, both panel keys, the list meta and the foot sentence — and each `false`
branch drew a mailbox as a BigQuery project, so a reader would have been told a mailbox had
"0 tables profiled" in a "GCP project". The fallback for an unknown kind is **`null`, never
another connector's row**: such a source is left out and counted, because a default that
misidentifies is worse than one that is plain.
 **The `source_id` leads and the name
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

`check-docs` asserts the removal on all six panels at once (no `CloseOutlined`, no
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

`GET /sources/:id/browse-mail-documents` is the Gmail twin, and it is **three levels**:
the labels the wizard picked, the messages under each, and **the documents attached to
those messages** — which is what a run acts on. Leaf keys encode `label::document`; a
message carries no key of its own, because it is a container. Its line is the
correspondent and the date, named by *direction* since "from" on a sent message is the
reader themselves, and it states its document count — **`no attachments` where it has
none**, rather than being dropped, because which mail carries documents is most of what
the panel is read for. Such a row is also not `checkable`: antd would let it be ticked
and the run would receive nothing for it, which reads as a selection that was ignored.

One message sits under exactly one label even though Gmail's overlap: a profiled record
is keyed `{parent_id, object_id}` with the label as parent, so a message reachable under
two would put its documents in reach of both and commit twice. The others it carries are
on the row.

**The wizard's attachments toggle is gone (removed on request), so an empty tree here means
the mail carries no files and nothing else.** While it existed, `attachments_in_scope` was
served rather than left to be inferred, because a source connected with attachments excluded
looked exactly like a mailbox that carries none: one was a decision with a remedy and the
other a fact about the mail. The panel drew the difference and the profile route refused such
a source by name. All three went with the control — its remedy was to re-run the very wizard
step that no longer offers it.

Ask the wrong one and you get a **400 naming the right endpoint**, not an empty
tree — an empty tree reads as "nothing to profile" and sends you debugging the
allowlist. Same for `columns` vs `documents` vs `mail-documents`, and `profile` vs
`profile-documents` vs `profile-mail-documents`. Nine guards, one declaration:
`CATALOGUE_ROUTES` in `server.js` says which routes each kind answers on and
`wrongConnector` reads it, because at three connectors a pair of names written into each
guard stopped working — that is exactly how a mailbox came to get the empty dataset list.
Its `holds` nouns are qualified (*drive documents* / *mail documents*) because both hold
documents and "holds documents, not documents" names nothing.

### Start Profiling

```
POST /sources/:id/profile             →  202 Accepted, job status "queued"
POST /sources/:id/profile-documents   →  202 Accepted, job status "queued"
POST /sources/:id/profile-mail-documents  →  202 Accepted, job status "queued"
```

**It does not do the work.** The response is a queued job. The server then walks
it through five stages on timers — which five depends on the connector, because
extracting text from a PDF is not sampling a column, and grouping a thread is
neither:

```
queued                      queued                          queued
  → 1/5 Schema fetch          → 1/5 Text extraction           → 1/5 Attachment fetch
  → 2/5 Statistics sampling   → 2/5 Chunking                  → 2/5 Text extraction
  → 3/5 Class inference       → 3/5 Entity extraction         → 3/5 Entity extraction
  → 4/5 PII detection         → 4/5 Document PII detection    → 4/5 Document PII detection
  → 5/5 Candidate keys        → 5/5 Topic classification      → 5/5 Topic classification
complete                    complete                        complete
```

All three are **five stages on purpose**, so a job row reads the same whichever
connector ran it.

**A re-run from the jobs board switches on `job.kind`** rather than testing for one:
while there were two connectors, `kind === 'gdrive'` and "everything else" coincided, and
that `else` names BigQuery's endpoint *and* its field names — so a mail job re-run down it
posted `{dataset_id, table_id}` to `/profile` and got *"holds messages, not tables"* back.
An unhandled kind says so instead of picking a door.

Objects are committed to the source as stages pass, so `profiled_tables` /
`profiled_columns` — or `profiled_documents` / `profiled_entities` for **both** unstructured
connectors — climb *during* the run rather than jumping at the end. Mail reports documents in
the same fields a drive does, because they are the same unit; a `profiled_messages` beside
them was two fields for one noun. A count is `null` on a connector that has no such unit,
never `0`: `profiled_documents: 0` on a BigQuery source would say a project holds no
documents rather than that documents are not what it holds.

**And `profiled_today` rides beside them, with the date it means.** One function,
`profiledToday`, reads the real `profiled_at` stamps `commitNextObject` wrote and counts
the ones filed under today — so it is a count of runs, not a synthesised figure, and a forced
re-run moves the stamp, so re-profiling today counts today. **One definition and one reader**:
it is Gmail's fourth tile, and the mail dictionary deliberately does not compute it again. The
boundary is *served* (`profiled_today_date`) because it is the server's day: a tile saying
"today" over a box in another timezone is a claim the reader cannot check, and a component
reading its own clock would disagree with it by a day.

A job's work list is `objects`, never `tables`: `{parent_id, object_id, label,
units, state}`, plus `unit: 'table' | 'document'` and `kind` on the job. One board shows runs
from all three connectors, and `unit` is what it prints — **three kinds, two units**, because
Drive and Gmail both profile documents and what differs is where the profiler found one. Both
are declared once in `client.ts` (`PROFILE_KINDS`, `PROFILE_UNITS`) so the TypeScript union and
the `oneOf` schema cannot disagree — the `OAUTH_PROVIDERS` bug, where a widened union with an
unwidened schema refused a correct payload and blamed the server. A re-run sends the objects
back to the endpoint the job's `kind` came from.

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
  shared by all three panels so they differ only by the noun) turns it into a confirm
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

**What a curator does with this dictionary is Flow 14** — the Catalog's third tab reads exactly
this payload and lets somebody say what each table *is*.

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

### The mail document dictionary — the same idea, on what arrived by email

**Files:** `ProfiledMailDocumentsPanel.tsx` → `useMailDocumentsStore` →
`GET /sources/:id/mail-documents` → `mailDocumentDictionary()` in `server.js`

Facet chips (All / Needs review / PII, then one per **label**), then labels → collapsible
document cards → the entity table: `ENTITY · TYPE · CLASS · PII · OCCURRENCES · COVERAGE`.
Each card head carries the file kind through the shared `fileKind()`, the filename, **the
message it arrived on** and the correspondent — named by direction, since "from" on a sent
message is the reader.

**The unit is the attached document, not the message.** A mailbox's documents are the files
that arrived in it; the mail is the container, and nothing samples a message body. That is
why the card names its message at all: a document in a mailbox is not self-locating the way
one in a folder is, the corpus reuses filename stems, and who sent it is how a reader tells
two `signed-agreement.pdf`s apart.

**Its type chips are Gmail's labels, so there is no `DOC_TYPE_LABEL` twin to keep in step.**
A drive document's kind is a slug that has to be given a label somewhere; a mail document's
grouping *is* the label its message was filed under, which is real data with a name of its
own. The keys come from the source's **allowlist** rather than from the profiled subset, so
the chips do not appear and disappear as profiling progresses — a label with nothing profiled
yet reads as 0 of something real, exactly as the drive dictionary's do.

**Each card says the document resolved *nothing*, and that is the one real difference from a
drive's.** A drive document's resolution is the point of profiling a filing. Mail is a runtime
source, so `mailDocumentDictionary` carries **`observation: true`** and the row reads *read at
question time — these extractions are observations about subjects the graph already holds, and
none of them becomes a graph element.* A resolved node here would be the fact-set merge this
connector exists not to make, arriving quietly through the catalogue. It is a **sentence rather
than a blank** for the same reason a drive document that resolved to nothing gets one: a reader
comparing the two dictionaries would otherwise read the absence as a resolution that failed.

Everything else mirrors the drive dictionary and should not be "fixed" apart from it:

- **The facets count documents, not entities.** A document is the unit a curator reviews, so
  `all` is the profiled-document count and `pii` counts documents holding at least one PII
  entity.
- **The editable note is the document's `summary`.** `PATCH /sources/:id/mail-documents` stores
  it against `label.document` and flips `summary_status`, which decrements **Needs review**.
  Extracted entities are read-only machine output.
- **The entity list is synthesised** from `document_vocabulary` — the same pool, because what an
  extractor pulls out of a signed agreement does not depend on whether it arrived in a drive or
  an inbox — sliced by hashing the document id, with `coverage_pct` over `chunks`
  (`size_kb / 40`), since an attachment states no page count.

**Today's count is deliberately not on this payload.** It is Gmail's fourth **tile**, read off
`sourceRow`, and `profiledToday` is its one definition; counting it again in this handler would
be a second implementation of one figure with no second reader — the duplication that lets two
surfaces answer one question differently.

**The corpus behind all of it is synthesised, and four things in it are not.** No dataset ships
a message or an attachment — `findMailbox` derives the address, the name and Gmail's six labels
from `settings.users` — so `mailboxMessages` and `attachedDocuments` synthesise them by hashing
ids, deterministically. What is not invented: the **people** are `settings.users` (a mailbox
full of colleagues nobody has heard of puts strangers in the tenant directory — the objection
that deleted the `mailboxes` key); the **labels** are Gmail's own; the **dates** are anchored to
the source's `registered_at` rather than `Date.now()`, since mail predates the connection that
read it; and the **file kinds** are ones `fileKind()` renders (`application/pdf`, `text/csv`,
`text/plain`), because an Office mime type would arrive on a chip as
`VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET`. `MAIL_SUBJECTS` and
`MAIL_DOCUMENT_STEMS` are authored in `server.js` beside `GMAIL_LABELS` and are deliberately
administrative and dataset-neutral: a subject or filename naming hazardous waste would be a
claim about EPA's mail that CAPEX's mailbox would repeat, and a figure in one would be content
nothing has read. `check-docs` asserts the subject pool holds no address and no digit.

### Reviewing what is pending, and accepting it in one act

**The *N suggested, pending* tile opens the review.** Clickable above zero only; the tile and the
modal are handed the same filtered array, so the figure and the row count are one fact.

| | what it shows |
|---|---|
| per row | the relationship's own name, the join (`e_manifest.generator_id → e_manifest_all.generator_id`), the cardinality, the provenance badge, the confidence **labelled by kind**, and the run's reasoning |
| grouped by | kind — *Recorded in this dataset* and *Curated by AI*, each with its own count and note; a kind with nothing in it draws no heading |
| per row acts | **Confirm** (writes it) and **Reject** (drops it from the run — nothing is stored, so nothing is deleted) |
| footer | **Accept all · N**, with the sentence saying it goes one at a time and stops at the first refusal |

### The *N relations* tile

**The twin of the tile above, and it answers the question this tab otherwise could not.** Entity
detail shows one table's declarations at a time and the canvas draws them as edges with no list
behind them, so *what are my nineteen* had no surface. Same rules: clickable above zero only, the
tile and the modal handed the same array, the body exported apart from its `Modal`, copy and
grouping in `src/data/confirmedRelationships.ts`.

| | what it shows |
|---|---|
| per row | the relationship's own name, **one** provenance mark — *Confirmed by you* where somebody accepted it, *Curated by AI* where nobody has — the join, the cardinality, the evidence in words, and the rationale |
| grouped by | the **from** table — where `relationshipWrites` anchors the declaration, so the heading is a claim about storage rather than a display choice; each heading prints its own count |
| per row acts | **Accept** (records it as yours; withheld where somebody already has) and **Reject** (removes the declaration and puts the row back with the suggestions, **pending**). Clicking the row itself still opens the relationship dialog, so editing and deleting stay on the one dialog the canvas edge already opens — both buttons stop the click |
| top bar | **Accept all · N** over the *undecided* rows (`unacceptedRelations`, one definition for the count and the run) — **one request, one commit** (`POST /data-model/relationships/accept`), all of them or none, with the note saying so. Drawn only while something is undecided; otherwise Close alone with the sentence saying where the *other* acts are. **No *Reject all***: what kept a bulk act off this surface was deletion, nineteen removals behind one press, and that reasoning is unchanged |

**Stored is not confirmed.** `provenance` was the literal `'human'` for every stored declaration, so
all 31 across the two documents read *Confirmed by you* to whoever was looking — a claim about the
reader that was false for every one. A stored relationship carries **`confirmed_by`** now: nullable,
absent on everything written before it existed, the browser's address (client-held identity, so the
caller sends it), and **carried through every edit** — a write hands the server the whole
relationship, so omitting the field would strip the name off and silently un-accept the row.
Accepting a suggestion credits the reader on all three paths (single confirm, Accept all, the
dialog).

**No confidence on a confirmed row.** A declaration is somebody's decision, and a score under it
would put a classifier behind a person's judgement — the row states its `evidence` in words instead.

**The *pending* dialog's Accept all re-reads the entities between writes.** `relationshipWrites`
reads the owning entity's current relationship array, so a loop over one snapshot makes every accept
erase the last — and where the owner is undeclared, the second accept is refused outright because
that branch mints a new anchor entity. Verified against a live server: one snapshot kept 1 of 2
relationships and took a 400; re-reading per accept kept both.

**The *relations* dialog's Accept all is a different act and needs none of that** — it is one request
that writes `confirmed_by` on rows which already exist, resolved whole and committed once, so there
is no array to rebuild and no anchor to mint. Confirming a suggestion writes a declaration; accepting
a stored one puts a name on it. Do not merge the two runs.

**Where it fails:** the run stops at the first refusal and `acceptAllOutcome` reports what landed —
`4 relationships confirmed, then the run stopped: <the server's own words> 5 still pending.` Each row
leaves the pending list as it lands, so the unreached ones are still there to retry. A run that
confirms nothing is an error and never claims a write.

**Files:** `src/data/pendingSuggestions.ts` (copy, `groupPendingByKind`, `acceptAllOutcome`),
`src/components/catalog/PendingSuggestionsPanel.tsx` (body exported apart from its `Modal`),
`DataModelTab.tsx` (`pendingRelationships`, `acceptAllPending`).

### Suggested relationships — recorded, then derived

**Curated by AI** — the button — serves two kinds and says which is which. It takes the *derived*
kind's own name, which is a product decision rather than a description of the run: the label is
declared once as `DERIVED_LABEL` and printed by the badge, the review's heading and this button,
so the three cannot drift. **The name does not spread to the recorded kind**, which the run also
serves and which is never called AI — the note above the canvas names both counts for that reason.

| | recorded | derived |
|---|---|---|
| comes from | `data_model.suggestions` in the document | a column scan over the profiled dictionary |
| carries | the relationship's own name, 2 alternatives, a paragraph of reasoning, a stated confidence | `LINKED_BY_<COLUMN>`, two alternatives, the distinct counts the profiler recorded |
| `evidence_kind` | `recorded` → *Recorded in this dataset* | `structural` → *Structural analysis* |
| confidence is | *Stated confidence* — an opinion written down | *Classifier confidence* — the profiler's score for the weaker column |
| badge | **Recorded** (purple) | **Curated by AI** (purple) |

**A recorded suggestion wins.** Where one exists for a pair — either direction — the derived row for
that pair is dropped, because two rows for one join ask the reviewer the same question twice. The two
counts ride on the payload and `suggestionRunNote` turns them into the note above the canvas, which
keeps saying **no figure is invented** for both kinds. It said *"no model ran"* until the derived
badge was renamed **Curated by AI** on request; `degraded` still answers that question honestly on
the payload — `true` for both kinds — and it answers "did a model run", not "is this any good".

**EPA ships five, one per cardinality plus a second 1:1** — authored by `npm run seed:data-model`,
every figure in their rationales read out of `column_profiles` at write time rather than typed:

| | join | why |
|---|---|---|
| `1:1` | `e_manifest.manifest_tracking_number` ⇄ `e_manifest_all.manifest_tracking_number` | 1,200 distinct over 1,200 rows on both sides |
| `1:1` | `FRS_Facility_profile.registry_id` ⇄ `RCRA_Compliance_Summary.registry_id` | 49 over 49 — a profile and its summary |
| `1:N` | `FRS_Facility_profile.registry_id` → `RCRA_compliance.registry_id` | 49 unique facilities, 364 line items |
| `N:1` | `e_manifest.des_facility_id` → `FRS_Facility_profile.pgm_sys_id` | many manifests, one TSDF — and the id has exactly one distinct value, which the rationale says |
| `N:N` | `e_manifest.generator_id` ⇄ `e_manifest_all.generator_id` | both carry it, neither is unique on it — **confidence 0.61**, and its rationale says to re-point it |

That last row is there on purpose: a suggester whose every suggestion is good makes the review queue
theatre, and this one is a real join that a reviewer should decline or move.

**Where it fails:** a suggestion naming a table or a column the document does not carry → the boot
refuses it, because it would be offered and then refused on Confirm; two suggestions sharing an id →
refused, since the tab keys a pending row by it; a column joined to itself → refused. A secondary
dataset carries `suggestions: []` — these name EPA's views, and authoring them under CAPEX would
describe tables it has never heard of. Re-author them with
`node backend/scripts/seed-data-model.js --suggestions`, which leaves the declarations beside them
alone.

### Uploading a schema or a data dictionary

> **The upload is a showcase — the file is not read.** Picking a dictionary makes the server answer
> with the *dataset's own* tables and columns out of `column_profiles`, and Start Profiling runs over
> **every table of that dataset** (CAPEX's `plan`: 18 tables, 407 columns, on every press). No bytes
> leave the browser, nothing is committed, and `added`/`dropped`/`stranded_declarations` come back
> empty because they genuinely are — this upload replaces no column list. The panel says *accepted*,
> never *read as CSV*. `parseSchemaDocument` and `resolveSchemaUpload` are dormant, not deleted, and
> still verified by `npm run verify:schema-import`; the rest of this flow describes them.

**Files:** **Upload Files**, on each dataset row of a BigQuery source's browse tree →
`DatasetDictionaryUpload.tsx` (`DictionaryUploadControl`) →
`useSchemaUploadStore` → `POST /sources/:id/schema/preview` and `POST /sources/:id/schema` →
`resolveSchemaUpload` in `server.js` over `backend/schemaImport.js`. The write is triggered by
**Start Profiling** in `BrowsePanel` (`CatalogPage.tsx`). Copy, file rules and the two outcome
sentences are in `src/data/schemaUpload.ts`; `npm run verify:schema-import` replays the reader
offline.

**What it does.** A schema or dictionary file becomes that **dataset's** column dictionary —
`column_profiles`, keyed `dataset.table`, the same place a profiling run reads from and the same
place the demo's own 206 columns were ingested into. Then it starts a run. So it is the ingest
script's act through a screen, and afterwards the Catalog serves what the file said instead of
synthesised columns, Data Modeling draws them, and the graph derives over them.

**Per dataset, not per source.** It was a third source-level button whose panel then *asked* which
dataset from a Select — one upload for a source that may hold three, and a control the reader met
after they had been looking at the list of them. `SchemaUploadPanel.tsx` is deleted and
`catalogUnits` declares no `schemaLabel`/`schemaPanel`.

**BigQuery only, by construction.** The control lives in the *structured* browse panel, and only
that panel lists datasets — a drive gets `DocumentBrowsePanel`, a mailbox `MailBrowsePanel`, neither
of which has a dataset row for it to sit on. A drive or a mailbox reaching the endpoint anyway is
refused by `wrongStructuredOnly` — a schema is what neither has.

| step | what happens |
|---|---|
| **Upload Files** (on a dataset row, and **only** while nothing is staged there) | the file is read in the browser (`File.text()`); `schemaFileProblem` checks the extension and the size before anything is sent |
| — immediately, no second click | `POST …/schema/preview` — reports into `staged[dataset]`, **writes nothing**; a toast says `schemaUploadCopy.uploaded(filename)` and that is the whole of what a reader is told. On a landed read only: a refusal has its own sentence in the panel's error alert, and a success message over it would answer one act two opposite ways |

**A staged row offers its filename and *Discard* — and no upload button.** It used to keep one
relabelled *Replace file*, and a *View report* beside Discard; both removed on request, so swapping
a file is Discard then Upload and there is no report to reopen. `check-docs` pins the gate (`staged ? null :`) rather than just the absence, because hiding
a control is one edit away from hiding it in the state that needs it — an empty dataset with no
upload button has no way to upload, and nothing throws.

**There is no report, and it went in two passes — both on request.** First the `added` and
`dropped` columns, the stranded-declarations alert, the `re-profiled` tag and the footer line
restating what Start Profiling does, leaving table name, the two column counts, a `new` tag and the
curator-note warning; then `DictionaryPlanModal` and `DictionaryPlanReport` themselves, with
`reportFor`, the *View report* button and the four copy fields only they printed. Every field behind
all of it is still computed and still served — dormant, like `/change-signals` — so re-adding the
surface is one file. What it costs meanwhile is that nothing on screen names the tables a run will
cover, the columns an upload will take out, or the curator note it will strand. `check-docs` guards
both directions: the plan still computes what nothing draws, and the surface is absent at every
layer in one claim, since a button with no dialog is the half that fails silently.
| **Start Profiling** | one `POST …/schema` carrying **every** staged dictionary *and* the checked tables: the server resolves all the plans, commits them in a single `commitDb`, then queues **one** job over the union — the dictionaries' tables (always `pending`) plus the rest of the selection (skipped if already profiled, unless `force`) — and the page switches to the jobs board |

**One press, one pipeline.** This was two calls and two jobs: a forced run over the dictionary's
tables, then a second for everything else checked. Over `plan` — 12 dictionary tables and 6 others,
18 in one selection — that read as two pipelines from one press with nothing saying when profiling
had finished. The work list is keyed `dataset::table` and the dictionary's entry wins, so a table is
never in the job twice.

**Where it fails:** a refusal writes **nothing** (every plan is resolved before the commit) and
leaves everything staged — `dictionaryRefused` says exactly that, because "the upload failed" leaves
open whether some of it took; and a file whose **extension** the browser refuses never leaves it,
with the sentence landing in the store's one `error` beside the parser's own. Not its size: that
check went with the bytes, since no file is posted any more.

**Several dictionaries may name one dataset, and that used to be refused.** The refusal read *"two
dictionaries name the dataset plan — read one file per dataset, or the second would replace what the
first wrote"*, which was true while this route parsed the file. It writes nothing now, the plan is
the *dataset's* own tables however many files were dropped, and the work list is a union keyed
`dataset::table` — so a repeated dataset queues nothing twice and what a second file adds is a name
in `applied` for `dictionaryRunSummary` to state. The client had already moved (`filenames` is a
list, the picker is `multiple`, the row draws a chip per file) while the server had not, so the page
staged two files on one row and the press was turned down. Full entry in `docs/REGRESSIONS.md`.

**Two samples to upload, both parsed by `check-docs`.**
`docs/samples/schema-upload-example.json` is written against CAPEX's `bigquery:northline_epbcs` /
`plan` and demonstrates both halves in one file — it replaces the synthesised columns of
`plan_scenario_dim` **without changing its count** (`7 -> 7`) and *declares* `plan_capital_gate_log`,
which is why it carries a label and a grain. Its own `_note` says what to look for, and unknown
top-level keys are ignored by the reader so that note travels with the file.
`docs/samples/capex-plan-dictionary.csv` is the **whole `plan` dataset** — the 12 `plan_*` cube
tables, 186 columns, each table already catalogued at exactly the count the document carries, so
nothing shrinks. It **does** strand three Data Modeling declarations on `plan_version_master`, all
made against synthesised column names (a confirmed identifier `ITD Actuals`, and two joins on a
`Project Code` a table whose grain is "one version" does not have). The plan still computes all
three, and the report **no longer draws them**: that alert was removed on request, so the fact lives
in `stranded_declarations` on the payload rather than on the screen. The fix is still a Data
Modeling edit rather than a column invented into the dictionary. `check-docs` deliberately asserts
nothing about that count.

**Three formats:** JSON (a document with `tables`, or a flat array of column rows), CSV/TSV (one row
per column, with a header — `table` and `column` required, plus `type`, `description`, `class`,
`pii`, `table_label`, `grain`), and SQL DDL. Header names are folded generously (`Column Name`,
`Field`, `COLUMN_NAME`, `name` are one key) because a dictionary exported from a spreadsheet calls
things whatever its author called them. **Anything else is refused naming the three and the remedy** —
for a spreadsheet, export the sheet as CSV. The picker filters on the same list the reader declares.

**Why the preview exists.** Applying **replaces** a table's column list rather than adding to it, so
the preview is the reader's chance to see what a parse understood first — "seed, check the diff,
push" with a screen instead of a terminal. It names, per table:

- both column counts, **catalogue → file** (a table catalogued with 24 columns and a 3-column file
  reads `24 → 3`, which is what the reader will see; the dictionary's own previous length is a
  different question and was the misleading one)
- the columns it would **drop**, by name
- any **curator note** written against a dropped column, which stops applying with it
- any **Data Modeling declaration** reading a dropped column — the worst of the three, because
  `POST /data-model/entities` refuses that state, so it would otherwise be found only by somebody
  trying to edit the relationship
- whether the table is **new** to the project

**A declared column carries no statistics, and the panel says so before you upload.** A dictionary
states what a column means and measures nothing, so `confidence`, `null_pct` and `distinct` are
`null` and print as `—`; `type` is null too where the file named none. Nothing is synthesised into
them — a dictionary of invented statistics looks exactly as plausible as a measured one, which is why
this is the feature's central rule. What a declared column does carry is `derivation: "declared in
<filename>"`, which is the provenance, in the field that already holds one.

**Its class** comes from the file where the file states one — checked against `CLASS_FACET` +
`CLASS_UNFACETED`, so a class with no chip is refused naming the set — and otherwise from the
**type**. Never from the column's name: `identifier` is what the relationship suggester matches joins
on, so inferring it from `_id` would put a suggested join in front of a reviewer on no evidence.

**Where it fails:**

- a format it does not read → refused naming the three and "export the sheet as CSV"
- a file over ~900 KB → refused **in the browser**, naming its size and the cap, because the body
  cap is the server's and a dropped request reads as a broken server
- a dataset outside the source's allowlist → refused naming the allowlist
- a **new** table with no label or grain → refused naming the table and both fields; `validateDb`
  requires them and a table without them renders as a blank cell
- a class the app has no chip for → refused naming the value and the accepted set
- a duplicate column in one table → refused; it would collide in the dictionary and in `column_notes`
- a CSV with no `table`/`column` header → refused naming the headers it did find
- a drive or a mailbox → `wrongStructuredOnly`, which names what the source holds and its own
  catalogue route rather than pointing at a structured one that would fail the same way

---

## Flow 5 — Editing the data (`/db`)

**Files:** `DbEditorPage.tsx` → `dbStore.ts` → `GET|PUT /db`, `PUT /db/:section`

Reachable by URL only — routed, but commented out of `NAV_ITEMS`.

Pick a top-level key (or `whole file`), edit JSON, Save. Three layers of
protection, in order:

1. **Client parse** — `parseDraft` keeps Save disabled until the text is valid
   JSON, so nothing invalid is ever sent.
2. **Server shape check** — `validateDb` verifies all 28 required keys and
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

Five steps, and the premise is inverted from every other flow: **the user
describes a business need and the AI derives the graph.** Nobody types an entity
name — do not add a field that asks for one.

```
1 Domain → 2 Sources → 3 Personas → 4 Metrics → 5 Hero questions
```

Labels come from `WIZARD_STEPS` in `server.js` via the `/graph-use-cases`
payload, so the stepper and the server's `step` validation are the same list.
**All five steps are built.**

**Sources was fourth and is second, moved on request** — the data a graph draws on is settled
before the people who ask of it. Three places moved together and nothing else did: the label in
`WIZARD_STEPS`, the rule in `stepIssue` (`case 2` now, reading exactly as it did at 4 — it judges
the picks, not what was answered before them), and the page's branch, kept in the order a reader
meets it rather than left at its old number. The suggesters were unaffected, which is what made
the move safe: personas, metrics and questions draft from the business need and the domain, never
from the source picks. A brief saved under the old order keeps every answer — they are stored by
name, not by step — and reopens at the number it left on.

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
| 2 Sources | the four checks below |
| 3 Personas | at least one persona |
| 4 Metrics | at least one metric |
| 5 Hero questions | at least one question — **and the build gate**, since this is the last step |

**Step 6, 'Entities & relationships', was removed on request** and *Save & build graph* moved here
with it. The coverage review and its gap gate went too; `graphCoverage`, `/graph-coverage`,
`/graph-derivations` and both stores are left with nothing calling them, like `/change-signals`.
Ask's standing caveats read gap decisions, so a brief built from here contributes none.

`maxStep` on the page is how far the draft has been taken, restored from the
saved `step` when a use case is opened. A step past it renders `is-locked` with a
lock in place of its number, and **stays clickable on purpose** — the click
answers with what is missing, where a disabled button would just read as broken.

Going **back is always free** and keeps the answers, so a cleared step can be
reopened and edited. Going forward re-checks every step in between
(`firstIncompleteStep`), because an answer can be deleted after it was given —
emptying step 4 relocks step 5. Jumping does not save; `Next` is the save point.

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

**Attached documents, and what the step says it read from them.** *Upload documents* keeps a
client-side list of **filenames** — nothing is parsed, nothing is posted, no endpoint reads a
document into a brief, and the attachments are not part of the saved draft (`GraphUseCase` has
no field for them). Under the business need, *What we read from your documents (N)* draws one
row per reading: the sentence, then the passage it came from with the document named at its end.
It is **synthesised from the filename** in `src/data/documentReadings.ts` — one context line plus
three measure definitions per document, sliced at a hash of the name, so the same file always
reads the same way and two files read differently. Open by default (a panel that appeared shut
the moment a document landed reads as an upload that did nothing) and absent entirely with
nothing attached.

**The same pool is what step 4 offers as found measures** — see below. Two pools would let this
panel quote a definition the Metrics step never offers; one `check-docs` claim asserts both
surfaces resolve a document through the same `definitionsFor(file)`.

### Step 2 · Sources

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

**Which means the chooser is not drawn from the mode**, and `chooserIsOpen` in
`src/data/sourcePicks.ts` is what draws it — the reader's own answer where they have given one,
the pick's otherwise. **Where it fails:** gate the panel on `mode === 'subset'` and *Select all*
unmounts the list the instant every box in it is ticked, because an all-ticked selection is
stored as `all`. The pick is right and the reader sees nothing happen — reported from use as
Select all not selecting anything. The mode buttons light from the chooser for the same reason,
each guarded on its own state so pressing the lit one cannot wipe the ticks.

**Two dead ends, two different exits.** Telling someone to connect a source when
they already have three is useless advice, so the step distinguishes them:

| State | What step 2 shows |
|---|---|
| nothing connected | `NoSourceConnected` — "Connect a source" → `/sources` |
| connected, nothing profiled | an **error** alert — "No profiled data yet — you cannot select a source", with "Open the Data Catalog to profile a source" → `/catalog`, above the cards, each tagged `nothing profiled` and disabled |
| something profiled | the selection UI; the alert disappears |
| a Gmail mailbox connected | selectable straight away, tagged `read at question time`, and taken whole — the row is the address, its labels and a *USED FOR* box, with no object list to narrow — see below |

**A runtime source is the exception, and it is selectable whatever its catalogue holds.**
`RUNTIME_KINDS` names the kinds that are read *when a question needs them*; the server
serves `runtime: true` on the row, its objects are the labels the wizard picked, and their
`units` is **`null`** rather than 0 because nothing about a label is sampled and 0 would say
a label is empty. The gate is "has this source anything to point at", not "has it been
profiled" — the old test put an error above a list whose one usable row sat underneath it,
and it refused a mailbox with *"profile it in the Data Catalog first"*, advice that could
not be acted on.

**Mail has a profiler now, and none of the above changed** — which is the point of wording
the gate that way. A mailbox's `object_count` here is still its labels, deliberately not the
messages a profiler has landed: a real count would say the mail is derivable. So a fully
profiled mailbox with nothing in scope is still 0, and a mailbox with labels and nothing
profiled is still selectable. Had that refusal instead been fixed by testing "is there a
profiler for this kind", it would now send a reader to the Data Catalog — where profiling
the mail changes nothing about this step.

**And the row draws no object list at all.** It listed the mailbox's processed documents with
a checkbox each and a *Select all* above them — itself a replacement for a label picker — and
that listing was **removed on request**. Ticking the source is the whole decision and records
`mode: 'all'`, which is what ticking every box already meant; the pages, chunks and snippets
are read in the Data Catalog, which is the one surface for them. `mailDocumentMeta` is kept
with no caller — do not delete it, and do not re-add the list without being asked. One
`check-docs` claim slices the runtime branch and asserts both halves: no *Select all* and no
document checkbox in it, and the *USED FOR* box still in it.

**What it contributes is an answer, not an entity.** Step 6 derives nothing from it and
states so (`runtime_sources` and `runtime_note` on the coverage payload, both now carried by
`toCoverage` and printed as the server worded them) rather than leaving it silently out of
the entity list. **A hero question no profiled column covers is `runtime` rather than a
`gap`** on such a brief — it needs no decision, it is counted as `runtime_question_count`, and
it does not block the build, which is what a mailbox-only brief used to do with no control on
screen to unblock it. At Ask time its content arrives as
`observation` blocks — attributed claims read from correspondence, never merged into the
graph. Such a graph used to **publish itself when its build completed** and no longer does —
removed on request, reported as a graph that published without anybody asking. Every graph
waits for the Publish button now, and **Save & build routes every brief to Graph Studio**,
which is where a build is watched. A mailbox is still askable the moment it is connected: Ask
can be pointed at a connected source directly, with no graph named and nothing to publish.

**`Next` refuses to leave step 2 empty** (its rule lives with every other step's,
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
  hiding it would make the two indistinguishable. **A runtime source gets a different
  sentence**, because it can never be profiled: it is refused only when its own scope is
  empty (*"has no labels in scope — reconnect it and pick at least one"*), which is the
  one thing about it a reader could actually fix.
- a `subset` selecting nothing → 400 (*"an empty selection can't derive"*)
- an object that is not profiled on that source, or a source that is not
  connected → 400 naming it

Disconnecting a source removes it from what this step offers, so a stale pick
cannot survive quietly.

### Steps 3 and 4 · Personas, then Metrics

**Both steps are the same component** (`DraftedStep`) over the same server
machinery — they differ only in copy and which pool they draw from:

| | Step 3 | Step 4 |
|---|---|---|
| suggester | `POST /graph-personas/suggest` | `POST /graph-metrics/suggest` |
| pool | `graph_personas` (`focus`) | `graph_metrics` (`definition`) |
| list label | Who will ask questions of this graph? | Metrics these answers report against |
| saved as | `personas` | `metrics` |
| corrects the pool | — | `PATCH /graph-metrics/:metricId` |

Both answer `{ suggestions: [{ id, name, detail, why }], count, derived_from }`,
and both lists are stored as `{ name, description, source }`. Adding another
list of the same kind means reusing `DraftedStep` and `suggestFrom`, not writing
a third variant.

`Suggest personas (LLM)` → `POST /graph-personas/suggest { domain_id,
business_need }` → up to four drafts from the `graph_personas` pool. Each row
carries an **AI-DRAFTED** tag, its `why`, an **Accept** button and an ✕ to wave it
away (local only — a suggestion was never saved).

**When it drafts nothing, the payload says why** (`empty_reason`, `null` otherwise) and the step
prints that rather than its own wording. There are two empties and they have different fixes: the
pool has entries for this domain and the ranking placed none (*re-word the brief*), or the pool has
nothing on this domain at all (*change the domain, or write your own*). Only the server can tell
them apart, so it composes the sentence and names where the pool does have entries. **The first
symptom of getting this wrong is a bug report that the suggesters are broken** — CAPEX declares four
domains and has personas, metrics and hero questions for two, and every empty draft used to read
"Nothing matched this brief".

Step 1's cards carry the other half: `drafts` per domain (personas · metrics · hero questions),
counted off the pools by `draftableFor`, so a domain that can draft nothing is visible where it is
chosen. It is **not** `fit`, which is about connected data — a domain can be a strong fit and have
nothing written against it. Such a domain stays selectable, because writing your own is a real path.

And **never narrow a pool's `domains` when replacing it**: `suggestFrom` drops an entry whose
domains miss the brief's when its keywords miss too, so a narrower pool deletes suggestions rather
than weakening them. `seed-capex-metrics.js` took the intersection once and cost water-wastewater
every metric it had.

**Accept** moves it into *Who will ask questions of this graph?*, keeping the
focus line as its description and `source: 'ai'`. It was labelled *+ Add* and was
renamed on request: what the button does to a *suggestion* is accept it, while
**Add persona** / **Add metric** below really does author a new one and keeps its
name.

**Step 4 has a third button, Edit, and it is the one act here that writes.**
Accept copies a row into the draft and ✕ filters a list nothing saved; Edit
corrects the **pool** — `PATCH /graph-metrics/:metricId` through `commitDb` — so a
corrected title or calculation survives a restart and every later brief drafts
from it. The row opens in place on two fields (a title input, a `TextArea` for the
description, because one CAPEX metric is a sixteen-line DAX measure), and the row
is replaced with **what the server stored** rather than what was submitted.

Its refusals: an empty title (every surface identifies a metric by it), and a
title another metric already holds (the accepted list is keyed by name, so two
would be indistinguishable there). A refusal leaves the editor open on what was
typed — the sentence is what the reader has to act on.

Step 3 has no Edit, and it is **absent rather than disabled**: personas have the
same shape and no write route, so `DraftedStep` takes `onEdit` as an optional prop
and `createSuggestStore` takes its writer per pool. Editing a metric that has
already been accepted also renames it in the list below, since that list holds a
*copy* keyed by name; saved briefs are deliberately not rewritten.

**And step 4 alone has a second list: *Found in your documents*.** It is what the files attached
on step 1 were read as defining — the same pool that panel quotes, through the same
`definitionsFor(file)`, so a measure approved here is the definition the reader saw two steps
back. A row states the measure's name, the document it came from, and its one-sentence
definition; behind **How it's calculated** sit the two things a metric pool does not hold — the
**query the document printed**, in the document's own layout, and the sentence it explained the
calculation with.

**Approve** adds it to *Metrics these answers report against* with the document's own definition
and `source: 'ai'` (drafted by the pass, not typed — the honest one of the two values there are).
**Reject** drops the row; nothing was saved, so nothing is deleted, and Reject stays offered after
an approval as the way back out. **Approved is read off the metric list**, never held in the panel,
so removing the metric below puts Approve back — a flag beside it would be a second answer to the
same question.

`FoundInDocuments.tsx` is its own component — a suggestion is two columns and three acts, this is a
definition plus its evidence — and it reaches a step as the optional `found` slot, passed at the
metrics call site and on Hero questions and nowhere else: a *Found in your documents* heading on
the personas step would describe a pass that did not happen. An empty list renders **nothing at
all**, heading included. One `check-docs` claim covers the pool, the slots, the derived Approve and
the empty branch.

**Step 5 has the same list, of questions rather than measures** — see below. One component draws
both, the way `DraftedStep` draws steps 3 and 4: each step passes its own copy block and its own
Approve. The rows are built in `src/data/` (`metricFoundItems`, `questionFoundItems`), so what a
panel draws is assertable without rendering a step that has nothing attached.

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
  step drafts exactly that use case's personas, metrics and hero questions, whole
  and in its own order, past the four-suggestion limit. The `why` reads "named
  in the … use case" and `derived_from` names it. Two templates tying matches
  neither, and the keyword ranking answers instead.
- **Personas are tags, not permissions.** The panel says so, and the server never
  validates a persona against the suggestion pool — the user may add their own.

With no brief the suggester falls back to domain only and says so
(`derived_from`). Omitting `personas` from a save leaves them untouched; sending
`[]` clears them.

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
- **Found in your documents** — present only where a document was attached on step 1, and the
  twin of step 4's list, drawn by the same `FoundInDocuments`. A row is the question as the
  document phrases it, who the document says asks it, and behind **What answers it** the measure
  and the query that do — because a hero question nothing can compute is exactly the gap this
  step's contract exists to avoid. **A question is a field on the measure that answers it** in
  `documentReadings.ts`, so step 5 can never offer a question step 4 has not accounted for, and
  step 1's passage quotes both. **Approve** adds it to *Your questions* at the priority the
  document implies — marked `HIGH` on the row and stated in the note, never applied in silence,
  since High is the contract — and **Reject** drops the row, saving nothing.
- **Your questions** — one row each: a `HIGH` badge on the left when marked,
  the text, then `AI-DRAFTED`/`USER`, a still-editable **High** checkbox, and ✕.
  Nobody gets a contract right first time, so priority stays changeable — which is what lets an
  approved document question arrive High and still be settled here.
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
pick on step 2 immediately narrows what step 6 reports.

**The click lands in one place, for every graph.** The commit and the build start here and the
reader goes to `/graph-studio/:id` on the Build tab, because a graph is built more than once
and rebuilding lives where reviewing does.

It forked once: a runtime-answered brief stayed in the wizard behind `RuntimeBuildDialog`,
which watched the run and handed the reader to Ask, on the reasoning that such a graph
published itself and the studio had nothing left to do for it. **Both halves of that are gone**
— the dialog was removed on request (one place to watch a build), and the self-publish was
removed after it, so there *is* a remaining act: pressing Publish on the Versions tab.
`RuntimeBuildDialog` and `src/data/runtimeBuild.ts` are deleted, `isRuntimeAnswered` with them.

**The build is told nobody.** It took `?as=` while a runtime-answered build was the publish
act and had a publication to credit. It publishes nothing now, so the parameter went with the
behaviour — the route no longer validates one and the client no longer offers one.
`publishVersion` still sends the signed-in address, because a publication still names somebody.

**Where it fails:** an unnamed draft → 400 (`name is required`), an unknown
domain or an out-of-range step → 400, opening a use case the server no longer has
→ 404. All surface through the store's `Result`, so the page shows a message and
keeps its state.

---

## Flow 8 — Graph Studio: a use case's graphs get built, bridged and published

**Files:** `GraphStudioPage.tsx` → `StudioBuildTab` · `StudioBridgeTab` · `StudioCanvasTab` ·
`StudioVersionsTab` → `studioStore.ts` → `backend/studioLanes.js` (the pure derivation) →
`/use-case-configs`, `/structured-graph-builder/*`, `/document-graph-builder/*`,
`/use-cases/:id/bridge-builds`, `/use-cases/:id/graph-versions`

```
New Graph · Save & build graph
        → POST /graph-use-cases                commits the brief — and starts NO run
        → /graph-studio/:useCaseId             lands on Build, both lanes `not started`

/graph-studio          a use-case selector, and five tabs under it
        → Build          both lanes' pipelines · the story · Draft from my data model · Build graph
        → Bridge         EntityType ⇔ Concept, decided one row at a time
        → Playground     Metrics · Golden Queries — the brief's own, with the SQL each is answered by
        → Canvas         Structured · Documents · Combined (+ Full view ↗)
        → Versions       what was approved together · Publish · Unpublish

the run, end to end, from the Build tab:
   Draft from my data model
        → POST /structured-graph-builder/story-drafts   the tables, grains, columns, joins
   Build graph
        → POST /use-cases/:id/combined-builds  202 · both lanes at once · bridge_follows
        → both lanes step on the server, polled at 1200ms
        → the lane that lands second forms the Bridge   (maybeAutoFormBridge, server-side)
        → "Asking the model · N of M model calls · C Concepts × E Entity Types"
        → at 100% the page hands the reader to the Bridge tab
   Accept all (N)
        → POST …/bridge-builds/:id/type-links/accept-outstanding?as=
   Publish
        → POST …/graph-versions/:id/publish?as=   409 while anything is undecided
```

**Two dead ends, two exits.** No source connected at all → the shared `NoSourceConnected` (fix:
Sources). Connected but no use case → "No use case to build yet" (fix: New Graph). The count comes
from the server on `GET /use-case-configs` and is read `=== 0`, because the store holds `null` until
the first load and falsy would flash the empty state over a tenant that has sources.

**One selector governs the page.** Every tab is prop-driven off the use case the store holds, so no
tab carries a picker that could disagree with the one above it — the fault the two studios this
replaced had between them.

**The lanes are derived from what is attached, never declared.** `deriveLanes` reads the brief's
source picks: a BigQuery project gives a structured lane, a drive or mailbox a document lane, and a
use case can have both. There is no `graph_kind` and there must not be — single-valued, so "both" is
unexpressible; frozen at commit, so a use case could not grow into a second lane.

### Where a lane's content comes from

`backend/studioLanes.js`, and it is **pure** — the document in, plain data out. `npm run
verify:studio-lanes` replays it over both documents with nothing running, which is what makes it
checkable at all; it is in `preflight`.

Nothing there authors graph content. The structured lane reads `projects` + `column_profiles`; the
document lane reads the drive's documents + `document_extractions`; the concepts are the canvas's own
seven. So a dataset that ships data ships a studio with it — **CAPEX gets its lanes for free.**

Where the document answers nothing, the answer is synthesised from the tenant's own words or
**refused**. The story is the business need rearranged (`degraded: true` — no model ran); a chunk of
document text nobody stored comes back `chunk_text: null` with the document named, because a
fabricated quotation under a heading that says "verbatim" is the one lie a reader could not catch.

**Checking it:** `npm run verify:studio-lanes` (pure, in preflight) replays the derivation over both
documents. `npm run verify:studio-contract` (needs `npm run mock`, so **not** in preflight) calls
every studio fetcher against a live server through the real validators — the only thing that checks a
schema against a real payload, added after one schema over two shapes refused every structured graph
while blaming the server. `check-docs` holds the offline half: every fetcher must appear in
`contract.ts`.

### Build

One press runs every lane **at the same time**, then forms the Bridge once both have finished — the
only order available, since a Bridge is formed FROM two finished graphs. A lane that fails does not
stop the other, and no Bridge is formed unless both succeed; for a single-lane use case none is, and
the Bridge tab says so rather than offering a correspondence there is nothing to form. Both runs are
stepped on the server and polled by the page — **one cursor, not two**, so a stage cannot read
complete while one of its substeps spins. The stage list and the pace are the server's (`step_ms`
rides on the payload), so adding a stage adds a row and changing the pace moves the "about N left"
sentence rather than contradicting it.

**The formation is asked for, not inferred.** `auto_bridge` rides on *both* run rows and whichever
lands second calls `maybeAutoFormBridge`, so a lane triggered on its own still forms nothing. It is
paced in **model calls, and a call is one Concept** put against every Entity Type — so
`links_written` is the product of the two rather than a third count, and the strip reads *8 of 24
model calls · 24 Concepts × 13 Entity Types · 104 links* off one cursor. At 100% the page hands the
reader to the **Bridge tab**, where the next act is; only after a formation *this reader watched*, so
arriving at a studio whose Bridge succeeded last week does not move them off the tab they opened.

**Draft from my data model** composes the description from `dataModelStory` — the tables in scope,
the grain each states, the profiled columns, the confirmed identifier and the declared joins. It read
`sgbStory` (the business need) once, which handed the reader back what they had already written; the
failure was silent, because a brief and a description of a schema are both prose. Every clause is
read out of the selected dataset's own document, an absent fact is left out rather than filled (a
`rows: null` is not 0), and both caps state themselves.

**Each lane draws its own panel, in its own register.** Structured is a build *trace* —
`trigger_accepted` (`202 accepted`) · `structured_passes` (naming the pass in flight) ·
`persist_and_coverage` — monospace, status right-aligned. Document is a corpus *pipeline* — *Reading
documents* … *Pruning* · *Assembling the graph* — sentences under a percent bar, with a phrase and an
elapsed timer under the running stage. Borrowing either register for the other loses the glance-level
answer to "which lane am I looking at".

**A build never publishes.** It records what it produced and stops. A run that published itself was
reported from use as a graph that "automatically got published", and it stepped around the gate
rather than through it.

Editing the story re-runs the extraction — the cursor resets and the same stepper narrates it. A
**published** build refuses the edit and names the fix.

### Bridge

`EntityType ⇔ Concept`, three-way: `identity` (a thing of this type **is** what one row of the
concept represents) · `attribute` (a **value** of an attribute of such a row) · `reject`. It names no
column and queries no warehouse — **nothing here can become a `WHERE` clause.**

The decision is grounded in the **resolution**, not in the two names: when every "Transporter"
resolved to a `Facility` node, that is the evidence. Matching strings called "Generator (facility)" an
*attribute* of Facility because the word is inside it — exactly backwards.

- **Reject rows are listed**, because the table records what was *considered*.
- **What blocks publishing**: it asserts a correspondence and no person has decided it. Confidence is
  deliberately **not** in the predicate — it is the deriver's self-report, so gating on it would let
  the deriver choose which rows a human must look at, and a confidently-wrong `identity` is exactly
  the row that would escape. It *orders* the queue (low first); it does not define it.
- **Agreement is a decision.** A row leaves the set whether the person confirmed or changed it.
- **Accept-all** sweeps only what is still outstanding — a gate nobody can clear gets switched off.
- **A published Bridge is frozen**; `revise` clones it with every decision carried, so the one row you
  came for is one edit away and the published one keeps answering until you publish the clone.

### Playground

**Files:** `StudioPlaygroundTab` → `PlaygroundMetrics` · `PlaygroundGoldenQueries` · `PlaygroundRow`
→ `src/data/playground.ts` (copy + rules, pure) → `GET`/`PATCH /use-cases/:id/playground`

Two nested tabs over **the brief's own rows**: the metrics accepted on step 4 of New Graph and the
hero questions accepted on step 5, read straight off `graph_use_cases`. Not a copy — two homes for
one list is how a metric comes to exist on one screen and not the other. What it adds is the **query
each is answered by**, plus add, edit and remove.

- **Absent means unchanged** on the PATCH, and the record **spreads** the use case: the Metrics tab
  must not delete the golden queries by not mentioning them, and neither may drop the brief's name,
  domain or picks.
- **The wizard carries both additions**: `golden_query_files` is in its carry-forward list, and both
  writers normalise metrics `withSql` — otherwise a wizard save drops a query written here.
- **FROM DOCUMENT is keyed on `origin`**, set by the document pass alone. `source` is two-valued and
  cannot tell a document-read measure from a pool-ranked one, so the other rows read AI-DRAFTED or
  MANUAL. An edit keeps the row's provenance.
- **Caps refuse rather than truncate** (12 metrics, 20 questions), state the number, and are served
  rather than restated in the page.
- **An upload takes the filename and nothing else** — no parser, no invented questions, and the note
  above the list says so. Who uploaded it comes from `?as=`.
- **Not locked on `outputReadable`**: the brief exists the moment the use case does.
- **Rules and copy in `src/data/`**, list bodies exported apart from their dialogs — a `Modal` portals
  out of `renderToString`, and a refusal decided in a component is only reachable after somebody
  types, which a render never does.

### Canvas

**Files:** `src/graph-viewer/` (vendored) + `src/data/studioCanvas.ts` (pure adapters)

Three frames, one viewer. A second force graph is what this repo refuses everywhere: two drawings of
one graph are two answers to what it looks like.

- **Structured** — tables and the concepts their columns realise. Columns fold into their table
  (206 discs around five tables says less than five tables do), capped **and saying so**; nine
  `REALISES` edges between one pair fold to one relationship carrying the count.
- **Documents** — the corpus and what each document was found to be about. Two documents about one
  facility **share a node**: that is entity resolution, and the mention count says so.
- **Combined** — both, plus the Bridge drawn between them. **Nothing is merged**, and a correspondence
  reaches the drawing only once a person has decided it: a line on a canvas reads as a fact.

`Table` is the one type the studio added to the palette; without a hue every table fell through to
grey. **Full view ↗** opens the combined frame in a new tab — href built by the page, because the
dataset prefix is the page's.

### Versions

A version is **the artifacts approved together** — it records an approval, never a merged graph.
`reconcile` names whatever finished (idempotent, `null` rather than an invented version), and
**creating is not publishing**: it lands unpublished so it can be inspected.

Each carries two staleness questions, **reported separately**: whether its Bridge was formed from the
triple it names (a **defect**) and whether a lane has built something newer (just a **candidate**).
One "stale" boolean would make those read the same.

Publishing approves every artifact it names **or none of them**, and must be told who did it — the
identity is client-held, so a route has nothing to look a publisher up from. The tab withholds the
button when nobody is signed in.

**The review gate is enforced, not only disabled.** The Bridge tab greys Publish while anything is
outstanding, and the route answers **409** on the same `needsReview` — a disabled control is a
courtesy to whoever is looking at it, and a stale tab or a `curl` would otherwise approve a Bridge
nobody had finished reviewing. One predicate, so the screen and the refusal cannot disagree.

**`publishedVersion` is the one seam** Ask, Reports, the What-if lens and Audit & Governance all read.
That is why replacing the studio reached all four without editing any of them. Do not let a surface
learn to read the version store for itself.

### What is locked

Bridge, Canvas and Versions read a build's output, so they are locked until one exists **and again
while a rebuild runs** — otherwise they show the previous build's output with nothing saying so, and
settling a correspondence against a superseded canvas is a decision on stale evidence. One flag
(`selectOutputReadable`) drives all three. **Build is never locked.**

### In memory, per dataset

Builds, jobs, Bridges, decisions and versions all live in the server's memory, per dataset, because
none is keyed by one. A restart clears them and the 404 says so.

**`both` refuses a studio write at the mutator, not the container** — `readOnly` catches a write that
*adds* a row but not one that mutates a row already inside the merge, and the merge holds those by
reference, so publishing under `both` would take effect against a dataset the reader did not select.

### What the previous studio left behind

The review queue, the pivot, the per-graph build history and the sha256 publish pointer went with the
page. **Kept deliberately**: `studioCanvas`, `studioQuery` and `graph_studio.sanity_checks`, which Ask
reads, and `db.graph_studio.canvas`, the roster the document lane resolves against.

**Waiting for a caller** (the `/change-signals` state — do not delete to "finish" the removal):
`db.graph_studio.review_items` and its pivot, still written by `npm run ingest:graph`; and
`fromCanvas`/`answerPath`, whose highlight mechanism is whole beneath a surface that no longer exists.

## Flow 9 — Ask: querying a published graph

`AskPage.tsx`, `AnswerRequirementsPanel.tsx` → `askStore` → `GET /ask` · `POST /ask`

Where the graph gets used. Everything before this flow produces a graph; this is
the flow that spends it.

**Two tabs: Ask, and Answer requirements.** The second is where step 6 of the New Graph
wizard went — see Flow 6. Both sit behind the one publish gate; only `PageHeader` and the
graph picker are outside it.

**The dropdown lists published versions and only those — including the ones that published
themselves.** A graph drawing on a **runtime** source (a Gmail mailbox; see Flow 7 step 2)
is published by its own build the moment the build completes, so it appears here without
anybody pressing Publish. The gate itself is unchanged: `GET /ask` still lists what
`publishedVersion()` returns a row for, and the version, content hash, timestamp and
publisher it reports are the real ones that build produced — credited to whoever started
the build. What a runtime-answered graph skips is the *review queue and pivot*, and it
skips them because those decide what the **canvas** asserts and a runtime source puts
nothing on the canvas. A graph with no runtime source still waits for Publish.

**Its answers arrive as `observation` blocks**, which are the one block kind that is not a
figure: attributed claims read from correspondence at question time, each naming its sender,
its date and the extractor's confidence. The block **prints no total of them** — the moment
a reader can read a sum off it, the claims have become a figure — and it borrows no status
tint, because a contractor's claim is not a state of the project. A row that resolved to
nothing says so, since that is a finding rather than a missing value.

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

**A graph is not the only thing that can be asked, and the chips say both.** `GET /ask` also
serves `sources` — the connected runtime sources, `askableSources()` — each with its own
`suggested_questions`, drawn from the pool `askSourceAnswer` matches within so a chip cannot be
offered that the source would abstain on. `askSuggestions` merges the two: the selected graph's
hero questions first (`sourceId: null`), then **two per connected source**
(`SOURCE_CHIPS_PER_SOURCE`), de-duplicated against the graph's own *before* they are counted — a
`.filter` afterwards would spend a source's two on questions that are then dropped, leaving a
mailbox with thirteen recorded answers showing none. The graph's are not capped. There is no
picker to tick — connecting is what puts a
source in scope — so a mailbox connected on Sources shows its questions immediately rather than
after a step nobody was told to take. **Clicking a source's chip drops the graph first**
(`select(null)` in `AskPage`), because `POST /ask` settles a request naming both in the graph's
favour and the answer would otherwise be reported under a graph version that did not produce it.

**Where it fails:** returning the hero questions *instead of* the sources' is the regression this
replaced, and it is invisible — the row looks full, and only a reader who deselects the graph ever
sees the difference. `check-docs` asserts the old graph-only return has not come back *beside* the
merge as well as that the merge is present.

**The box starts centred and moves to the foot on the first question.** `opening` in `AskPage` —
`turns.length === 0 && !asking` — is the one flag behind the layout class, the grounding card and
the chip row, so all three change together; the move is a `flex-grow` transition on `.ask-tail`,
an empty element below the composer, because `justify-content` is a discrete change that jumps and
a timer in the page is what every paced surface here refuses. **Where it fails:** gating the chips
on the thread being empty instead leaves a disabled row of openers under a composer that has
already moved, and ending `opening` on the first *answer* rather than on `asking` leaves the box
centred while its own reply streams beneath it.

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

**CAPEX ships its own 50 and they are rescaled on the way in.** `npm run ingest:queries` reads the v2
query set and divides every figure by `capex-scale.js`'s factor — the same one the rendered reports use,
because Ask's *Actuals YTD (to May)* is to the cent the Variance Report's `periodActual`, and two factors
would be two answers to one question. What is money is read from what the set declares (a metric item's
`unit`, a chart's axis, an observation's `amount`) and never from how large a number is; a chart whose
axis names no unit and holds a figure refuses the run. Prose goes through one formatter that keeps the
author's shape — `$12.03b` becomes `$48.1m`, `$12,028,661,826` becomes `$48,114,647` — and it scales on
the way in rather than in a second pass, so a re-ingest cannot undo it. A sweep refuses anything left
reading in billions.

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
| **who can open it** — people, from Settings' five users | `viewerRoles` (role ids) | `governance.people`, served |
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
Report opened on `$5.00B` where the demo's range is $50M. One factor — `capex-scale.js`'s, shared with
`npm run ingest:queries`, because Ask quotes the same figures and *Actuals YTD* is the report's own
`periodActual` — across every capital figure, so every ratio the documents state stays exactly true; the
tiles now read `$20.0M · $17.6M · −$2.4M`.
Because these are generated files that forbid hand-edits, the safety is in the script: literals found by
**path** rather than key name, every number in a report's own containers classified money or not-money
with an unclassified one refusing the run, the arithmetic (`periodVariance = periodActual − periodPlan`,
`sampleBudget` against the sixty budgets, the heatmap against both margins) re-checked on the file that
was written, and the prose figures — *"does not sum to $113.1B"* — listed one by one so `1.1 million
gallon` stays a volume. Platform spend and the unprinted five-year programme figures are left alone;
`check-docs` reads the tiles back out of all three documents, so a re-export in billions fails the build.

A fourth: **a narrowed report re-derives itself, and the transform is `npm run narrow:capex`.** It did
not: picking an executive category moved the population line from 50 to 10 and narrowed the three
`projects`-sourced blocks, and left everything sourced from `portfolio` byte-identical — the four tiles,
the category chart, the region × category heatmap and the prose quoting all of them. They are declared
programme figures over all 4,500 projects, served as stated, with the document's own *Unchanged by your
filters* note on the block. Correct, and unreadable from a broken filter. So: **unnarrowed, nothing
changed**; narrowed, `inViewPortfolio` builds one overlay over `db.portfolio` and two readers reach it —
`sourceObject` (every figRow, bar, heatmap and filing calendar) and `resolveTokens` (the prose) — with
every block that reads a recomputed key stating the population it totalled. That is not the substitution
`neverSubstitute` forbids: the fault there is a re-summed total wearing the *declared* figure's label,
and the fixture already keeps `samplePeriod*` beside `period*` for exactly this distinction.

**One overlay rather than a rule per block, because the tiles alone were done first and that was worse
than not starting**: `$31.8K` of period plan above a chart still drawn in millions and a paragraph still
reading *"actual spend of $17.6M"*. Figures on one screen move together or not at all.

Where to look when it goes wrong: the three rule maps (`IN_VIEW_FIELD` for a portfolio key backed by a
row field — **coordinate-aware**, which is why `FIELD_FOR_MEASURE` cannot serve, it resolves `m_actual`
to inception-to-date `actual`; `IN_VIEW_DERIVED` for counts and extremes; `IN_VIEW_SHAPE` for the
category series, the heatmap and the filing calendar's exposure table), `IN_VIEW_DECLARED` for what is
deliberately *not* moved and why, and `resolveBlock`, which drops `unaffectedByParams` on a block that
moved. Every rule declares the row fields it `reads`, and that declaration is load-bearing — it is what
the masking check runs against, so `check-docs` refuses a rule touching a field it did not declare.
**Silence is the trap**: a renamed row field stops a rule moving with nothing on screen saying so, so the
script refuses to write on a field the roster lacks or an identity rule that stops reproducing, and two
claims assert every layer in all three documents *and* that the in-service figures stay declared.
R2 needed nothing — Project 360's only view parameter is `project`, so it already changes whole.

A fifth: **the frame is held until the document opens its report.** These files paint the prototype's own
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

**Stores:** the five users, the live permissions, the authored defaults, and the read-only rule.

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
- **The sidebar collapses, and collapsed means *absent*.** `Sidebar` returns early on `collapsed`, so
  the items, the wordmark and the signed-in card leave the markup — antd's `collapsible` is
  deliberately not used, because an icon-only rail is a menu a reader cannot read and a screen reader
  still announces. `App` drives the width (258 → `COLLAPSED_WIDTH` 48, never 0) and the 48px rail keeps
  `SidebarToggle` — exported for assertion, carrying `aria-label` and `aria-expanded`, its two words in
  `nav.ts`. The mobile drawer takes none: it hides everything by being shut. Not persisted.
- **The toggle is `MenuFold`/`MenuUnfold` on a filled button**, not a grey chevron: it was
  discoverable only by hovering the right pixels. Brand tint, brand border, **`BRAND_INK`** glyph
  (`BRAND` on `BRAND_SOFT` is 2.91:1), inline from `theme.ts` — `Sidebar.css` already hardcodes an
  orange of its own, so the stylesheet owns only the glyph size and a brightness hover.
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


## Flow 14 — Data Modeling: saying what a table is

**Files:** `DataModelTab.tsx` (+ `EntityCanvas`, `ModelTableList`, `EntityOverviewPanel`,
`EntityColumnsPanel`, `EntityRelationshipsPanel`, `RelationshipModal`,
`ModelMarks`) → `dataModelStore.ts` → `GET|POST /data-model/entities`,
`DELETE /data-model/entities/:id`, `POST /data-model/suggestions`, plus
`GET /sources/:id/columns` — the same read Flow 4 makes. Pure logic in
`src/data/dataModelCanvas.ts`, `dataModelRelationships.ts`, `dataModelColumns.ts`,
`dataModelTokens.ts`. Stored in `db.data_model`.

**It is the Catalog's third tab, and third for a reason.** Flow 3 browses and profiles, Flow 4
describes what a run recorded column by column, and this is where a curator says what a *table*
is — the entity it stands for, the column that identifies a row, its relationships to other
tables. It draws over the profiled dictionary, so a source with
nothing profiled says so in words rather than drawing an empty canvas, and a drive or a mailbox is
left out with the count stated (a model is a schema; a document corpus has none).

### What is on screen

| column | what it answers |
|---|---|
| left rail | which structured source, and which of its profiled tables — with a pill per table stating its confirmed relationships, or its pending ones, or an em dash |
| centre | five counts (tables · **relations** · suggested, pending · orphan tables · columns described — the middle two open what they count; orphans are inert and read `—` before a run), **Fit**, then the canvas and its legend. The *Curated by AI* button is gone: the run happens on arrival |
| right | the one table in hand, over Overview / Columns / Relationships — with **one** status pill beside its name: *Not yet declared*, *Curated by AI* (an entity exists but nobody saved it) or *Confirmed by you* |

**The table's status is stated once, in the header.** Overview carried a `ProvenanceBadge` beside
five of its fields — one question answered five times on a form saved by one button — and they were
removed on request, along with `fieldLabel`'s `badge` slot. `tableDeclarationState` in
`src/data/dataModelStatus.ts` is the rule, read off an entity-level **`confirmed_by`** that only
*Save Overview* writes. The two declared states are `ProvenanceBadge`s — **purple** *Curated by AI*,
green *Confirmed by you* — and only *Not yet declared* is a `StatusPill`: all three went through the
status palette at first, so the header's *Curated by AI* was amber while the same words on the rows
beside it were purple. Status is green/amber/red, provenance is green/purple, and that is why the two
are separate components. `TABLE_STATUS_KIND` names only which badge; the words are the badge's. It read *Declared* for any existing entity before, which was wrong for all
14 of CAPEX's: `relationshipWrites` mints an **anchor** entity whenever a relationship points at an
undeclared table. A later write carries the stored answer forward, so an anchor write cannot
un-declare a table somebody saved. **The per-row marks stayed** — a relationship's badge and a
reassigned column's are records with their own provenance, not fields of a form.

**Selection is one piece of state.** `selectedTableKey` goes to the rail and to the canvas and both
call the same setter, so the two cannot disagree about what is selected — there is nothing to sync
because there is only one value. Pan, zoom and a dragged card belong to the canvas, because they are
DOM state nobody outside reads; **Fit** is therefore handed in as a ref rather than lifted out.

### What persists, and what deliberately does not

- **A declaration** — the Overview, the confirmed identifier, a relationship, a reassigned
  column — goes through `commitDb` into `db.data_model`. It survives a restart the way a saved graph
  brief does, because it is somebody's work and the graph builders are meant to read it.
- **A suggestion** lives in the tab until somebody confirms it. A suggestion nobody accepted is not
  a declaration and must not be stored as one; confirming is the act that writes it, and a failed
  confirm leaves the suggestion where it can be retried.
- **A column's description** is a curator note on the *profile*, written to Flow 4's own endpoint, so
  it lives in the mock server's memory like the registration it belongs to. That is the existing
  behaviour of a column note, not something this tab changed.

**A declaration is keyed by `table_key` — `"<dataset>.<table>"`** — the key `column_profiles` uses,
and deliberately not a source id: a registration lives in memory, so an entity naming one would
dangle at the next restart. `data_model` is the **28th required key**; `npm run seed:data-model`
writes the empty `{ "entities": [] }` its refusal names, and never rewrites a declaration already
there.

### The writes

`POST /data-model/entities` is **one upsert that carries absent fields forward**: the Overview panel
sends the text fields, the relationship editor sends `relationships`, the reassigned-column editor
sends `cross_attributes`, and none may erase the others' work. It refuses a table this dataset does
not
carry, a second entity on one table, two confirmed identifiers, a cardinality outside
`1:1 | 1:N | N:1 | N:N`, and a join on a column `column_profiles` does not list.

**A relationship lives on the entity anchored to its *from* table, so a save is sometimes several
writes.** `relationshipWrites` assembles them and the store posts them **one at a time** — each hands
the server a whole entity, so two in parallel would have the second overwrite the first. The *to*
table is anchored too (a relationship between a declared entity and a bare table leaves one end of
the edge unnamed), and an edit that moves the *from* side writes the **new owner before** clearing the
old one: a failure between the two duplicates a declaration, which is visible, rather than dropping
one, which is not.

### Curated by AI (the suggestions run)

`POST /data-model/suggestions` reads the source's profiled columns and offers the joins a **shared
identifier column** implies — an identifier on at least one side, since two tables both carrying a
`status` column are not related by it. Every figure in a rationale is read off the profile: the
distinct counts are the profiler's, the cardinality follows from whether each side's distinct count
reaches its row count, and the confidence is the **classifier's own** for the weaker of the two
columns. It is paced at `SUGGEST_MS`; its refusals are not.

**There is no model behind it, and the payload still says so even though the badge does not.**
`degraded: true` rides on every response; the tab prints *"No figure is invented to fill a field"*;
and the provenance badge reads **Curated by AI**, renamed on request over a scan no model performs.
Do not "fix" the disagreement by flipping `degraded` — it is the only honest answer left to that
question, and `check-docs` fails on it. Each suggestion is named after the **column it matched on**,
since three `HAS_<TABLE>` names in one list are three suggestions nobody can tell apart.

**It runs on arrival; there is no button.** The *Curated by AI* control is gone (removed on request) —
a reader who had just profiled 18 tables met a tab reporting no relationships until they pressed it.
The effect is keyed `sourceId:tableCount`, so the store's re-read after a save does not start a run
and profiling more tables does. The strip narrates it (*Reading the schema*). The cost: no way to ask
again for the same tables, so a rejected suggestion is gone until the profile changes.

**Every profiled table is scanned; the returned list is what `SUGGEST_RELATIONSHIP_CAP` (80) cuts**,
reported as `truncated` + `relationships_total`, recorded rows first so a cut takes column-name
matches before an authored one. It was a **table** cap (12), which made an unjoined table a claim
about the cap: 6 of an 18-table source looked unrelated when all 18 share an identifier.

**The orphan tile counts the tables no relationship on screen touches** — off `relationships`, the
same array the rail's em dash reads, so the tile and the row cannot disagree. It counted the server's
`orphan_tables` first and read **0** while a table with nothing on it sat selected beside it: the tab
drops a suggestion whose pair is already declared, and a reader rejects rows, either of which leaves
a table bare while the scan still says it found it something. The served list is kept for the hint —
how many are unjoined *in the data* against how many had their suggestions rejected. `—` before a
run, and inert; the table list's own em-dash row is the naming. **CAPEX's 18 `plan` tables give 53
suggestions**, of which 47 carry **no cardinality** — a dictionary-declared column has no distinct
count, so there is nothing to derive one from and the reviewer sets it on confirm.

### Failure modes, and what each one looks like

- A source with nothing profiled → the canvas states it and names the Catalog tab, and the
  suggestions route refuses with the same fix rather than answering an empty list.
- A drive or a mailbox reaching the suggestions route → `wrongStructuredOnly` refuses, states what the source
  holds, says there is no modelling route for it, and names its catalogue. It does **not** point at
  the structured route, which would fail the same way.
- An entity on a table the document no longer carries → the server refuses to boot, naming the
  entity and the table. Same for a relationship onto one, and for two entities on one table.
- Deleting a relationship → the canvas stops drawing it and the two entities keep their own
  declarations. It used to cascade into the metrics built on it; the Metrics sub-tab is gone, so
  there is nothing left to cascade into and the write clears the relationship and nothing else.
- A page that looks stale after an edit → every write re-reads the declarations, so the tab renders
  the server's copy rather than an optimistic guess at it.

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

Entry in `data/connectors.ts` with its `fields`, and `profiles` declared. `available: false`
needs a `reason`. Making it real means a step-2 branch in the wizard and server support;
`ConnectorIcon` needs a mark, or the card draws no vendor logo.

**Making a connector profilable** is six things, and each one fails a different silent way:

1. Its pipeline in `PROFILERS` — five stages, so a job row reads the same as the others'.
2. Its row in `CATALOGUE_ROUTES`, or its endpoints refuse every request naming no twin.
   The boot stops on a pipeline with no routes, so this cannot be forgotten.
3. Its branches in `commitNextObject` and `recount`, or a run commits nothing and the
   counters never move.
4. Its three endpoints — browse, profile, dictionary — each with a schema in `client.ts`
   and a store slice, plus a `rerun` case in `useJobsStore` (an `else` there names
   BigQuery's endpoint *and* its field names, so a missing case posts the wrong body).
5. Its member in `PROFILE_KINDS`, and a member in `PROFILE_UNITS` **only if it profiles a new
   kind of object** — one declaration drives the union and the `oneOf`, and widening one
   without the other refuses a correct payload. Gmail added a kind and no unit: it profiles
   documents, like Drive, and a second name for one thing is worse than none.
6. Its row in `src/data/catalogUnits.ts`, or the Catalog leaves it out — which is the
   deliberate behaviour, because drawing it in another connector's nouns would call a
   mailbox a GCP project.

If it is *also* read at question time, add it to `RUNTIME_KINDS` **and**
`CATALOGUE_ONLY_KINDS`: the overlap is allowed and must be declared, and an undeclared one
stops the boot.

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
