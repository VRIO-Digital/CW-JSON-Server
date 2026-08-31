import { analysingStage, runtimeBuildCopy } from './src/data/runtimeBuild'
const rows = runtimeBuildCopy.analysing.length
const r = (stepIndex: number, status: 'running' | 'complete' = 'running') =>
  analysingStage({ status, stepIndex, stepTotal: 31 })
const checks: [string, boolean][] = [
  ['null run -> row 0', analysingStage(null) === 0],
  ['step 0 -> row 0', r(0) === 0],
  ['step 10 -> row 0', r(10) === 0],
  ['step 11 -> row 1', r(11) === 1],
  ['step 21 -> row 2', r(21) === 2],
  ['step 30 running -> still row 2, NOT done', r(30) === rows - 1],
  ['step 31 running -> capped at last row, NOT done', r(31) === rows - 1],
  ['complete -> all rows ticked', r(31, 'complete') === rows],
  ['stepTotal 0 -> row 0', analysingStage({ status: 'running', stepIndex: 5, stepTotal: 0 }) === 0],
  ['never held while running', [0, 5, 15, 30, 31, 99].every((i) => r(i) < rows)],
]
let bad = 0
for (const [name, ok] of checks) { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name) }
console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`)
