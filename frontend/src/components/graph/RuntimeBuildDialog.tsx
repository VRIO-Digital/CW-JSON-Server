import { Alert, Button, Modal, Space, Typography } from 'antd'
import type { AskGraph, GraphBuild } from '../../api/client'
import { analysingStage, runtimeBuildCopy } from '../../data/runtimeBuild'
import StageList from '../sources/StageList'
import { SP } from '../../theme'

/*
 * The wizard's hand-off for a graph that publishes itself.
 *
 * **Save & build lands in Ask, not in Graph Studio, when the brief draws on a runtime
 * source.** The studio is where a reviewer settles what the canvas asserts, and a runtime
 * source puts nothing on the canvas — so for this one kind of graph there is nothing to
 * settle, the build publishes the version it produced, and routing a reader through the
 * studio would send them to a screen whose only remaining act is one the server already did.
 * Every other graph is untouched and still goes to the studio's Build tab.
 *
 * **So the dialog offers one act, and it is Ask.** It used to offer the studio beside it,
 * which is the screen this hand-off exists to skip — a second button pointing back at the
 * detour reads as the two being equal choices. The studio is still reachable from the
 * sidebar, and `notPublished` still names it as the fix where a publish did not land.
 *
 * **And it reports rather than narrating.** The pipeline's stage-and-step readout is the Build
 * tab's, where a reader is watching a run they can act on; here the build publishes itself and
 * nothing on this dialog is pressable while it does, so a substep counter would be detail with
 * no decision attached. What stands in its place is `runtimeBuildCopy.analysing` drawn as
 * **`StageList`'s rows** — every one listed from the first frame, `pending` until it runs, so
 * the list says how much is left rather than growing a line at a time. That is
 * `BuildRunDialog`'s rule and it is the same rule here, and reusing the component rather than
 * drawing three rows inline is what stops a second set of marks and states drifting from the
 * first.
 *
 * **Three phrases over the run's own progress, and never a timer.** They were cut out of a
 * ten-second hold, which was wrong by about eighty seconds — the build is 31 substeps and the
 * publish happens when it lands, so the act was offered long before the graph existed and Ask
 * met the reader with its no-published-graph gate. `analysingStage` reads the run the page is
 * already polling, so this dialog keeps the rule the rest of the app keeps: a row advances
 * because the run advanced.
 *
 * **The list stays after the hold ends**, all three ticked. It is the body of the dialog —
 * clearing it on completion is how this dialog came to render a button over blank space once
 * already.
 *
 * **And it explains nothing while it holds.** The paragraph that opened it — why a runtime
 * source leaves a reviewer nothing to settle — was the reasoning behind a routing decision the
 * reader did not make and cannot change, put in front of them at the one moment they are
 * waiting on a result. It is on record in CLAUDE.md, which is where a decision belongs. So the
 * panel is the phrase and the act, and the dialog takes neither the graph's name nor its
 * sources, because nothing left on it says anything about either.
 *
 * It does **not** claim the publish. The panel says a graph is live only once `GET /ask` has
 * been re-read and really lists it, and stays silent where it did not: the warning it used to
 * draw there sent the reader to Graph Studio → Versions, which is the screen this hand-off
 * exists to skip, and it is the *expected* state for the first seconds after a build lands.
 * Saying nothing is the one thing that is true either way — a dialog asserting a publication
 * the next screen disproves is the failure this guards against, and it still cannot happen.
 *
 * The body is exported apart from the `Modal` for the reason `ConnectSourceWizard` is —
 * `renderToString` does not traverse a portal, so a panel left inside its dialog cannot be
 * asserted on.
 */

export function RuntimeBuildPanel({
  ready,
  stage,
  published,
  checking,
}: {
  /** The hold has elapsed — every row is ticked and the act is offered. */
  ready: boolean
  /** The row running now. Past `analysing.length` every row is done. */
  stage: number
  /** The row `GET /ask` came back with, or null when the list does not hold this graph. */
  published: AskGraph | null
  /** Ask is being re-read — the build has landed and the publication is not confirmed yet. */
  checking: boolean
}) {
  return (
    <div className="rb">
      <StageList stages={runtimeBuildCopy.analysing} stage={stage} />

      {!ready || checking ? null : published ? (
        <Alert
          type="success"
          showIcon
          title="Live in Ask"
          description={runtimeBuildCopy.published(published.version, published.publishedBy)}
        />
      ) : (
        <Typography.Paragraph type="secondary">{runtimeBuildCopy.done}</Typography.Paragraph>
      )}
    </div>
  )
}

export default function RuntimeBuildDialog({
  open,
  run,
  published,
  checking,
  onAsk,
  onClose,
}: {
  open: boolean
  /** The build this hand-off is watching. The rows and the act both read it. */
  run: GraphBuild | null
  published: AskGraph | null
  checking: boolean
  onAsk: () => void
  onClose: () => void
}) {
  /*
   * One cursor, and it is the run's rather than a timer's — `analysingStage` is the whole
   * of it, so there is nothing here to fall out of step with the build. `held` is derived
   * from that cursor for the reason `BUILD_STEPS` keeps one: a flag beside the index is two
   * counters over one wait, whose symptom is a row still spinning under a finished list.
   */
  const stage = analysingStage(run)
  const held = stage >= runtimeBuildCopy.analysing.length
  const done = held && !checking

  return (
    <Modal
      open={open}
      /* No title. What one would say is what the paragraph below it said — the reasoning
         behind a routing decision the reader did not make; and a heading over a single
         line of status is a label for something already reading as one. 
         rather than an omitted prop, so a default cannot arrive from the theme. */
      title={null}
      onCancel={onClose}
      /*
       * Closable throughout, which it was not while the wait was a ten-second timer.
       * The wait is the build now — minutes, not seconds — and a modal with no exit over a
       * run the reader cannot act on is a trap; a poll that stops answering would make it a
       * permanent one. Nothing is lost by leaving: the run is the server's, it finishes
       * either way, it still publishes itself, and Graph Studio finds it in flight.
       */
      maskClosable
      closable
      footer={
        <Space size={SP.sm}>
          <Button type="primary" onClick={onAsk} disabled={!done}>
            {runtimeBuildCopy.askAction}
          </Button>
        </Space>
      }
    >
      <RuntimeBuildPanel
        ready={held}
        stage={stage}
        published={published}
        checking={checking}
      />
    </Modal>
  )
}
