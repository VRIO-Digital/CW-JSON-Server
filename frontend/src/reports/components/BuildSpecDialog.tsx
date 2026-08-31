import { useEffect, useRef } from 'react';

/*
 * The specification a report is built from, framed — shown where the narrated build steps
 * would otherwise run.
 *
 * **A dataset can ship the answer instead of having it narrated.** `BuildRunDialog` says what
 * composing a report does, one step at a time, because for the primary dataset that is all
 * there is to say: the act happens here, against the prototype's own fixture, and the steps
 * name the values it used. CAPEX ships something stronger — a whole specification document per
 * report, stating what the agent resolved, the measures it bound, the sources behind them and
 * the blocks the spec declares. Narrating five generic steps in front of a reader who could be
 * reading that is a summary standing in front of the real account.
 *
 * **So it is framed rather than transcribed**, exactly as that dataset's rendered reports, its
 * What-if lens and its Audit & Governance screen are. Each of these files is a standalone page
 * with its own `<head>`, its own theme and its own fonts; injecting the body would mean dropping
 * the head the document *is* and scoping every selector it carries — the problem that forced
 * `.cw-reports` on this folder's own stylesheet. Pulling its figures into rows here would be the
 * transcription this section refuses everywhere: right until the document is next exported.
 *
 * **The URL arrives as a prop, so this folder stays the standalone prototype it was.** Turning a
 * filename into a URL is the host's job — one `import.meta.glob` in `src/data/reportDocuments.ts`
 * is the single copy of every framed document's address — and absent the prop nothing here
 * changes: the build narrates its steps as it always did.
 *
 * **There is no timer.** The narrated build is paced because an act that returns instantly and
 * shows nothing teaches that it is free; this one is a document to *read*, and a dialog that
 * dismissed itself mid-page would take it away from a reader mid-sentence. So the draft opens
 * when the reader says so — which is also the honest thing, since nothing is in flight: the
 * blocks are instantiated on the way out, not behind this dialog.
 */
export function BuildSpecDialog({
  /** The report whose spec this is, from the same state the narrated dialog names. */
  reportTitle,
  /** Where the bundle put the document. Resolved by the host; absent means this dialog is not shown. */
  url,
  /** Compose the draft and open it — the act the reader is holding. */
  onOpen,
}: {
  reportTitle: string;
  url: string;
  onOpen: () => void;
}) {
  /*
   * Escape does what the button does, because they are the same act: this dialog is holding a
   * step rather than asking a question, so dismissing it can only mean "go on". A backdrop
   * click is deliberately *not* wired to it — the frame fills most of the dialog and a stray
   * click past its edge would advance the flow while somebody was reading.
   */
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modalBack">
      <div
        className="modal rp-spec"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp-spec-title"
      >
        <div className="rp-specHead">
          <div className="rp-specHeadText">
            <h3 id="rp-spec-title">How this report is built</h3>
            {/* One expression rather than `text {expr} text`: renderToString splits those into
                separate nodes and an assertion on the sentence would pass over nothing. */}
            <div className="mh">
              {`“${reportTitle}” — this dataset's own specification for it, as the document states it. The draft opens when you close this.`}
            </div>
          </div>
          <button type="button" className="btn pri rp-specGo" onClick={onOpen}>
            Open the report
          </button>
        </div>

        {/*
          * A real boundary, and what it costs is the same as everywhere else this app frames a
          * document: nothing in the page can restyle the document and nothing in the document
          * reaches back. Its own cross-links go nowhere inside the frame, which is why the bar
          * carrying them is hidden below rather than followed.
          */}
        <iframe className="rp-specFrame" src={url} title={`${reportTitle} — specification`} onLoad={inject} />
      </div>
    </div>
  );
}

/*
 * What the frame paints into the document, and it is a stylesheet and nothing else.
 *
 * The document's own top bar is a second ContextWeave wordmark under this app's, and the links on
 * it point at sibling files by name — one of which this bundle does not carry, so inside the frame
 * they are the most prominent controls on the page and can only fail. The same decision as hiding
 * a framed report's mock-API pill, and applied from here for the same reason: these are generated
 * exports, so an edit would be lost the next time one is produced and would silently come back.
 *
 * `!important` because these documents' rules are theirs and this one is a claim over them, which
 * is the rule the seamless frame's injection already keeps.
 */
const SPEC_CSS = ' body > .top { display: none !important }';

function inject(event: { currentTarget: HTMLIFrameElement }) {
  const inner = event.currentTarget.contentDocument;
  /* A cross-origin document simply has no `contentDocument` — not an error, a document this rule
     cannot reach. */
  if (!inner) return;
  const style = inner.createElement('style');
  style.textContent = SPEC_CSS;
  inner.head?.appendChild(style);
}
