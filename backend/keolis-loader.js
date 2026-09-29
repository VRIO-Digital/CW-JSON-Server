/**
 * Load and merge all KEOLIS split JSON files into a single document — the third loader, the same
 * shape as `epa-loader.js` and `capex-loader.js`.
 *
 * The split files are written by `npm run ingest:keolis` from the Keolis Valmont demo package
 * (`frontend/keolis/`), and written back by `commitDb` through `writeSplitFiles`.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEOLIS_DIR = join(__dirname, 'keolis')

/**
 * The list of split KEOLIS files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const KEOLIS_FILES = [
  'keolis_sources.json',
  'keolis_catalogue.json',
  'keolis_new_graph.json',
  'keolis_graph_studio.json',
  'keolis_reports.json',
  'keolis_ask.json',
  'keolis_whatif.json',
  'keolis_audit_governance.json',
]

/**
 * Load all KEOLIS split files and merge them into a single document.
 * Also loads shared settings from backend/settings.json — after the dataset's own files, so the
 * tenant-level keys (users, personas, the account) are one answer for every dataset.
 */
export async function loadKeolisDocument() {
  const mergedDoc = {}

  for (const filename of KEOLIS_FILES) {
    try {
      const filepath = join(KEOLIS_DIR, filename)
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
    const settingsPath = join(dirname(KEOLIS_DIR), 'settings.json')
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
 * Alternative: Load a specific KEOLIS file by name (for debugging/testing)
 */
export async function loadKeolisFile(filename) {
  const filepath = join(KEOLIS_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
