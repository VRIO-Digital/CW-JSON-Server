/*
 * Connector Catalog for the "Connect a source" wizard.
 *
 * `available` mirrors the product reality in the reference design: BigQuery
 * (structured) and Google Drive (unstructured) are the working connectors; the
 * rest are listed so the roadmap is visible, and selecting one explains why it
 * cannot be used yet. Flip `available` to true to enable one.
 */

import { SOURCE_NAME_MIN } from './sourceName'

export type FieldKind = 'text' | 'secret' | 'select'

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
    key: 'sql',
    name: 'SQL database',
    blurb: 'Postgres · MySQL · MSSQL · Oracle',
    typeLabel: 'SQL database',
    available: false,
    profiles: false,
    reason:
      'The JDBC profiler works, but network egress to customer VPCs requires the private-link agent ' +
      'that is not released yet.',
    fields: [
      nameField,
      {
        name: 'engine',
        label: 'Engine',
        kind: 'select',
        options: ['PostgreSQL', 'MySQL', 'MSSQL', 'Oracle'],
        required: true,
      },
      { name: 'host', label: 'Host', kind: 'text', placeholder: 'db.internal', required: true },
      { name: 'database', label: 'Database', kind: 'text', placeholder: 'orders', required: true },
      secretField('secret://db/readonly'),
    ],
  },
]

export const AVAILABLE_CONNECTORS = CONNECTORS.filter((c) => c.available)
export const VISION_CONNECTORS = CONNECTORS.filter((c) => !c.available)
