/**
 * Load and merge all VLS split JSON files into a single document — the fourth loader, the same
 * shape as `epa-loader.js`, `capex-loader.js` and `keolis-loader.js`.
 *
 * The split files are written from the VLS Gulf Coast demo package's merged document (its
 * `db.V.json` — the V is VLS; the reference copy was removed once split), and written back by
 * `commitDb` through `writeSplitFiles`.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VLS_DIR = join(__dirname, 'vls')

/**
 * The list of split VLS files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const VLS_FILES = [
  'vls_sources.json',
  'vls_catalogue.json',
  'vls_new_graph.json',
  'vls_graph_studio.json',
  'vls_reports.json',
  'vls_ask.json',
  'vls_whatif.json',
  'vls_audit_governance.json',
]

/**
 * Load all VLS split files and merge them into a single document.
 * Also loads shared settings from backend/settings.json — after the dataset's own files, so the
 * tenant-level keys (users, personas, the account) are one answer for every dataset.
 */
export async function loadVlsDocument() {
  const mergedDoc = {}

  for (const filename of VLS_FILES) {
    try {
      const filepath = join(VLS_DIR, filename)
      const content = await readFile(filepath, 'utf8')
      const data = JSON.parse(content)

      // Merge all keys from this file into the merged document
      Object.assign(mergedDoc, data)
      console.log(`✓ Loaded ${filename}`)
    } catch (error) {
      throw new Error(`Failed to load ${filename}: ${error.message}`)
    }
  }

  // Load shared settings from backend/settings.json
  try {
    const settingsPath = join(dirname(VLS_DIR), 'settings.json')
    const content = await readFile(settingsPath, 'utf8')
    const settingsData = JSON.parse(content)
    Object.assign(mergedDoc, settingsData)
    console.log(`✓ Loaded settings.json (shared)`)
  } catch (error) {
    console.log(`ℹ Settings.json not found or empty (will use defaults)`)
  }

  return mergedDoc
}

/**
 * Alternative: Load a specific VLS file by name (for debugging/testing)
 */
export async function loadVlsFile(filename) {
  const filepath = join(VLS_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
