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






/** Gmail's envelope, in its own four colours. */
export function GmailIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Gmail">
      <path d="M2.4 6.6v11.2c0 .6.5 1.1 1.1 1.1h2.6V10L12 14.2 17.9 10v8.9h2.6c.6 0 1.1-.5 1.1-1.1V6.6" fill="#FFFFFF" />
      <path d="M2.4 6.6c0-.9.7-1.6 1.6-1.6.4 0 .7.1 1 .3L12 10.4 19 5.3c.3-.2.6-.3 1-.3.9 0 1.6.7 1.6 1.6v.6L12 14.2 2.4 7.2z" fill="#EA4335" />
      <path d="M2.4 7.2 12 14.2V19H3.5c-.6 0-1.1-.5-1.1-1.1z" fill="#C5221F" />
      <path d="M21.6 7.2 12 14.2V19h8.5c.6 0 1.1-.5 1.1-1.1z" fill="#34A853" />
      <path d="M2.4 6.6v.6L12 14.2l9.6-7v-.6c0-.9-.7-1.6-1.6-1.6-.4 0-.7.1-1 .3L12 10.4 5 5.3c-.3-.2-.6-.3-1-.3-.9 0-1.6.7-1.6 1.6z" fill="#FBBC04" />
    </svg>
  )
}

/** SAP's frame — the wordmark's shape rather than its letters, which do not survive 20px. */
export function SapIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="SAP">
      <path d="M2 6h20l-3.4 12H2z" fill="#0FAAFF" />
      <path d="M2 6h10v12H2z" fill="#0076CB" />
    </svg>
  )
}

/** OSIsoft PI — a historian, drawn as the trace it stores. */
export function OsiPiIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="OSIsoft PI">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="#F1F5F9" stroke="#64748B" strokeWidth="1.3" />
      <path
        d="M5.5 15.5l3-4.5 2.6 3 2.4-6 2.6 5 2.4-2.5"
        fill="none"
        stroke="#0F766E"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** SharePoint — a document library, which is what this connector reads. */
export function SharePointIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="SharePoint">
      <path d="M7 2.6h7.2L19 7.4V21a.8.8 0 0 1-.8.8H7a.8.8 0 0 1-.8-.8V3.4A.8.8 0 0 1 7 2.6z" fill="#E7F1FA" stroke="#036C70" strokeWidth="1.3" />
      <path d="M14.2 2.6V7.4H19" fill="none" stroke="#036C70" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 12.5h7M9 15.5h7M9 18h4.5" stroke="#038387" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** A SQL database — the cylinder, because the connector spans four engines and belongs to none. */
export function SqlDatabaseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="SQL database">
      <ellipse cx="12" cy="6" rx="7.5" ry="3" fill="#EEF2F7" stroke="#475569" strokeWidth="1.3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" fill="none" stroke="#475569" strokeWidth="1.3" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" fill="none" stroke="#94A3B8" strokeWidth="1.2" />
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
  gmail: GmailIcon,
  sap: SapIcon,
  osipi: OsiPiIcon,
  sharepoint: SharePointIcon,
  sql: SqlDatabaseIcon,
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
