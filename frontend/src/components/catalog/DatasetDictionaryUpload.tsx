import { InboxOutlined } from '@ant-design/icons'
import { Button, Space, Tag } from 'antd'
import { useRef } from 'react'
import type { SourceRow } from '../../api/client'
import {
  SCHEMA_ACCEPT,
  schemaFileProblem,
  schemaUploadCopy,
} from '../../data/schemaUpload'
import { useSchemaUploadStore } from '../../store/catalogStore'
import { SP } from '../../theme'

/**
 * Uploading a data dictionary **against one dataset**, from that dataset's own row in the browse
 * tree.
 *
 * **What "combine with the connected source" means here, exactly.** The file's columns become
 * `column_profiles` entries keyed `dataset.table` — the same place a profiling run reads from, and
 * the same place the demo's own 206 columns came from when they were ingested out of a workbook. So
 * the Catalog stops serving synthesised columns for those tables and serves what the file said, the
 * Data Modeling tab draws them, and the graph derives over them. It is the ingest script's act, done
 * through a screen.
 *
 * **It was a source-level panel with a dataset Select in it, and the dataset is what moved.** One
 * upload for a source that may hold three datasets meant the panel had to *ask* which one, from a
 * control the reader met a moment after they had been looking at the list of them — and a Select
 * with one option is the fault this repo refuses everywhere. The act now sits on the row it
 * describes, so there is nothing to pick and nothing to get wrong. That also settles "BigQuery only"
 * by construction rather than by declaration: only the structured browse panel lists datasets, and
 * a drive or a mailbox never reaches it.
 *
 * **Two acts still, and the first one still writes nothing** — what changed is who asks for it.
 * Choosing a file reads it immediately, because a reader who has just picked a dictionary has
 * already asked for it to be read and a second click to make anything appear is a step that says
 * nothing. The write is **Start Profiling**, one control for both halves of what a reader means by
 * it: the dictionary lands and the tables it touched are profiled.
 *
 * **The file is read in the browser.** `File.text()` and a JSON body, so the zero-dependency server
 * needs no multipart parser for what is a text file either way; `schemaFileProblem` checks the
 * extension and the size against the server's own body cap first, so an oversized file is a sentence
 * rather than a request that dies mid-stream.
 */
export function DictionaryUploadControl({
  source,
  datasetId,
  onUploaded,
}: {
  source: SourceRow
  datasetId: string
  /**
   * The file landed. Called on a read that succeeded, never on one that was refused — a refusal
   * has its own sentence in the panel's error alert, and a success toast over it would say two
   * opposite things at once.
   *
   * A callback rather than `App.useApp()` here: this control is drawn once per dataset row inside
   * a tree title, and the toast belongs to the panel that owns the tree — the same place every
   * other message about a run in this panel is raised from.
   */
  onUploaded: (filename: string) => void
}) {
  const staged = useSchemaUploadStore((s) => s.staged[datasetId])
  const reading = useSchemaUploadStore((s) => s.reading)
  const read = useSchemaUploadStore((s) => s.read)
  const refuse = useSchemaUploadStore((s) => s.refuse)
  const discard = useSchemaUploadStore((s) => s.discard)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function choose(chosen: File | undefined) {
    if (!chosen) return
    const problem = schemaFileProblem(chosen)
    if (problem) {
      refuse(datasetId, problem)
      return
    }
    /*
     * **The file is not read, and that is the point.** The upload is a showcase: the server answers
     * with the *dataset's* own tables and columns out of the document, so nothing about the chosen
     * file is parsed and nothing it contains can reach `column_profiles`. Only its name travels —
     * `chosen.text()` used to be posted with it and is gone, which also lifts the 1 MB body cap off
     * an act that no longer sends any bytes.
     */
    const result = await read(source.sourceId, {
      filename: chosen.name,
      dataset_id: datasetId,
    })
    /* And say so. Only on success: a refusal is already stated in the panel's own error alert,
       and a success toast over it would leave the reader two opposite answers to one act. */
    if (result.ok) onUploaded(chosen.name)
  }

  return (
    /*
     * **The click is stopped here, and it has to be.** This sits inside a `checkable` `blockNode`
     * tree title, where a click anywhere on the row toggles the checkbox — so without this, opening
     * the file dialog would also uncheck every table in the dataset, and the reader would find their
     * selection changed by a button that said nothing about selection.
     *
     * **`stopPropagation` only, never `preventDefault` — and that one line broke the whole
     * feature.** The hidden `<input type="file">` is a child of this span, so the click
     * `inputRef.current.click()` dispatches bubbles up through here; cancelling it cancels that
     * input's default action, which *is* opening the file picker. The button depressed, nothing
     * opened, and the failure looked like a browser blocking a programmatic file dialog rather
     * than like a handler two elements up. Reported from use.
     */
    <span className="cat-dict" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="file"
        accept={SCHEMA_ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <Space size={SP.xs} wrap>
        {/*
          **The upload button is the empty state's control, and a staged dataset no longer draws
          it.** It used to stay and relabel itself *Replace file*; that was **removed on request**,
          so a row with a file read against it offers its name and *Discard* and nothing
          else.

          What it costs is one click: swapping a file is now Discard then Upload rather than
          Replace. That is the honest shape of the act anyway — a replace silently threw away a
          plan the reader may not have read yet, and `staged` is one slot per dataset, so the
          discard was happening either way and only the saying of it was missing.

          The hidden `<input>` stays mounted regardless: it is what this button opens, and
          remounting it per state would lose the ref between renders.
        */}
        {staged ? null : (
          <Button
            size="small"
            icon={<InboxOutlined />}
            loading={reading === datasetId}
            onClick={() => inputRef.current?.click()}
          >
            {reading === datasetId
              ? schemaUploadCopy.readingLabel
              : schemaUploadCopy.uploadLabel}
          </Button>
        )}
        {staged ? (
          <>
            {/* Neutral: a staged file is not a state of the data. */}
            <Tag>{staged.filename}</Tag>
            {/* *View report* stood here and went with the dialog it opened. A control whose one
                act is to show a surface that no longer exists is the half-removal this repo
                refuses everywhere — so the label went from the copy module too. */}
            <Button size="small" type="text" onClick={() => discard(datasetId)}>
              {schemaUploadCopy.discardLabel}
            </Button>
          </>
        ) : null}
      </Space>
    </span>
  )
}

/*
 * **`DictionaryPlanReport` and `DictionaryPlanModal` stood here, and both are gone — removed on
 * request.**
 *
 * The read opened a dialog: an *Accepted …* sentence, a row per table with its catalogued column
 * count against the dictionary's, a warning for curator notes about to be stranded, and a footnote
 * for a table the file declares. A reader is told the file arrived by a toast instead, and there is
 * nothing to dismiss.
 *
 * **What that costs, stated rather than glossed.** Nothing on screen says which tables the run will
 * cover, and nothing warns that an upload takes a curator's note with it — which was the last of
 * the three "what this would take away" warnings still being drawn, the other two having been
 * removed earlier for the same reason.
 *
 * **The removal stopped at the components, deliberately.** `datasetDictionaryPlan` still computes
 * every one of those figures, the plan still carries them and `client.ts` still validates them, so
 * this is a narrower reading of one payload rather than a payload that lost its answers — the same
 * waiting-for-a-caller state `/change-signals` is in. Re-adding the surface is this one file.
 * **Do not restore it without being asked**, and do not delete the layers beneath to "finish" the
 * removal.
 */
