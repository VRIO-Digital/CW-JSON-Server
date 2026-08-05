import type { CoveragePayload, GapChoice } from '../api/client'

/**
 * Whether every gap has a decision — the build gate for step 7.
 *
 * Lives outside the component so the page can gate its button on it without
 * importing a non-component from a component file.
 */
export function coverageIsDecided(
  data: CoveragePayload | null,
  decisions: GapChoice[],
) {
  if (!data) return false
  return data.elements
    .filter((e) => e.status === 'gap')
    .every((e) => decisions.some((d) => d.elementId === e.elementId))
}
