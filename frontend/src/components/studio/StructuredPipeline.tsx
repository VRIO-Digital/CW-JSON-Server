import { Typography } from 'antd'
import type { SgbBuild } from '../../api/client'
import './StructuredPipeline.css'

/**
 * The structured lane's build trace: **trigger accepted → the generation passes → persist & coverage.**
 *
 * **It reads as a trace, not as prose, and that is the point.** The document lane's stages are things
 * done to a corpus — *Reading documents*, *Pruning* — so they read as sentences. This lane's are
 * phases of a build, so they carry their own keys in monospace with the status right-aligned, the way
 * a build log does. Two lanes, two registers; neither borrowed from the other, and a reader can tell
 * at a glance which one they are looking at.
 *
 * **Every state derives from the run's own cursor**, never a timer — a row turning green because time
 * passed would be an operation narrating work nobody did. The list itself is the server's, so adding
 * a phase adds a row here rather than going stale against a copy held in this file.
 */

const { Text } = Typography

/** The dot's colour per state. Status is never colour alone — the word sits beside it on every row. */
const DOT: Record<string, string> = {
  complete: '#0d9f6e',
  running: '#0284c7',
  pending: '#b47d0a',
}

export default function StructuredPipeline({ build }: { build: SgbBuild }) {
  return (
    <div className="sp-trace">
      {/* The connector the dots sit on. Decorative, so it is hidden from the reading order. */}
      <span className="sp-line" aria-hidden="true" />
      {build.stages.map((stage) => {
        const dimmed = stage.state === 'pending'
        return (
          <div key={stage.stage} className={`sp-row${dimmed ? ' sp-dimmed' : ''}`}>
            <span
              className="sp-dot"
              aria-hidden="true"
              style={{ background: DOT[stage.state] ?? DOT.pending }}
            />
            <Text strong className="sp-name">
              {stage.label}
            </Text>
            <Text type="secondary" className="sp-status">
              {/* The phase's own detail where it has one — `202 accepted` on the trigger, the substep
                  in flight while it runs — and the bare state otherwise, which is what a queued or
                  finished row has to say. */}
              {stage.detail ?? stage.state}
            </Text>
          </div>
        )
      })}
    </div>
  )
}
