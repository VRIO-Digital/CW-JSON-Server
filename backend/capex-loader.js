/**
 * Load and merge all CAPEX split JSON files into a single document
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CAPEX_DIR = join(__dirname, 'capex')

/**
 * The list of split CAPEX files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const CAPEX_FILES = [
  'capex_sources.json',
  'capex_catalogue.json',
  'capex_new_graph.json',
  'capex_graph_studio.json',
  'capex_reports.json',
  'capex_ask.json',
  'capex_whatif.json',
  'capex_audit_governance.json',
]

/**
 * Load all CAPEX split files and merge them into a single document.
 * This replaces reading a single db.CAPEX.json file.
 * Also loads shared settings from backend/settings.json
 */
export async function loadCapexDocument() {
  const mergedDoc = {}

  for (const filename of CAPEX_FILES) {
    try {
      const filepath = join(CAPEX_DIR, filename)
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
    const settingsPath = join(dirname(CAPEX_DIR), 'settings.json')
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
 * Alternative: Load a specific CAPEX file by name (for debugging/testing)
 */
export async function loadCapexFile(filename) {
  const filepath = join(CAPEX_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
