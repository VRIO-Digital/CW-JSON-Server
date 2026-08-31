import { LoadingOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Space, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { AskGraph } from '../../api/client'
import { ANALYSING_MS, analysingStepMs, runtimeBuildCopy } from '../../data/runtimeBuild'
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
 * **And it holds rather than narrating.** The pipeline's stage-and-step readout is the Build
 * tab's, where a reader is watching a run they can act on; here the build publishes itself
 * and nothing on this dialog is pressable while it does, so a counter would be detail with no
 * decision attached. What stands in its place is `runtimeBuildCopy.analysing` — three phrases
 * over `ANALYSING_MS`, in order, the last one standing until the hold ends, because a line
 * held motionless for ten seconds reads as a page that stopped and a phrase coming back round
 * would say the work had restarted.
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
  phrase,
  published,
  checking,
}: {
  /** The hold has elapsed — before it, the panel says only what it is doing. */
  ready: boolean
  /** The phrase standing right now, from `runtimeBuildCopy.analysing`. */
  phrase: string
  /** The row `GET /ask` came back with, or null when the list does not hold this graph. */
  published: AskGraph | null
  /** Ask is being re-read — the build has landed and the publication is not confirmed yet. */
  checking: boolean
}) {
  return (
    <div className="rb">
      {!ready || checking ? (
        <Typography.Paragraph type="secondary">
          <Spin indicator={<LoadingOutlined spin />} size="small" /> {phrase}
        </Typography.Paragraph>
      ) : published ? (
        <Alert
          type="success"
          showIcon
          title="Live in Ask"
          description={runtimeBuildCopy.published(published.version, published.publishedBy)}
        />
      ) : null}
    </div>
  )
}

export default function RuntimeBuildDialog({
  open,
  published,
  checking,
  onAsk,
  onClose,
}: {
  open: boolean
  published: AskGraph | null
  checking: boolean
  onAsk: () => void
  onClose: () => void
}) {
  /*
   * The hold is the dialog's own, and it is cleared on close as well as on unmount: the
   * timer must not fire into a panel the reader has already dismissed, which is the rule
   * the What-if lens's two client-side steps keep for the same reason.
   */
  const [held, setHeld] = useState(false)
  const [phraseAt, setPhraseAt] = useState(0)
  useEffect(() => {
    if (!open) {
      setHeld(false)
      setPhraseAt(0)
      return
    }
    /* The phrases advance and stop at the last one; the hold is what ends the wait, so a
       phrase is never shown twice. */
    const tick = window.setInterval(
      () =>
        setPhraseAt((at) => Math.min(at + 1, runtimeBuildCopy.analysing.length - 1)),
      analysingStepMs(),
    )
    const end = window.setTimeout(() => setHeld(true), ANALYSING_MS)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(end)
    }
  }, [open])

  const done = held && !checking

  return (
    <Modal
      open={open}
      /* No title. What one would say is what the paragraph below it said — the reasoning
         behind a routing decision the reader did not make; and a heading over a single
         line of status is a label for something already reading as one. `title={null}`
         rather than an omitted prop, so a default cannot arrive from the theme. */
      title={null}
      onCancel={onClose}
      /* No Cancel while the hold is running: closing would leave the build to finish
         behind the dialog, which is the reason `BuildRunDialog` offers none either. The
         run itself is unaffected — Graph Studio finds it in flight. */
      maskClosable={done}
      closable={done}
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
        phrase={runtimeBuildCopy.analysing[phraseAt]}
        published={published}
        checking={checking}
      />
    </Modal>
  )
}
