/*
 * Connector catalogue for the "Connect a source" wizard.
 *
 * `available` mirrors the product reality in the reference design: BigQuery
 * (structured) and Google Drive (unstructured) are the working connectors; the
 * rest are listed so the roadmap is visible, and selecting one explains why it
 * cannot be used yet. Flip `available` to true to enable one.
 */

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
}

export interface Connector {
  key: string
  name: string
  blurb: string
  /** Shown on the source row once registered. */
  typeLabel: string
  available: boolean
  fields: ConnectorField[]
  /** Why it is not usable yet — surfaced when an unavailable card is picked. */
  reason?: string
}

/** Every connector takes a display name; credentials are always by reference. */
const nameField: ConnectorField = {
  name: 'sourceName',
  label: 'Source name',
  kind: 'text',
  placeholder: 'Orders warehouse',
  help: 'How this source appears in the catalogue and lineage graph.',
  required: true,
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
    blurb: 'structured — tables & columns',
    typeLabel: 'BigQuery',
    available: true,
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
    blurb: 'unstructured — docs, PDFs, files',
    typeLabel: 'Google Drive',
    available: true,
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
    key: 'gcs',
    name: 'GCS bucket',
    blurb: 'objects — Parquet, CSV, JSON',
    typeLabel: 'Google Cloud Storage',
    available: false,
    reason:
      'Object-store profiling needs the schema-inference worker, which ships with the ' +
      'lake connector milestone. Registration is stubbed until then.',
    fields: [
      nameField,
      {
        name: 'bucket',
        label: 'Bucket',
        kind: 'text',
        placeholder: 'cw-raw-events',
        required: true,
      },
      { name: 'prefix', label: 'Prefix', kind: 'text', placeholder: 'events/v2/' },
      secretField('secret://gcp/gcs-reader'),
    ],
  },
  {
    key: 's3',
    name: 'Amazon S3 bucket',
    blurb: 'objects — Parquet, CSV, JSON',
    typeLabel: 'Amazon S3',
    available: false,
    reason:
      'Shares the object-store profiler with GCS. Cross-account role assumption is ' +
      'still being designed, so credentials cannot be validated yet.',
    fields: [
      nameField,
      {
        name: 'bucket',
        label: 'Bucket',
        kind: 'text',
        placeholder: 'cw-data-lake',
        required: true,
      },
      {
        name: 'region',
        label: 'Region',
        kind: 'select',
        options: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'],
        required: true,
      },
      { name: 'prefix', label: 'Prefix', kind: 'text', placeholder: 'curated/' },
      secretField('secret://aws/s3-reader-role'),
    ],
  },
  {
    key: 'postgres',
    name: 'PostgreSQL',
    blurb: 'structured — schemas & tables',
    typeLabel: 'PostgreSQL',
    available: false,
    reason:
      'The JDBC profiler works, but network egress to customer VPCs requires the ' +
      'private-link agent that is not released yet.',
    fields: [
      nameField,
      { name: 'host', label: 'Host', kind: 'text', placeholder: 'db.internal', required: true },
      { name: 'port', label: 'Port', kind: 'text', placeholder: '5432', required: true },
      { name: 'database', label: 'Database', kind: 'text', placeholder: 'orders', required: true },
      {
        name: 'schemas',
        label: 'Schemas',
        kind: 'select',
        options: ['public', 'billing', 'shipping', 'audit'],
        multiple: true,
      },
      secretField('secret://pg/orders-readonly'),
    ],
  },
  {
    key: 'snowflake',
    name: 'Snowflake',
    blurb: 'warehouse — databases & schemas',
    typeLabel: 'Snowflake',
    available: false,
    reason:
      'Warehouse metadata mapping is prototyped but key-pair auth and warehouse ' +
      'cost controls are unfinished.',
    fields: [
      nameField,
      {
        name: 'account',
        label: 'Account identifier',
        kind: 'text',
        placeholder: 'xy12345.ap-south-1',
        required: true,
      },
      {
        name: 'warehouse',
        label: 'Warehouse',
        kind: 'text',
        placeholder: 'PROFILER_WH',
        required: true,
      },
      { name: 'database', label: 'Database', kind: 'text', placeholder: 'ANALYTICS' },
      secretField('secret://snowflake/profiler-keypair'),
    ],
  },
  {
    key: 'mongodb',
    name: 'MongoDB',
    blurb: 'semi-structured — collections',
    typeLabel: 'MongoDB Atlas',
    available: false,
    reason:
      'Collections have no fixed schema, so the dictionary needs sampled-shape ' +
      'inference. That design is still open.',
    fields: [
      nameField,
      { name: 'database', label: 'Database', kind: 'text', placeholder: 'catalog', required: true },
      {
        name: 'collections',
        label: 'Collections',
        kind: 'select',
        options: ['products', 'variants', 'inventory', 'reviews'],
        multiple: true,
      },
      secretField('secret://mongo/atlas-connection-string'),
    ],
  },
]

export const AVAILABLE_CONNECTORS = CONNECTORS.filter((c) => c.available)
export const VISION_CONNECTORS = CONNECTORS.filter((c) => !c.available)
