/*
 * Connector Catalog for the "Connect a source" wizard.
 *
 * `available` mirrors the product reality in the reference design: BigQuery
 * (structured) and Google Drive (unstructured) are the working connectors; the
 * rest are listed so the roadmap is visible, and selecting one explains why it
 * cannot be used yet. Flip `available` to true to enable one.
 */

import { SOURCE_NAME_MIN } from './sourceName'

/**
 * What kind of control a connector field asks for.
 *
 * `number` is here because a port is a number, and typing one into a text box that accepts
 * `localhost` is a field whose validation says nothing about what it holds. It is the narrowest
 * addition that covers the three database connectors; nothing else here needs one.
 */
export type FieldKind = 'text' | 'secret' | 'select' | 'number'

export interface ConnectorField {
  name: string
  label: string
  kind: FieldKind
  placeholder?: string
  help?: string
  options?: string[]
  multiple?: boolean
  required?: boolean
  /** Shortest acceptable value. Only the source name has one — see sourceName.ts. */
  minLength?: number
}

export interface Connector {
  key: string
  name: string
  blurb: string
  /** Shown on the source row once registered. */
  typeLabel: string
  available: boolean
  /**
   * Whether connecting this source produces a catalogue.
   *
   * **Connecting and profiling are still two acts** — every source here is registered first and
   * profiled second — but all three real connectors now do both: tables into columns, documents
   * into entities, messages into entities. What is left on `false` is the stubbed connectors,
   * which have no pipeline behind them at all.
   *
   * Declared rather than inferred from the key, because "the Google ones" is a set of names that a
   * fourth profilable connector would silently fall outside of — and the server derives the same
   * fact from whether a pipeline exists, so `check-docs` can hold the two answers against each
   * other. A card has to state it before anybody has connected anything, which is why it is
   * declared here as well as derived there.
   *
   * It says nothing about the **graph**. Mail is profiled for its catalogue and read at question
   * time, so nothing its profile holds becomes a graph element; `runtime` on the step-4 payload is
   * the flag for that, and the two are deliberately separate answers.
   */
  profiles: boolean
  fields: ConnectorField[]
  /**
   * Which of this connector's own fields is *what the source connected as* — the Sources row's
   * account cell, where BigQuery's reads a project and Gmail's an address.
   *
   * **Optional, and absent means the row prints an em dash**, which is what every generic
   * connector's row does today. A field the whole array does not share is not a required field —
   * the What-if authoring steps' `help` learned that once, where declaring it on all of them made
   * one absent string refuse the whole payload. It names a *field*, never a value: the wizard reads
   * it out of the form, so a connector cannot come to state an account it never asked for.
   */
  accountField?: string
  /** Which field states what is in scope — the row's scope cell. Optional for the same reason. */
  scopeField?: string
  /** Why it is not usable yet — surfaced when an unavailable card is picked. */
  reason?: string
}

/**
 * Every connector takes a display name; credentials are always by reference.
 *
 * The same floor the two Google branches apply, from the same constant — a
 * stubbed connector's row sits in the same Sources table, so "db" is no more
 * readable here than there.
 */
const nameField: ConnectorField = {
  name: 'sourceName',
  label: 'Source name',
  kind: 'text',
  placeholder: 'Orders warehouse',
  help: `How this source appears in the Catalog and lineage graph. At least ${SOURCE_NAME_MIN} characters.`,
  required: true,
  minLength: SOURCE_NAME_MIN,
}

const secretField = (placeholder: string): ConnectorField => ({
  name: 'credentialRef',
  label: 'Credential reference',
  kind: 'secret',
  placeholder,
  help: 'A pointer into your secret manager. ContextWeave never stores a raw secret.',
  required: true,
})

export const CONNECTORS: Connector[] = [
  {
    key: 'bigquery',
    name: 'Google BigQuery',
    blurb: 'real connector — MVP',
    typeLabel: 'BigQuery',
    available: true,
    profiles: true,
    fields: [
      nameField,
      {
        name: 'projectId',
        label: 'GCP project ID',
        kind: 'text',
        placeholder: 'contextweave-prod',
        required: true,
      },
      {
        name: 'datasets',
        label: 'Datasets',
        kind: 'select',
        options: ['analytics', 'commerce', 'finance', 'growth', 'raw_events'],
        multiple: true,
        help: 'Leave empty to profile every dataset the service account can read.',
      },
      {
        name: 'location',
        label: 'Location',
        kind: 'select',
        options: ['US', 'EU', 'asia-south1', 'europe-west2'],
        required: true,
      },
      secretField('secret://gcp/bigquery-reader'),
    ],
  },
  {
    key: 'gdrive',
    name: 'Google Drive',
    blurb: 'real connector — docs, sheets, files',
    typeLabel: 'Google Drive',
    available: true,
    profiles: true,
    fields: [
      nameField,
      {
        name: 'folderId',
        label: 'Drive or folder ID',
        kind: 'text',
        placeholder: '1A2b3C4d5E6f7G8h9I0j',
        required: true,
      },
      {
        name: 'fileTypes',
        label: 'File types',
        kind: 'select',
        options: ['Google Docs', 'PDFs', 'Sheets', 'Slides', 'Plain text'],
        multiple: true,
        help: 'Anything not selected is skipped by the document profiler.',
      },
      secretField('secret://google/drive-oauth-client'),
    ],
  },
  {
    /*
     * **The third real connector.** Connecting proves the credential reaches a mailbox and records
     * what it was pointed at: which labels, which search, whether attachments are in scope.
     *
     * `profiles: true`, because there is a mail pipeline behind it — the messages under the
     * connected labels become a catalogue of extracted entities, browsable and reviewable exactly
     * as a drive's documents are. It was `false` while there was no pipeline for the kind, and the
     * Data Catalog left a mailbox out and said why.
     *
     * **What that does not change is where a mail profile may travel.** Gmail is still the one
     * runtime kind: its extractions are observations resolved when a question needs them, and
     * nothing in its catalogue becomes a graph element. Profiling and graph derivation are two
     * questions, and `CATALOGUE_ONLY_KINDS` on the server is where the pair is declared.
     *
     * **It takes no fields here.** Like the other two Google connectors it runs consent → preview →
     * finish against the API, so what it needs is a name and what the mailbox itself reports; the
     * generic field loop is for the connectors that have no branch of their own.
     */
    key: 'gmail',
    name: 'Gmail',
    blurb: 'real connector — email + attachments',
    typeLabel: 'Gmail',
    available: true,
    profiles: true,
    fields: [nameField],
  },
  /* ---------------- The three database connectors ----------------
   *
   * **They register a connection and they profile nothing, and both halves are said out loud.**
   * A card here carries `available: true` because clicking it really does something — step 2 asks
   * for the details this engine needs and Finish writes a source onto the Sources table — and
   * `profiles: false` because there is no pipeline behind the kind, so the Data Catalog leaves the
   * row out and states the count it left out. The directory puts them in a section of their own for
   * exactly that reason: under *Available now* beside BigQuery a database card would promise a
   * catalogue, and under *Product vision* it would refuse a click that works.
   *
   * **The fields are each engine's own, not one form with an Engine dropdown.** That dropdown is
   * what the `sql` card below still is, and it is the reason it stays vision: "Host · Database" is
   * the shape of a MySQL connection and not of a Snowflake one, which has no host at all. A form
   * that asked for a port and then ignored it on one engine would be a control that does nothing.
   *
   * **The credential is still by reference.** Every one of these takes a `secret://` pointer and no
   * password field, which is the promise step 2's own alert makes — a raw secret typed into this
   * wizard would be a secret this app had persisted.
   */
  {
    key: 'mysql',
    name: 'MySQL',
    blurb: 'registers a connection — no profiler yet',
    typeLabel: 'MySQL',
    available: true,
    profiles: false,
    /* The address it connected to, which is what a database's row can honestly state where
       BigQuery's states a project. The user is a field of its own; it is not the *thing* connected. */
    accountField: 'host',
    scopeField: 'database',
    fields: [
      nameField,
      {
        name: 'host',
        label: 'Host',
        kind: 'text',
        placeholder: 'mysql-prd.internal',
        required: true,
      },
      { name: 'port', label: 'Port', kind: 'number', placeholder: '3306', required: true },
      {
        name: 'database',
        label: 'Database',
        kind: 'text',
        placeholder: 'orders',
        required: true,
      },
      {
        name: 'username',
        label: 'Username',
        kind: 'text',
        placeholder: 'contextweave_reader',
        help: 'A read-only account. Nothing here writes to the source.',
        required: true,
      },
      {
        name: 'sslMode',
        label: 'TLS mode',
        kind: 'select',
        options: ['DISABLED', 'PREFERRED', 'REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY'],
        help: "MySQL's own five modes, as the server names them.",
        required: true,
      },
      secretField('secret://mysql/orders-reader'),
    ],
  },
  {
    key: 'postgres',
    name: 'PostgreSQL',
    blurb: 'registers a connection — no profiler yet',
    typeLabel: 'PostgreSQL',
    available: true,
    profiles: false,
    accountField: 'host',
    scopeField: 'database',
    fields: [
      nameField,
      {
        name: 'host',
        label: 'Host',
        kind: 'text',
        placeholder: 'pg-prd.internal',
        required: true,
      },
      { name: 'port', label: 'Port', kind: 'number', placeholder: '5432', required: true },
      {
        name: 'database',
        label: 'Database',
        kind: 'text',
        placeholder: 'capital_programme',
        required: true,
      },
      {
        /*
         * Optional, and it is the one field here that is genuinely a narrowing rather than an
         * address: Postgres puts several schemas in one database, so leaving it blank means every
         * schema the role can read — which the help line says rather than leaving the reader to
         * infer it from an empty box.
         */
        name: 'schema',
        label: 'Schema',
        kind: 'text',
        placeholder: 'public',
        help: 'Leave empty to reach every schema this role can read.',
      },
      {
        name: 'username',
        label: 'Username',
        kind: 'text',
        placeholder: 'contextweave_reader',
        help: 'A read-only role. Nothing here writes to the source.',
        required: true,
      },
      {
        name: 'sslMode',
        label: 'SSL mode',
        kind: 'select',
        /* libpq's own six, spelled as libpq spells them. */
        options: ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'],
        help: "libpq's own modes, in libpq's spelling.",
        required: true,
      },
      secretField('secret://postgres/capital-reader'),
    ],
  },
  {
    /*
     * **Snowflake has no host and no port**, which is the whole reason these are three cards rather
     * than one form with an Engine dropdown. It is addressed by an *account identifier*, and what it
     * runs a query on — the warehouse — is a separate thing again from what it reads.
     */
    key: 'snowflake',
    name: 'Snowflake',
    blurb: 'registers a connection — no profiler yet',
    typeLabel: 'Snowflake',
    available: true,
    profiles: false,
    accountField: 'account',
    scopeField: 'database',
    fields: [
      nameField,
      {
        name: 'account',
        label: 'Account identifier',
        kind: 'text',
        placeholder: 'ab12345.eu-west-1',
        help: 'The organisation-account form from your Snowflake URL, without .snowflakecomputing.com.',
        required: true,
      },
      {
        name: 'warehouse',
        label: 'Warehouse',
        kind: 'text',
        placeholder: 'ANALYTICS_WH',
        help: 'The compute a query would run on — separate from the data it reads.',
        required: true,
      },
      {
        name: 'database',
        label: 'Database',
        kind: 'text',
        placeholder: 'CAPITAL_PROGRAMME',
        required: true,
      },
      { name: 'schema', label: 'Schema', kind: 'text', placeholder: 'PUBLIC' },
      {
        name: 'role',
        label: 'Role',
        kind: 'text',
        placeholder: 'CONTEXTWEAVE_READER',
        help: 'Snowflake resolves grants through the role, so this decides what is reachable.',
        required: true,
      },
      {
        name: 'username',
        label: 'Username',
        kind: 'text',
        placeholder: 'CONTEXTWEAVE',
        required: true,
      },
      secretField('secret://snowflake/contextweave-keypair'),
    ],
  },
  {
    /**
     * **Outlook is product vision, and the reason is the corpus rather than the API.**
     *
     * Microsoft Graph's mail endpoints are the easy half; what a mail connector has to produce
     * here is a mailbox with an address, a set of filing labels and a body of correspondence
     * that questions can be read against. Gmail derives all three from things this tenant
     * really has — `settings.users` for the people, Gmail's own six labels, and the recorded
     * answers whose runtime citations name it. **None of that exists for Outlook**, and the two
     * ways to make the card work anyway are both dishonest: reusing Gmail’s labels would put
     * Gmail's filing on a Microsoft mailbox, and inventing folders would put correspondence in
     * the console that nobody wrote.
     *
     * So it explains itself instead, like the other four. Making it real is a corpus decision
     * before it is a connector one — see the Gmail section of CLAUDE.md for what it would need.
     */
    key: 'outlook',
    name: 'Microsoft Outlook',
    blurb: 'email + attachments',
    typeLabel: 'Outlook',
    available: false,
    profiles: false,
    reason:
      'The mail pipeline behind Gmail is connector-agnostic, so Outlook would reuse it — what is missing is the mailbox itself. Gmail derives its address, its labels and its correspondence from data this tenant really holds; there is no Outlook equivalent yet, and inventing one would put mail in the console that nobody sent.',
    fields: [
      nameField,
      {
        name: 'tenantId',
        label: 'Microsoft tenant ID',
        kind: 'text',
        placeholder: '72f988bf-86f1-41af-91ab-2d7cd011db47',
        required: true,
      },
      {
        name: 'mailbox',
        label: 'Mailbox',
        kind: 'text',
        placeholder: 'dana.whitfield@vriodigital.com',
        required: true,
      },
      {
        name: 'folders',
        label: 'Folders',
        kind: 'select',
        options: ['Inbox', 'Sent Items', 'Archive', 'Deleted Items'],
        multiple: true,
        help: 'Leave empty to read every folder the application registration can see.',
      },
      secretField('secret://microsoft/graph-mail-reader'),
    ],
  },
  {
    key: 'sap',
    name: 'SAP PM / S4HANA',
    blurb: 'asset & work-order master',
    typeLabel: 'SAP',
    available: false,
    profiles: false,
    reason:
      'Work-order and functional-location master data needs the IDoc/OData bridge, which is on the ' +
      'roadmap behind the two Google connectors. Registration is stubbed until then.',
    fields: [
      nameField,
      { name: 'host', label: 'Application server', kind: 'text', placeholder: 'sap-prd.internal', required: true },
      { name: 'client', label: 'Client', kind: 'text', placeholder: '400', required: true },
      secretField('secret://sap/odata-reader'),
    ],
  },
  {
    key: 'osipi',
    name: 'OSIsoft PI',
    blurb: 'historian / telemetry',
    typeLabel: 'OSIsoft PI',
    available: false,
    profiles: false,
    reason:
      'A historian is a time series per tag, not a table of rows — the dictionary needs a tag-level ' +
      'profile the column profiler cannot produce. That design is still open.',
    fields: [
      nameField,
      { name: 'server', label: 'PI Data Archive', kind: 'text', placeholder: 'pi-archive.internal', required: true },
      { name: 'tags', label: 'Tag filter', kind: 'text', placeholder: 'PLANT1.*' },
      secretField('secret://osisoft/pi-web-api'),
    ],
  },
  {
    key: 'sharepoint',
    name: 'SharePoint / docs',
    blurb: 'contracts · manuals · PDFs',
    typeLabel: 'SharePoint',
    available: false,
    profiles: false,
    reason:
      'Shares the document profiler with Drive, but Microsoft Graph consent and site-level ' +
      'permissions are still being designed, so credentials cannot be validated yet.',
    fields: [
      nameField,
      { name: 'siteUrl', label: 'Site URL', kind: 'text', placeholder: 'https://tenant.sharepoint.com/sites/capital', required: true },
      {
        name: 'libraries',
        label: 'Document libraries',
        kind: 'select',
        options: ['Contracts', 'Manuals', 'Drawings', 'Correspondence'],
        multiple: true,
      },
      secretField('secret://microsoft/graph-app'),
    ],
  },
  {
    /*
     * **What is left of the generic SQL card, and why it is still one card.**
     *
     * It used to read *"Postgres · MySQL · MSSQL · Oracle"*, and three of those four now have cards
     * of their own. Leaving it as it was would have made Postgres both available and product
     * vision — two answers to the same question, on two cards a reader sees side by side. Deleting
     * it would have dropped MSSQL and Oracle out of the directory with nothing accounting for the
     * difference, which is the shorter-list-is-not-a-message failure this repo refuses.
     *
     * So it is narrowed to the two engines that have no card, and its Engine dropdown is exactly
     * why: a MySQL connection is a host and a port, a Snowflake one is an account identifier and a
     * warehouse, and one form behind a dropdown either asks for fields an engine does not have or
     * ignores the ones it does. The three that shipped are three forms.
     */
    key: 'sql',
    name: 'SQL database',
    blurb: 'MSSQL · Oracle',
    typeLabel: 'SQL database',
    available: false,
    profiles: false,
    reason:
      'MySQL, PostgreSQL and Snowflake have connectors of their own above — each asks for the ' +
      'details its own engine actually takes. MSSQL and Oracle have neither a form nor a driver ' +
      'here yet, and the shape of a connection differs enough per engine that one card behind an ' +
      'Engine dropdown would ask for fields the engine does not have.',
    fields: [
      nameField,
      {
        name: 'engine',
        label: 'Engine',
        kind: 'select',
        options: ['MSSQL', 'Oracle'],
        required: true,
      },
      { name: 'host', label: 'Host', kind: 'text', placeholder: 'db.internal', required: true },
      { name: 'database', label: 'Database', kind: 'text', placeholder: 'orders', required: true },
      secretField('secret://db/readonly'),
    ],
  },
]

/**
 * Which of the three things a connector is — the one distinction step 1 is arranged around.
 *
 * **`available` alone stopped being enough the day a connector could register a source without
 * profiling it.** It used to answer both "can this be clicked" and "is this real", because every
 * connector that could be clicked also carried a catalogue. The database connectors separate the
 * two: clicking one really registers a source, and nothing profiles it.
 *
 * So the group is derived from the two facts already declared rather than from a third field
 * nobody would keep in step:
 *
 *  - `profiling` — registers a source **and** carries a catalogue. The three Google connectors.
 *  - `credentials` — registers a source from the connection details typed into step 2, and carries
 *    no catalogue. The three database connectors.
 *  - `vision` — not built; clicking one shows its `reason`.
 *
 * The middle group has to be its own section wherever these are listed: under *Available now*
 * beside BigQuery a database card promises a catalogue it does not have, and under *Product
 * vision* it refuses a click that works.
 */
export type ConnectorGroup = 'profiling' | 'credentials' | 'vision'

export function connectorGroup(connector: Connector): ConnectorGroup {
  if (!connector.available) return 'vision'
  return connector.profiles ? 'profiling' : 'credentials'
}

/*
 * **The four pre-grouped lists are gone, and that is a removal rather than an oversight.**
 *
 * `AVAILABLE_CONNECTORS` had one reader — step 1's note, which now composes itself per group
 * through `connectorPickerNote` — and `VISION_CONNECTORS` had none even before that. Two more were
 * added with the database connectors and were read by nothing but the smoke assertions that had
 * just been written for them.
 *
 * A constant nothing imports is dead state that reads as a feature: the next reader takes it for
 * the way this list is meant to be sliced and adds a fifth. Everything that needs a slice has
 * `connectorGroup` and `CONNECTORS`, which is one definition and one array.
 */
