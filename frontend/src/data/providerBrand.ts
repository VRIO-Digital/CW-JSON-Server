/**
 * The **provider brand**: which cloud vendor the selected dataset's tenant runs on.
 *
 * KEOLIS is the one Microsoft tenant — Microsoft for Keolis only, Google for CAPEX and VLS, asked
 * for in those terms — so under it the three real connectors present as **Azure
 * SQL Database, OneDrive and Microsoft Outlook**, and the consent is a Microsoft sign-in. Every other
 * dataset stays Google. **Nothing underneath changes**: the connector kinds are still
 * `bigquery` / `gdrive` / `gmail`, every endpoint, pipeline, store and payload shape is untouched,
 * and the server serves the matching vocabulary (Microsoft Graph scopes, Outlook's folders) off
 * the same declaration in `backend/datasets.js` (`PROVIDER_BRANDS`). The brand is what things are
 * *called*, never a second implementation — which is why it lives in `src/data/` as plain data.
 *
 * **Module-scope reads of the brand are safe**, for the same reason `src/api/dataset.ts` can be
 * read at module scope: changing dataset signs the reader out and reloads the whole document, so
 * the brand is fixed for the lifetime of a page. Nothing here needs to be reactive.
 *
 * Mirrors `PROVIDER_BRANDS` in `backend/datasets.js`; `check-docs` holds the two maps together.
 */

import { currentDataset } from '../api/dataset'

export type ProviderBrand = 'google' | 'microsoft'

/** Datasets whose tenant runs on Microsoft. A dataset with no entry is Google. */
export const PROVIDER_BRANDS: Record<string, ProviderBrand> = { KEOLIS: 'microsoft' }

export function providerBrandFor(dataset: string): ProviderBrand {
  return PROVIDER_BRANDS[dataset.trim().toUpperCase()] ?? 'google'
}

/** The brand every surface on this page renders under. */
export const providerBrand = (): ProviderBrand => providerBrandFor(currentDataset())

/**
 * Every brand-dependent word the connect flow and the gated pages print.
 *
 * One record per brand rather than ternaries at each call site — the `isDrive ? a : b` lesson
 * applied to vendors: a per-surface pair of names is what a third brand (or a renamed product)
 * would have to be edited into by hand, and a missed one silently shows the wrong vendor.
 *
 * The `*Source` phrases carry their own article ("a BigQuery project" / "an Azure SQL server"),
 * because the article changes with the noun and a sentence assembled around "a {noun}" would read
 * "a Azure SQL server".
 */
export interface BrandWords {
  /** The vendor, for every sentence that says whose sign-in or consent this is. */
  vendor: string
  /** What the vendor calls a personal account — "Google Account" / "Microsoft account". */
  account: string
  loginButton: string
  loginBusy: string
  /** The three real connectors' product names and row labels. */
  structuredName: string
  structuredType: string
  docsName: string
  docsType: string
  mailName: string
  mailType: string
  /** The structured container and what it holds — "GCP project"/"dataset", "Azure SQL server"/"database". */
  container: string
  containerNoun: string
  unitNoun: string
  /** The two halves of the document picker, keyed by the payload's own drive kinds. */
  driveKinds: Record<string, string>
  /** What mail is filed under — Gmail's "label", Outlook's "folder". */
  mailLabelNoun: string
  mailLabelsHeading: string
  mailSearchPlaceholder: string
  mailSearchNoun: string
  /** Noun phrases with their own article, for the gated pages' "connect a …" sentences. */
  structuredSource: string
  docsSource: string
  mailSource: string
}

export const BRAND_WORDS: Record<ProviderBrand, BrandWords> = {
  google: {
    vendor: 'Google',
    account: 'Google Account',
    loginButton: 'Login with Google',
    loginBusy: 'Opening Google…',
    structuredName: 'Google BigQuery',
    structuredType: 'BigQuery',
    docsName: 'Google Drive',
    docsType: 'Google Drive',
    mailName: 'Gmail',
    mailType: 'Gmail',
    container: 'GCP project',
    containerNoun: 'project',
    unitNoun: 'dataset',
    driveKinds: { my_drive: 'My Drive', shared_drive: 'Shared drive' },
    mailLabelNoun: 'label',
    mailLabelsHeading: 'Gmail’s own labels',
    mailSearchPlaceholder: 'Gmail search, e.g. from:@supplier.com after:2026/01/01',
    mailSearchNoun: 'Gmail search expression',
    structuredSource: 'a BigQuery project',
    docsSource: 'a Google Drive',
    mailSource: 'a Gmail mailbox',
  },
  microsoft: {
    vendor: 'Microsoft',
    account: 'Microsoft account',
    loginButton: 'Login with Microsoft',
    loginBusy: 'Opening Microsoft…',
    structuredName: 'Azure SQL Database',
    structuredType: 'Azure SQL Database',
    docsName: 'Microsoft OneDrive',
    docsType: 'OneDrive',
    mailName: 'Microsoft Outlook',
    mailType: 'Outlook',
    container: 'Azure SQL server',
    containerNoun: 'server',
    unitNoun: 'database',
    /* OneDrive's own split: a person's OneDrive, and the shared libraries an organisation owns. */
    driveKinds: { my_drive: 'OneDrive', shared_drive: 'Shared library' },
    mailLabelNoun: 'folder',
    mailLabelsHeading: 'Outlook’s own folders',
    mailSearchPlaceholder: 'Outlook search, e.g. from:supplier.com received>=2026-01-01',
    mailSearchNoun: 'Outlook search expression',
    structuredSource: 'an Azure SQL server',
    docsSource: 'a OneDrive',
    mailSource: 'an Outlook mailbox',
  },
}

/** The words for the brand this page runs under. */
export const brandWords = (): BrandWords => BRAND_WORDS[providerBrand()]

/**
 * The vendor mark a connector kind draws under the current brand.
 *
 * The *kinds* stay `bigquery` / `gdrive` / `gmail`, so under Microsoft they resolve to the
 * Microsoft marks by key — `ConnectorIcon` reads this, which is what moves every surface (the
 * Sources rows, the Catalog, the wizard's cards, the sign-in window's grant rows) at once. Any
 * key outside the three real kinds is its own mark under either brand.
 */
const MICROSOFT_MARKS: Record<string, string> = {
  bigquery: 'azuresql',
  gdrive: 'onedrive',
  gmail: 'outlook',
}

export const brandMarkKey = (connector: string): string =>
  providerBrand() === 'microsoft' ? (MICROSOFT_MARKS[connector] ?? connector) : connector
