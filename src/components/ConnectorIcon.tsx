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

/** Picks the mark for a connector key, falling back to BigQuery's. */
export default function ConnectorIcon({
  connector,
  size = 20,
}: {
  connector: string
  size?: number
}) {
  if (connector === 'gdrive') return <GoogleDriveIcon size={size} />
  return <BigQueryIcon size={size} />
}
