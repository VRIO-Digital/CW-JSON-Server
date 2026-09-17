import { App, Alert, Select, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { TypeLinkDecision } from '../api/client'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import NoSourceConnected from '../components/common/NoSourceConnected'
import PageHeader from '../components/common/PageHeader'
import StudioBridgeTab from '../components/studio/StudioBridgeTab'
import StudioBuildTab from '../components/studio/StudioBuildTab'
import StudioCanvasTab from '../components/studio/StudioCanvasTab'
import StudioVersionsTab from '../components/studio/StudioVersionsTab'
import { useAuthStore } from '../store/authStore'
import {
  selectBuildRunning,
  selectOutputReadable,
  selectUseCase,
  useStudioStore,
} from '../store/studioStore'
import { appPath } from '../api/dataset'
import { SP } from '../theme'

/**
 * Graph Studio — **one studio for a use case, whichever lanes it has.**
 *
 * This replaces a split between a structured studio and a document studio, which forced a reader to
 * know which screen a use case belonged to and could not show that two graphs answer one business
 * question. What the studio offers follows from what the use case has *attached* — never from a
 * declared kind, which would be single-valued (so "both lanes" is unexpressible) and frozen at
 * commit (so a use case could not grow into a second one).
 *
 * **One selector governs the whole page.** Every tab reads the use case held in the store, so no tab
 * carries a picker that could disagree with the one above it.
 *
 * **The two graphs remain two graphs** — separate builds, separate canvases, and neither resolving
 * entities against the other. What is unified is the use case and its *approval*: a version names
 * the artifacts published together, in one act.
 */
export default function GraphStudioPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  /* Named, because `location` is also a global and reading that one would silently return undefined
     rather than the router's state. */
  const routerLocation = useLocation()
  const { useCaseId: routeUseCaseId } = useParams<{ useCaseId?: string }>()

  const useCases = useStudioStore((s) => s.useCases)
  const connectedSources = useStudioStore((s) => s.connectedSources)
  const useCaseId = useStudioStore((s) => s.useCaseId)
  const loading = useStudioStore((s) => s.loading)
  const error = useStudioStore((s) => s.error)
  const sgbBuild = useStudioStore((s) => s.sgbBuild)
  const dgbJob = useStudioStore((s) => s.dgbJob)
  const sgbGraph = useStudioStore((s) => s.sgbGraph)
  const story = useStudioStore((s) => s.story)
  const storyDraft = useStudioStore((s) => s.storyDraft)
  const drafting = useStudioStore((s) => s.drafting)
  const entities = useStudioStore((s) => s.entities)
  const relations = useStudioStore((s) => s.relations)
  const bridges = useStudioStore((s) => s.bridges)
  const bridgeId = useStudioStore((s) => s.bridgeId)
  const typeLinks = useStudioStore((s) => s.typeLinks)
  const unreviewedCount = useStudioStore((s) => s.unreviewedCount)
  const versions = useStudioStore((s) => s.versions)
  const building = useStudioStore((s) => s.building)
  const busy = useStudioStore((s) => s.busy)
  const sweeping = useStudioStore((s) => s.sweeping)
  const savingLinkId = useStudioStore((s) => s.savingLinkId)

  const useCase = useStudioStore(selectUseCase)
  const buildRunning = useStudioStore(selectBuildRunning)
  const outputReadable = useStudioStore(selectOutputReadable)

  const load = useStudioStore((s) => s.load)
  const select = useStudioStore((s) => s.select)
  const build = useStudioStore((s) => s.build)
  const poll = useStudioStore((s) => s.poll)
  const draft = useStudioStore((s) => s.draft)
  const saveStory = useStudioStore((s) => s.saveStory)
  const formBridge = useStudioStore((s) => s.formBridge)
  const selectBridge = useStudioStore((s) => s.selectBridge)
  const decide = useStudioStore((s) => s.decide)
  const acceptAll = useStudioStore((s) => s.acceptAll)
  const publish = useStudioStore((s) => s.publish)
  const recordVersion = useStudioStore((s) => s.recordVersion)
  const unpublish = useStudioStore((s) => s.unpublish)

  const signedInAs = useAuthStore((s) => s.identity?.email ?? null)

  /* Land on Build when arriving from the wizard's last step — the run it just started is the thing
     to watch. Every other arrival lands there too, because a studio with nothing built has nothing
     else to show. */
  const [tab, setTab] = useState(
    () => (routerLocation.state as { tab?: string } | null)?.tab ?? 'build',
  )

  useEffect(() => {
    void load()
  }, [load])

  /* A use case named in the URL wins over the store's default, so New Graph can hand a reader
     straight to the graph they just committed. Only honoured once it is really in the list, so a
     stale or hand-edited address leaves the selector where it was rather than emptying the page. */
  const claimed = useRef<string | null>(null)
  useEffect(() => {
    if (!routeUseCaseId || claimed.current === routeUseCaseId) return
    if (!useCases.some((u) => u.useCaseId === routeUseCaseId)) return
    claimed.current = routeUseCaseId
    select(routeUseCaseId)
  }, [routeUseCaseId, useCases, select])

  /*
   * The build watch. **A poll that stops is not a subscription**, so it runs only while something is
   * in flight and the store's own `poll` re-reads the whole studio once the last lane settles — which
   * is what records the version and unlocks the other tabs.
   */
  useEffect(() => {
    if (!buildRunning) return
    const id = window.setInterval(() => void poll(), 1200)
    return () => window.clearInterval(id)
  }, [buildRunning, poll])

  const report = async (run: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    const result = await run()
    if (!result.ok) message.error(result.error)
    return result
  }

  /* The whole-window canvas, addressed from here because the dataset prefix is the page's to add —
     a tab that built its own in-app URL would be a second place the dataset letter lives. */
  const fullViewHref = appPath(`/graph-studio/${encodeURIComponent(useCaseId ?? '')}/canvas`)

  const publishedBridgeId =
    versions.find((v) => v.publishedAt !== null)?.bridgeBuildId ?? null

  /* The version this Bridge would publish as, where one is already recorded — `null` for a draft,
     which is normal: a version is minted when somebody approves, not on their first edit. */
  const pendingVersion = versions.find((v) => v.bridgeBuildId === bridgeId) ?? null

  /* Publishing from the Bridge tab records the version first where there is not one yet, which is
     the normal case for a draft. One path, so the two tabs cannot approve different things. */
  const publishThisBridge = async () => {
    const existing = versions.find((v) => v.bridgeBuildId === bridgeId)
    if (existing) return publish(existing.graphVersionId, signedInAs)
    const recorded = await recordVersion()
    if (!recorded.ok) return recorded
    const next = useStudioStore.getState().versions.find((v) => v.bridgeBuildId === bridgeId)
    if (!next) {
      return { ok: false as const, error: 'No version names this Bridge yet — rebuild it and try again.' }
    }
    return publish(next.graphVersionId, signedInAs)
  }

  if (loading && useCases.length === 0) {
    return (
      <div style={{ padding: SP.xl, textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Graph Studio"
        subtitle="Build a use case's graphs, review what the Bridge found between them, and publish the version that answers questions."
      />

      {error ? <ApiErrorAlert error={error} onRetry={() => void load()} /> : null}

      {/*
        * **Two dead ends, and they need different exits.**
        *
        * Nothing connected at all is the outer one: every lane derives from a source somebody
        * connected, so the studio has nothing to build *from* and the fix is on Sources. Connected
        * but no use case is the inner one, and the fix is New Graph. Telling a reader to connect a
        * source when they already have three would be useless advice, and telling them to write a
        * brief when there is no data behind it sends them to a wizard that cannot finish.
        *
        * `connectedSources === 0` rather than falsy: it is null until the first load lands, and
        * treating that as zero would flash "no data source is connected" over a tenant that has some.
        */}
      {connectedSources === 0 ? (
        <NoSourceConnected detail="A graph is built from data this tenant has connected. Connect a BigQuery project, a Google Drive or a Gmail mailbox — its tables, documents and mail become the lanes a use case is built from here." />
      ) : useCases.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="No use case to build yet"
          description="Create one in New Graph — a studio is where a committed brief becomes a graph, so there is nothing here until one exists."
          action={
            <Typography.Link onClick={() => navigate(appPath('/new-graph'))}>
              Open New Graph
            </Typography.Link>
          }
        />
      ) : (
        <Space direction="vertical" size={SP.base} style={{ width: '100%' }}>
          <Space wrap size={SP.sm} align="center">
            <Typography.Text type="secondary">Use case</Typography.Text>
            <Select
              style={{ minWidth: 320 }}
              value={useCaseId ?? undefined}
              onChange={select}
              options={useCases.map((u) => ({
                value: u.useCaseId,
                label: u.name ?? u.useCaseId,
              }))}
            />
            {useCase ? (
              <>
                {/* The lanes, stated on the selector as well as on the Build tab — "why does this
                    one offer no document build" is the question a shortened list cannot answer. */}
                <Tag color={useCase.hasStructured ? 'blue' : 'default'}>
                  {useCase.hasStructured ? 'structured' : 'no structured lane'}
                </Tag>
                <Tag color={useCase.hasDocuments ? 'purple' : 'default'}>
                  {useCase.hasDocuments ? 'documents' : 'no document lane'}
                </Tag>
                <Tag color={useCase.status === 'committed' ? 'green' : 'default'}>
                  {useCase.status}
                </Tag>
              </>
            ) : null}
          </Space>

          {/*
           * The three output tabs read a build's output, so they are locked until one exists — and
           * locked again while a rebuild runs, because what they would otherwise show is the previous
           * build's output with nothing saying so. Settling a correspondence against a canvas that is
           * being superseded is a decision made on stale evidence. The lock says why, and says it
           * differently while a run is in flight: "start one" is the wrong instruction for somebody
           * already watching one.
           */}
          {useCase && !outputReadable ? (
            <Alert
              type="info"
              showIcon
              title={
                buildRunning
                  ? 'A build is running'
                  : 'Nothing has been built for this use case yet'
              }
              description={
                buildRunning
                  ? 'The Bridge, the canvas and Versions read a build’s output, so they stay closed until this run lands — what they would show until then is the previous build’s, with nothing saying so.'
                  : 'The Bridge, the canvas and Versions all read a build’s output. Build this use case first.'
              }
            />
          ) : null}

          {useCase ? (
            <Tabs
              activeKey={tab}
              onChange={setTab}
              items={[
                {
                  key: 'build',
                  label: 'Build',
                  children: (
                    <StudioBuildTab
                      useCase={useCase}
                      sgbBuild={sgbBuild}
                      dgbJob={dgbJob}
                      story={story}
                      storyDraft={storyDraft}
                      drafting={drafting}
                      building={building}
                      busy={busy}
                      onBuild={(text) => void report(() => build(text))}
                      onDraft={() => void report(() => draft())}
                      onSaveStory={(text) => void report(() => saveStory(text))}
                    />
                  ),
                },
                {
                  key: 'bridge',
                  label: 'Bridge',
                  disabled: !outputReadable,
                  children: (
                    <StudioBridgeTab
                      bridges={bridges}
                      bridgeId={bridgeId}
                      typeLinks={typeLinks}
                      unreviewedCount={unreviewedCount}
                      busy={busy}
                      canForm={useCase.hasStructured && useCase.hasDocuments}
                      laneNote={null}
                      publishedBridgeId={publishedBridgeId}
                      onSelectBridge={(id) => void selectBridge(id)}
                      onForm={() => void report(() => formBridge())}
                      sweeping={sweeping}
                      savingLinkId={savingLinkId}
                      publishing={busy}
                      pendingVersionNumber={pendingVersion?.versionNumber ?? null}
                      onDecide={(link, decision: TypeLinkDecision) =>
                        void report(() => decide(link, decision, signedInAs))
                      }
                      onAcceptAll={() => void report(() => acceptAll(signedInAs))}
                      onPublish={() => void report(publishThisBridge)}
                    />
                  ),
                },
                {
                  key: 'canvas',
                  label: 'Canvas',
                  disabled: !outputReadable,
                  children: (
                    <StudioCanvasTab
                      structured={sgbGraph}
                      entities={entities}
                      relations={relations}
                      typeLinks={typeLinks}
                      hasStructured={useCase.hasStructured}
                      hasDocuments={useCase.hasDocuments}
                      fullViewHref={fullViewHref}
                    />
                  ),
                },
                {
                  key: 'versions',
                  label: 'Versions',
                  disabled: !outputReadable,
                  children: (
                    <StudioVersionsTab
                      versions={versions}
                      busy={busy}
                      signedInAs={signedInAs}
                      onPublish={(id) => void report(() => publish(id, signedInAs))}
                      onUnpublish={(id) => void report(() => unpublish(id))}
                    />
                  ),
                },
              ]}
            />
          ) : null}
        </Space>
      )}
    </>
  )
}
