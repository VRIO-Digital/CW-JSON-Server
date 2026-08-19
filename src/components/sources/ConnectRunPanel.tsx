import { LoadingOutlined } from '@ant-design/icons'
import { Spin } from 'antd'
import {
  CONNECT_ACT_COPY,
  type ConnectAct,
  type ConnectStepKind,
} from '../../data/connectSteps'
import './ConnectRunPanel.css'

/**
 * What one of step 3's acts says while it runs — the body of its dialog.
 *
 * **One act, one dialog, one line.** Preview and Finish get their own, because a
 * panel that listed both rows had "registering the source" on screen while nothing
 * was being registered. Each states its own call, in the connector's unit, and names
 * the project or drive that call is made against.
 *
 * Both calls are held for `CONNECT_STEP_MS` (5s) on the server, which is why this
 * exists at all: a button spinner said only "something is happening", and five
 * unexplained seconds reads as a wedged dialog.
 *
 * It is **its own component, not a body inlined in the modal**, because
 * `renderToString` does not traverse antd's portal: written inline, every
 * assertion about this copy would pass over nothing. Same reason
 * `ConnectSourceWizard` is separate from `ConnectSourceModal`.
 */
export default function ConnectRunPanel({
  kind,
  act,
  /** The project or drive the call is made against — the message names it. */
  subject,
}: {
  kind: ConnectStepKind
  act: ConnectAct
  subject: string
}) {
  return (
    <div className="cs-run" role="status" aria-live="polite">
      <Spin indicator={<LoadingOutlined spin />} />
      {/* One expression, not `text {expr} text`: renderToString would split those into
          separate nodes and an assertion on the sentence would pass over nothing. */}
      <span className="cs-run-message">
        {CONNECT_ACT_COPY[kind][act].replace('{subject}', subject)}
      </span>
    </div>
  )
}
