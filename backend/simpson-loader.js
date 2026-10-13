/**
 * Load and merge all SIMPSON split JSON files into a single document — the same shape as
 * `epa-loader.js`, `capex-loader.js` and `keolis-loader.js`.
 *
 * The split files were written by `npm run ingest:simpson` from the Simpson (Ridgeline Structural
 * Products) demo package's merged `db.RIDGELINE.json` — the reference copy was removed once split,
 * so the committed split files are the store — and are written back by `commitDb` through
 * `writeSplitFiles`.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIMPSON_DIR = join(__dirname, 'simpson')

/**
 * The list of split SIMPSON files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const SIMPSON_FILES = [
  'simpson_sources.json',
  'simpson_catalogue.json',
  'simpson_new_graph.json',
  'simpson_graph_studio.json',
  'simpson_reports.json',
  'simpson_ask.json',
  'simpson_whatif.json',
  'simpson_audit_governance.json',
]

/**
 * Load all SIMPSON split files and merge them into a single document.
 * Also loads shared settings from backend/settings.json — after the dataset's own files, so the
 * tenant-level keys (users, personas, the account) are one answer for every dataset.
 */
export async function loadSimpsonDocument() {
  const mergedDoc = {}

  for (const filename of SIMPSON_FILES) {
    try {
      const filepath = join(SIMPSON_DIR, filename)
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
    const settingsPath = join(dirname(SIMPSON_DIR), 'settings.json')
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
 * Alternative: Load a specific SIMPSON file by name (for debugging/testing)
 */
export async function loadSimpsonFile(filename) {
  const filepath = join(SIMPSON_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
