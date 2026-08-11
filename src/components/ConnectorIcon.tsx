/*
 * Vendor marks for the connectors, drawn inline so nothing is fetched at
 * runtime. Used to identify the product a source belongs to.
 */

export function BigQueryIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Google BigQuery"
    >
      <path d="M12 1.9 20.7 6.9v10.2L12 22.1 3.3 17.1V6.9z" fill="#4285F4" />
      <circle
        cx="11.2"
        cy="11.2"
        r="3.5"
        fill="none"
        stroke="#fff"
        strokeWidth="1.7"
      />
      <path
        d="m13.9 13.9 3.1 3.1"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function GoogleDriveIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 87.3 78"
      role="img"
      aria-label="Google Drive"
    >
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  )
}

export function GcsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Google Cloud Storage"
    >
      {/* A bucket: wide mouth, tapered body. Google blue. */}
      <path d="M3.4 5h17.2l-2.1 13.4a1.6 1.6 0 0 1-1.6 1.4H7.1a1.6 1.6 0 0 1-1.6-1.4z" fill="#4285F4" />
      <rect x="7.6" y="10.4" width="8.8" height="1.9" rx=".95" fill="#fff" />
      <rect x="2.4" y="3.4" width="19.2" height="2.9" rx="1.45" fill="#1A73E8" />
    </svg>
  )
}

export function S3Icon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Amazon S3 bucket"
    >
      {/* The same bucket form as GCS, because both are object stores — the
          colour is what tells them apart, exactly as the real marks do. */}
      <path d="M3.4 5h17.2l-2.1 13.4a1.6 1.6 0 0 1-1.6 1.4H7.1a1.6 1.6 0 0 1-1.6-1.4z" fill="#E25444" />
      <rect x="7.6" y="10.4" width="8.8" height="1.9" rx=".95" fill="#fff" />
      <rect x="2.4" y="3.4" width="19.2" height="2.9" rx="1.45" fill="#C7361F" />
    </svg>
  )
}

export function PostgresIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="PostgreSQL"
    >
      {/* A database cylinder in PostgreSQL's blue, not the elephant: a badly
          drawn elephant reads as a mistake, and a cylinder plus the label
          beside it identifies the thing without pretending to be the logo. */}
      <ellipse cx="12" cy="5.6" rx="7.4" ry="2.7" fill="#336791" />
      <path d="M4.6 5.6v12.8c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7V5.6z" fill="#336791" />
      <path
        d="M4.6 10.2c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7M4.6 14.8c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7"
        fill="none"
        stroke="#fff"
        strokeWidth="1.2"
        opacity=".55"
      />
    </svg>
  )
}

export function SnowflakeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Snowflake"
    >
      <g
        stroke="#29B5E8"
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
        transform="translate(12 12)"
      >
        {[0, 60, 120].map((deg) => (
          <g key={deg} transform={`rotate(${deg})`}>
            <path d="M0-8.4V8.4" />
            <path d="M-2.6-5.8 0-8.4l2.6 2.6" />
            <path d="M-2.6 5.8 0 8.4l2.6-2.6" />
          </g>
        ))}
      </g>
    </svg>
  )
}

export function MongoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="MongoDB">
      {/* The leaf. */}
      <path
        d="M12 1.8c2.9 3.4 5.3 6.6 5.3 10.4 0 3.6-2.2 6.6-5.3 8.2-3.1-1.6-5.3-4.6-5.3-8.2C6.7 8.4 9.1 5.2 12 1.8z"
        fill="#47A248"
      />
      <path d="M12 4.4v17.8" stroke="#2F6B2F" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

/** A store nobody has a mark for. Neutral, and it says which one it is. */
export function GenericSourceIcon({
  size = 20,
  label,
}: {
  size?: number
  label?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label ? `${label} source` : 'Data source'}
    >
      <ellipse cx="12" cy="5.6" rx="7.4" ry="2.7" fill="#8994a8" />
      <path d="M4.6 5.6v12.8c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7V5.6z" fill="#aab2c0" />
    </svg>
  )
}

const MARKS: Record<string, (props: { size?: number }) => JSX.Element> = {
  bigquery: BigQueryIcon,
  gdrive: GoogleDriveIcon,
  gcs: GcsIcon,
  s3: S3Icon,
  postgres: PostgresIcon,
  snowflake: SnowflakeIcon,
  mongodb: MongoIcon,
}

/**
 * Picks the mark for a connector key.
 *
 * **An unknown key gets the neutral store, not BigQuery's.** This used to fall
 * back to `BigQueryIcon`, which meant every connector without a mark of its own —
 * five of the seven — was drawn as BigQuery. A wrong vendor logo is not a
 * cosmetic default: it is the card claiming to be a product it is not, and it was
 * invisible for exactly as long as nothing rendered those five.
 */
export default function ConnectorIcon({
  connector,
  size = 20,
}: {
  connector: string
  size?: number
}) {
  const Mark = MARKS[connector]
  return Mark ? <Mark size={size} /> : <GenericSourceIcon size={size} label={connector} />
}
