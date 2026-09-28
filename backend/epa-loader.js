/**
 * Load and merge all EPA split JSON files into a single document
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EPA_DIR = join(__dirname, 'epa')

/**
 * The list of split EPA files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const EPA_FILES = [
  'epa_sources.json',
  'epa_catalogue.json',
  'epa_new_graph.json',
  'epa_graph_studio.json',
  'epa_reports.json',
  'epa_ask.json',
  'epa_whatif.json',
  'epa_audit_governance.json',
]

/**
 * Load all EPA split files and merge them into a single document.
 * This replaces reading a single db.json file.
 * Also loads shared settings from backend/settings.json
 */
export async function loadEpaDocument() {
  const mergedDoc = {}

  for (const filename of EPA_FILES) {
    try {
      const filepath = join(EPA_DIR, filename)
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
    const settingsPath = join(dirname(EPA_DIR), 'settings.json')
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
 * Alternative: Load a specific EPA file by name (for debugging/testing)
 */
export async function loadEpaFile(filename) {
  const filepath = join(EPA_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
