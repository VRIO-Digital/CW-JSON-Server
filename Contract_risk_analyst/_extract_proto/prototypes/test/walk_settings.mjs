// Walk settings for the Contract Risk Analyst build (walk_journeys.mjs); the recording settings come from recording.mjs.
import R from './recording.mjs'
export default { ...R,
  walk: {
    q1Answer: /count the evergreen contracts|Count them/i, ticked: 3, rowA: 'sub-rn-plan', rowB: 'sub-rn-pack', onceTitle: 'Renewal risk review', built: 4, findings: 4,
    closing: /\$\d+\.\dM a year/, tab2: /Renewal plan/, steerAnswer: ['four', 'standin'],
    watchRun: 'Morning check, 20 November', watchBuilt: 3, actsDone: 11, actsWait: 0, watchSub: /Why it moved/i,
    firedToast: 'moved up a rating', handledToast: 'handled',
    newActs: 7, askAct: 'chase',
    shortBuilt: 3, scheduleTell: 'Just me',
    banned: /Belmara|BPUC|Tolu|Marc Beaulieu|off-framework|rate base|PeopleSoft|psoft\.|Harbor Pipe|CWIP|order load|Capital Program|Halden|Port Terrell|Ironbridge|Bramwell|Keolis|Valmont|€|—|–/,
    allowDash: [],
  } }
