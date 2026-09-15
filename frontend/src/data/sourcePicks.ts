/**
 * Step 4's own rules about a source pick — the decidable parts, out where they can be asserted.
 *
 * A predicate written inside `SourcesStep` can only be checked by rendering the component, and
 * `renderToString` gives it its *initial* state: the reader has pressed nothing, so exactly the
 * branch a click reaches is the branch a render test passes over. That is the reason
 * `datasetPathFix` and `askAvailability` are functions, and it is not theoretical here — the bug
 * below shipped, was reported from use, and lived in one `===`.
 */

/**
 * Is a source's object chooser on screen?
 *
 * **Not `mode === 'subset'`, which is what it was.** `setObjects` stores an all-ticked selection
 * as `mode: 'all'` — deliberately, because `all` means "this source, whatever it holds" and picks
 * up an object profiled after the draft was saved, where a subset freezes today's list. So
 * pressing *Select all* flipped the stored mode and **unmounted the list at the moment every box
 * in it had just been ticked**: the pick was right, and the only thing wrong was that the reader
 * could not see it. Reported as Select all not selecting anything.
 *
 * The mode buttons open and close this; the ticks inside decide what is stored. Two jobs, two
 * values.
 *
 * @param reader  What the reader last asked for, or `undefined` if they have not said.
 * @param mode    The stored pick's mode, or `undefined` where the source is not picked at all.
 */
export function chooserIsOpen(
  reader: boolean | undefined,
  mode: 'all' | 'subset' | undefined,
): boolean {
  /* Unpicked sources draw no chooser, whatever was open before the source was dropped. */
  if (mode === undefined) return false
  /*
   * The reader's answer wins where there is one, and the pick answers where there is not — so a
   * draft loaded on a subset opens showing it and one loaded on `all` does not, with nothing to
   * seed when the step mounts.
   */
  return reader ?? mode === 'subset'
}
