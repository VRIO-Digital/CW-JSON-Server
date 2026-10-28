/**
 * Load and merge all SUPPLYCHAIN split JSON files into a single document
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SUPPLYCHAIN_DIR = join(__dirname, 'supplychain')

/**
 * The list of split SUPPLYCHAIN files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const SUPPLYCHAIN_FILES = [
  'supplychain_sources.json',
  'supplychain_catalogue.json',
  'supplychain_new_graph.json',
  'supplychain_graph_studio.json',
  'supplychain_reports.json',
  'supplychain_ask.json',
  'supplychain_whatif.json',
  'supplychain_audit_governance.json',
  /* The package's three fragments: the New Role wizard's library, and the Goals and
     Submissions builds' scripted state. Loaded last; none of their keys collides with another file's. */
  'supplychain_new_role.json',
  'supplychain_goals.json',
  'supplychain_submissions.json',
]

/**
 * Load all SUPPLYCHAIN split files and merge them into a single document.
 * This replaces reading a single db.SUPPLYCHAIN.json file.
 * Also loads shared settings from backend/settings.json
 */
export async function loadSupplychainDocument() {
  const mergedDoc = {}

  for (const filename of SUPPLYCHAIN_FILES) {
    try {
      const filepath = join(SUPPLYCHAIN_DIR, filename)
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
    const settingsPath = join(dirname(SUPPLYCHAIN_DIR), 'settings.json')
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
 * Alternative: Load a specific SUPPLYCHAIN file by name (for debugging/testing)
 */
export async function loadSupplychainFile(filename) {
  const filepath = join(SUPPLYCHAIN_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
