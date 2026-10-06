/*
 * The What-if fetcher against a LIVE server, through the real validator — the
 * `contract.ts` pattern pointed at one page. Run: start `npm run mock`, then
 *   VITE_API_BASE=http://localhost:4000 CONTRACT_DATASET=VLS npx vite build --ssr whatif-contract.ts \
 *     --outDir dist-ssr --logLevel warn && node dist-ssr/whatif-contract.js
 */
import { getWhatIfFrame } from './src/api/client'
import { setCurrentDataset } from './src/api/dataset'

const DATASET = process.env.CONTRACT_DATASET ?? 'VLS'
setCurrentDataset(DATASET)
console.log(`dataset: ${DATASET}`)

try {
  const frame = await getWhatIfFrame()
  console.log('OK — frame validated')
  console.log('document:', JSON.stringify(frame.document))
  console.log('connected:', frame.connectedSources, 'published:', frame.publishedCount)
} catch (err) {
  console.error('REFUSED:', err instanceof Error ? err.message : err)
  process.exit(1)
}
