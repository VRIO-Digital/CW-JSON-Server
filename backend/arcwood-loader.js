/**
 * Load and merge all ARCWOOD (Arcwood Heritage — the Ironbridge Environmental Services package) split JSON files into a single document
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARCWOOD_DIR = join(__dirname, 'arcwood')

/**
 * The list of split ARCWOOD files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const ARCWOOD_FILES = [
  'arcwood_sources.json',
  'arcwood_catalogue.json',
  'arcwood_new_graph.json',
  'arcwood_graph_studio.json',
  'arcwood_reports.json',
  'arcwood_ask.json',
  'arcwood_whatif.json',
  'arcwood_audit_governance.json',
  /* The package's three fragments: the New Role wizard's library, and the Goals and
     Submissions builds' scripted state. Loaded last; none of their keys collides with another file's. */
  'arcwood_new_role.json',
  'arcwood_goals.json',
  'arcwood_submissions.json',
]

/**
 * Load all ARCWOOD split files and merge them into a single document.
 * This replaces reading a single db.ARCWOOD.json file.
 * Also loads shared settings from backend/settings.json
 */
export async function loadArcwoodDocument() {
  const mergedDoc = {}

  for (const filename of ARCWOOD_FILES) {
    try {
      const filepath = join(ARCWOOD_DIR, filename)
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
    const settingsPath = join(dirname(ARCWOOD_DIR), 'settings.json')
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
 * Alternative: Load a specific ARCWOOD file by name (for debugging/testing)
 */
export async function loadArcwoodFile(filename) {
  const filepath = join(ARCWOOD_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
