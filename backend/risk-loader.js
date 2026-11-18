/**
 * Load and merge all RISK split JSON files into a single document.
 *
 * RISK is the dataset code for Contract Risk Analyst — named RISK rather than CONTRACTRISK because
 * the URL segment is a dataset's first letter and CAPEX already owns C.
 *
 * Same shape as `arcwood-loader.js` / `capex-loader.js` — written by
 * `npm run ingest:risk` (which seeds an empty-but-servable document off CAPEX's structure,
 * since this dataset has no package shaped for `DB_SHAPE` — see that script's own header).
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RISK_DIR = join(__dirname, 'risk')

/**
 * The list of split RISK files in load order.
 * Files loaded first will be overwritten by later files if they have duplicate keys.
 * NOTE: settings.json is NOT included here — settings are shared across all datasets
 */
const RISK_FILES = [
  'risk_sources.json',
  'risk_catalogue.json',
  'risk_new_graph.json',
  'risk_graph_studio.json',
  'risk_reports.json',
  'risk_ask.json',
  'risk_whatif.json',
  'risk_audit_governance.json',
  'risk_new_role.json',
  'risk_goals.json',
  'risk_submissions.json',
]

/**
 * Load all RISK split files and merge them into a single document.
 * Also loads shared settings from backend/settings.json
 */
export async function loadRiskDocument() {
  const mergedDoc = {}

  for (const filename of RISK_FILES) {
    try {
      const filepath = join(RISK_DIR, filename)
      const content = await readFile(filepath, 'utf8')
      const data = JSON.parse(content)
      Object.assign(mergedDoc, data)
      console.log(`✓ Loaded ${filename}`)
    } catch (error) {
      throw new Error(`Failed to load ${filename}: ${error.message}`)
    }
  }

  try {
    const settingsPath = join(dirname(RISK_DIR), 'settings.json')
    const content = await readFile(settingsPath, 'utf8')
    const settingsData = JSON.parse(content)
    Object.assign(mergedDoc, settingsData)
    console.log(`✓ Loaded settings.json (shared)`)
  } catch (error) {
    console.log(`ℹ Settings.json not found or empty (will use defaults)`)
  }

  return mergedDoc
}

/** Alternative: load a specific RISK file by name (for debugging/testing) */
export async function loadRiskFile(filename) {
  const filepath = join(RISK_DIR, filename)
  const content = await readFile(filepath, 'utf8')
  return JSON.parse(content)
}
