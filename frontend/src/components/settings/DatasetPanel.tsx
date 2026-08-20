/**
 * Settings → Dataset. Which dataset the console reads, and the switch that changes it.
 *
 * **It lives in Settings rather than the sidebar because it is not navigation.** Picking a dataset
 * ends the session — the confirmation says so and the act carries it out — and a control that signs
 * you out does not belong beside the page links, one mis-click away. Settings is where the things
 * that reconfigure the console already are.
 *
 * **Its own component, for the reason `AudiencePicker` is.** A panel behind a parent's `useState`
 * cannot be asserted on: `renderToString` renders the parent's initial state, so every check about
 * this one's contents would pass over nothing.
 *
 * **The confirmation's words are `src/data/datasetSwitch.ts`.** A `Modal` portals out of
 * `renderToString`, so copy written inline here could not be tested — and holding it there also
 * makes it interpolated from the two dataset names, which is what stops the CAPEX dialog asking
 * about EPA.
 *
 * **Every option states what it holds.** A dataset created but not populated is the normal state of
 * a new one, and an option that looks identical to a full one is how a reader concludes the app is
 * broken rather than that the dataset is empty. The counts are the server's, so "empty" is its
 * answer and not this component's guess.
 */

import { Alert, Card, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { SP } from '../../theme'

import {
  datasetSwitchBody,
  datasetSwitchOk,
  datasetSwitchTitle,
} from '../../data/datasetSwitch'
import {
  selectDatasetRows,
  selectIsBoth,
  useDatasetStore,
} from '../../store/datasetStore'
import './DatasetPanel.css'

export default function DatasetPanel() {
  const active = useDatasetStore((s) => s.active)
  const rows = useDatasetStore(selectDatasetRows)
  const both = useDatasetStore((s) => s.data?.both ?? null)
  const error = useDatasetStore((s) => s.error)
  const loading = useDatasetStore((s) => s.loading)
  const load = useDatasetStore((s) => s.load)
  const switchDataset = useDatasetStore((s) => s.switchDataset)
  const isBoth = useDatasetStore(selectIsBoth)

  /*
   * What the reader has picked but not yet confirmed. Separate from `active`, because the select has
   * to move under the pointer while the console keeps reading the dataset it is reading — nothing
   * changes until the dialog is confirmed, and a control that had already switched would be
   * describing a state the app is not in.
   */
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  /*
   * The options are the served rows plus the merged view, in that order. Nothing is written here: a
   * hardcoded pair would offer a dataset on a deployment whose bucket has no such prefix, and the
   * refusal would arrive as a 400 on every page rather than as an absent option.
   */
  const options = [
    ...rows.map((row) => ({
      value: row.dataset,
      label: row.label,
      detail: row.populated
        ? `${row.projects} source${row.projects === 1 ? '' : 's'} · ${row.reports} report${
            row.reports === 1 ? '' : 's'
          }`
        : 'no data yet',
      populated: row.populated,
    })),
    ...(both
      ? [
          {
            value: both.dataset,
            label: both.label,
            detail: 'every dataset, read-only',
            populated: true,
          },
        ]
      : []),
  ]

  const switching = pending ? { from: active, to: pending } : null

  return (
    <div className="dspanel">
      <Card
        className="dspanel-card"
        title="Which dataset the console reads"
        variant="outlined"
      >
        <Typography.Paragraph className="dspanel-lead">
          Each dataset is its own folder in the bucket, with its own sources, graphs, reports and
          recorded answers. Changing this changes what every page shows — and signs you out, because
          anything registered, built or published in a session belongs to the dataset it was made
          under.
        </Typography.Paragraph>

        <Space className="dspanel-control" align="start" size={SP.md} wrap>
          <span className="dspanel-field">
            <Typography.Text className="dspanel-label">DATASET</Typography.Text>
            <Select
              className="dspanel-select"
              value={active}
              loading={loading}
              /* Opens the confirmation; it never switches. See `pending` above. */
              onChange={(next) => setPending(next)}
              popupMatchSelectWidth={false}
              aria-label="Which dataset the console reads"
              options={options.map((o) => ({
                value: o.value,
                label: (
                  <span className="dspanel-opt">
                    <span className="dspanel-opt-name">{o.label}</span>
                    <span
                      className={`dspanel-opt-detail${o.populated ? '' : ' is-empty'}`}
                    >
                      {o.detail}
                    </span>
                  </span>
                ),
              }))}
            />
          </span>

          {/*
            * Stated where the switch is, not on the pages that would refuse a write. The server is
            * the gate — every non-GET is refused under the merged view — and this is the sentence
            * that stops that refusal arriving as a toast from a page the reader thought was normal.
            */}
          {isBoth ? (
            <Alert
              className="dspanel-note"
              type="info"
              showIcon
              title="Reading both datasets"
              description="Merged for reading. Connecting a source, profiling, building and publishing all need a single dataset selected."
            />
          ) : null}
        </Space>

        {/*
          * A failed pool fetch does not blank the control: the active dataset is still whatever it
          * was and every request still carries it. What is lost is the *other* options, so the
          * message says that rather than implying the selection failed.
          */}
        {error ? (
          <Alert
            className="dspanel-error"
            type="warning"
            showIcon
            title="Could not list the datasets"
            description={`Still reading ${active}. ${error}`}
          />
        ) : null}
      </Card>

      {/*
        * What each dataset holds, from the served counts. This is the answer to "did my switch work"
        * and to "why is CAPEX empty" — both questions a bare select cannot answer.
        */}
      <Card className="dspanel-card" title="What each dataset holds" variant="outlined">
        <Table
          className="dspanel-table"
          size="small"
          pagination={false}
          rowKey="dataset"
          dataSource={rows}
          columns={[
            {
              title: 'Dataset',
              dataIndex: 'dataset',
              render: (name: string, row) => (
                <Space size={SP.xs}>
                  <Typography.Text strong>{name}</Typography.Text>
                  {row.primary ? <Tag variant="outlined">PRIMARY</Tag> : null}
                  {name === active ? <Tag color="processing">READING</Tag> : null}
                  {/*
                    * On the row, not only in the dropdown. The select renders its options through a
                    * portal, so "no data yet" was visible only after opening the control — leaving a
                    * reader to infer an empty dataset from a row of zeros, which reads as a load that
                    * failed. Neutral rather than a status tint: an unpopulated dataset is news, not a
                    * fault.
                    */}
                  {row.populated ? null : (
                    <Typography.Text className="dspanel-empty">no data yet</Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: 'Sources', dataIndex: 'projects' },
            { title: 'Drives', dataIndex: 'drives' },
            { title: 'Graphs', dataIndex: 'graphs' },
            { title: 'Reports', dataIndex: 'reports' },
            {
              title: 'Where it lives',
              dataIndex: 'ref',
              render: (ref: string) => <code className="dspanel-ref">{ref}</code>,
            },
          ]}
        />
      </Card>

      {/*
        * The confirmation. Its words come from `src/data/datasetSwitch.ts`, interpolated from both
        * dataset names — so the dialog cannot name the wrong move, and the sentences can be asserted
        * without rendering a portal.
        */}
      <Modal
        open={switching !== null}
        title={switching ? datasetSwitchTitle(switching) : ''}
        okText={switching ? datasetSwitchOk(switching) : ''}
        cancelText="Stay here"
        onCancel={() => setPending(null)}
        onOk={() => {
          if (pending) switchDataset(pending)
        }}
        destroyOnHidden
      >
        {switching
          ? datasetSwitchBody(switching).map((line) => (
              <Typography.Paragraph key={line}>{line}</Typography.Paragraph>
            ))
          : null}
      </Modal>
    </div>
  )
}
