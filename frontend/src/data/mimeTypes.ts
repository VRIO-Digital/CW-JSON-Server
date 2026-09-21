/*
 * Drive files come back as MIME types; the UI wants a short chip. Shared by the
 * document browse tree and the document dictionary so one file cannot be
 * labelled "DOCUMENT" in one panel and "GDOC" in the other.
 */

/**
 * The types a chip has a short name for.
 *
 * Office types are here because the generic rule below cannot help them: the subtype of a `.docx`
 * is `vnd.openxmlformats-officedocument.wordprocessingml.document`, so uppercasing it puts
 * `VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT` on a chip meant to hold four
 * letters. A corpus carrying one is what makes this reachable, and it renders as a broken cell
 * rather than as a wrong one — which is why it went unnoticed while every document was a PDF.
 */
const KIND_FOR_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/plain': 'TEXT',
  'text/csv': 'CSV',
  'text/tab-separated-values': 'TSV',
  'text/markdown': 'MD',
  'application/json': 'JSON',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
}

export function fileKind(mimeType: string) {
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    return mimeType.slice('application/vnd.google-apps.'.length).toUpperCase()
  }
  const known = KIND_FOR_MIME[mimeType]
  if (known) return known
  /*
   * The fallback takes the **last** dot-segment of the subtype rather than the whole of it, so an
   * unmapped vendor type still reads as a word (`vnd.oasis.opendocument.spreadsheet` →
   * `SPREADSHEET`). It is never truncated: a clipped chip asserts a type that does not exist, and a
   * default may be plainer than the real thing but must not say something false.
   */
  const subtype = mimeType.split('/').pop()
  if (!subtype) return 'FILE'
  return (subtype.split('.').pop() || subtype).toUpperCase()
}
