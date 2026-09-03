import {
  escapeHtml,
  sessionHistoryCopy,
  sessionTabHtml,
  type SessionHistoryRow,
} from '../../data/sessionHistory'

/**
 * Puts the Session history tab **inside** a framed governance screen's own tab strip.
 *
 * ## Why this exists rather than a tab of the app's
 *
 * It was built as an app-level strip wrapping the document first, and that was rejected: the tab
 * was asked for *beside the audit log*, and one level out is not beside. For a dataset that ships
 * its governance screen — CAPEX does — those tabs live in a generated export whose own header reads
 * *"never hand-edit this file — change the generator and rebuild"*. Editing it loses the tab at the
 * next rebuild; regenerating it needs a generator that is in the demo package rather than here. So
 * the tab is **injected at load**, which is the same access this app already takes on these
 * documents: `DocumentViewer` injects four stylesheets into every frame and reads `#v-reports` out
 * of one to know when a report has opened.
 *
 * **This is a step further than those, and worth naming as such.** The stylesheets add no node and
 * touch no script; this adds two nodes and wraps one function. What it does not do is remove
 * anything, rewrite anything, or change what the document says: open the file directly and it is
 * exactly the screen its generator produced.
 *
 * ## What it couples to, and how that fails
 *
 * Four things in the document: a `.tabs` strip, a `.pane` per tab, the last pane's position, and a
 * global `setTab(i)`. Every one is asserted by `check-docs` against the shipped file, so a
 * re-export that renames them fails the build rather than silently dropping the tab — which is the
 * failure that matters, because there is no app-level tab left to fall back to.
 *
 * **The document's own tab count is never assumed.** `setTab` loops `k < 3` because the export has
 * three; this reads the strip instead, so a fourth tab in a later export is a tab this clears
 * rather than one it leaves lit beside its own.
 */

export const SESSION_TAB_ID = 'cwSessionTab'
export const SESSION_PANE_ID = 'cwSessionPane'

/** The document's own tabs and panes — everything in the strip that is not ours. */
function theirs(doc: Document) {
  const tabs = Array.from(doc.querySelectorAll<HTMLElement>('.tabs .tab')).filter(
    (el) => el.id !== SESSION_TAB_ID,
  )
  const panes = Array.from(doc.querySelectorAll<HTMLElement>('.pane')).filter(
    (el) => el.id !== SESSION_PANE_ID,
  )
  return { tabs, panes }
}

/**
 * Injects the tab, or does nothing where the document has no strip to put it in.
 *
 * Returns nothing: this is called from the frame's `onLoad` and the frame's own teardown removes
 * the whole document, so there is no cleanup that outlives it.
 */
export function injectSessionTab(doc: Document, rows: SessionHistoryRow[]): void {
  const strip = doc.querySelector('.tabs')
  const panes = Array.from(doc.querySelectorAll<HTMLElement>('.pane'))
  const lastPane = panes[panes.length - 1]
  /* A document with no tab strip is not a failure — it is a document this does not apply to, the
     same way an absent `contentDocument` is for the stylesheets. The claim that the *governance*
     document has one lives in check-docs, where it can fail the build. */
  if (!strip || !lastPane) return

  /* Idempotent: `onLoad` fires once per load, but a re-render with new rows must replace the pane
     rather than append a second one beside it. */
  doc.getElementById(SESSION_TAB_ID)?.remove()
  doc.getElementById(SESSION_PANE_ID)?.remove()

  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'tab'
  button.id = SESSION_TAB_ID
  button.innerHTML = `${escapeHtml(sessionHistoryCopy.tabLabel)} <span class="ct">${rows.length}</span>`

  const pane = doc.createElement('div')
  pane.className = 'pane'
  pane.id = SESSION_PANE_ID
  pane.innerHTML = sessionTabHtml(rows)

  strip.appendChild(button)
  lastPane.parentNode?.insertBefore(pane, lastPane.nextSibling)

  button.addEventListener('click', () => {
    const { tabs, panes: theirPanes } = theirs(doc)
    tabs.forEach((el) => el.classList.remove('on'))
    theirPanes.forEach((el) => el.classList.remove('on'))
    button.classList.add('on')
    pane.classList.add('on')
    /* Deliberately not stopping propagation. The document has a global click handler that closes an
       open menu and repaints — repainting its own panes is harmless here, and swallowing the event
       would leave a menu open behind our tab. */
  })

  /*
   * Their tabs have to clear ours, and `setTab` is the only way in: the buttons carry inline
   * `onclick="setTab(n)"`, which resolves from the frame's global scope at click time, so replacing
   * the global is enough and no listener has to be attached to each of their buttons.
   *
   * **The wrapper looks our nodes up by id rather than closing over them**, so a re-injection with
   * fresh rows does not leave an older wrapper clearing a button that has been replaced.
   */
  const win = doc.defaultView as (Window & { setTab?: SetTab }) | null
  const original = win?.setTab
  if (win && typeof original === 'function' && !original.cwWrapped) {
    const wrapped: SetTab = function (this: unknown, ...args: unknown[]) {
      doc.getElementById(SESSION_TAB_ID)?.classList.remove('on')
      doc.getElementById(SESSION_PANE_ID)?.classList.remove('on')
      return original.apply(this, args)
    }
    wrapped.cwWrapped = true
    win.setTab = wrapped
  }
}

/** The document's own tab switcher, plus the flag that keeps it from being wrapped twice. */
type SetTab = {
  (...args: unknown[]): unknown
  cwWrapped?: boolean
}
