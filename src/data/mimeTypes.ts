/*
 * Drive files come back as MIME types; the UI wants a short chip. Shared by the
 * document browse tree and the document dictionary so one file cannot be
 * labelled "DOCUMENT" in one panel and "GDOC" in the other.
 */

export function fileKind(mimeType: string) {
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    return mimeType.slice('application/vnd.google-apps.'.length).toUpperCase()
  }
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType === 'text/plain') return 'TEXT'
  return mimeType.split('/').pop()?.toUpperCase() ?? 'FILE'
}
