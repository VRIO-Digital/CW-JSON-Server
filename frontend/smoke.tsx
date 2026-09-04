import { renderToString } from 'react-dom/server'
import { ProvenanceBadge } from './src/components/catalog/ModelMarks'
import { suggestionRunNote } from './src/data/dataModelSuggestions'
import {
  confidenceLabel,
  evidenceKindLabel,
} from './src/data/dataModelRelationships'

const fail: string[] = []
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) fail.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---------- the badge, both forms, all three kinds ---------- */
const short = renderToString(<ProvenanceBadge kind="derived" />)
const long = renderToString(<ProvenanceBadge kind="derived" full />)
check('the short form reads Curated by AI', short.includes('Curated by AI'), short)
check('the long form reads Curated by AI', long.includes('Curated by AI'), long)
check('and neither says Derived any more', !short.includes('Derived') && !long.includes('Derived'))

const rec = renderToString(<ProvenanceBadge kind="recorded" full />)
check('the authored kind is untouched', rec.includes('Recorded in this dataset'), rec)
check('and is not relabelled AI', !rec.includes('AI'), rec)

const human = renderToString(<ProvenanceBadge kind="human" full />)
check('the human kind is untouched', human.includes('Confirmed by you'), human)

/* ---------- the run note ---------- */
const both = suggestionRunNote({ recorded: 5, derived: 3 })
check('the derived clause is worded from the badge', both.includes('3 curated by AI'), both)
check('the recorded clause still says recorded', both.includes('5 recorded'), both)
check('no figure is invented survives', both.includes('No figure is invented to fill a field'), both)
check('and the retired no-model sentence is gone', !both.includes('No model ran'), both)

const derivedOnly = suggestionRunNote({ recorded: 0, derived: 2 })
check('a kind with nothing in it contributes no clause', !derivedOnly.includes('recorded —'), derivedOnly)
check('the derived-only run still names its kind', derivedOnly.includes('2 curated by AI'), derivedOnly)

const none = suggestionRunNote({ recorded: 0, derived: 0 })
check('an empty run says so', none.startsWith('Nothing new to suggest.'), none)

/* ---------- the evidence and the confidence are still what they are ---------- */
check('the evidence is still structural', evidenceKindLabel('structural') === 'Structural analysis')
check('a recorded row still names itself', evidenceKindLabel('recorded') === 'Recorded in this dataset')
check(
  'a derived confidence is the classifier’s',
  confidenceLabel({ evidenceKind: 'structural' }) === 'Classifier confidence',
)
check(
  'a recorded confidence is a stated one',
  confidenceLabel({ evidenceKind: 'recorded' }) === 'Stated confidence',
)

if (fail.length > 0) {
  console.error('SMOKE FAILED')
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('smoke: all checks passed')
console.log(`  note (both kinds): ${both}`)
console.log(`  note (derived only): ${derivedOnly}`)
