/**
 * Replays `studioLanes.js` against both shipped documents, with nothing running.
 *
 * **The derivation is pure, which is what makes this possible** — the same reasoning as
 * `verify-report-export.js`: it takes a document and gives back plain data, so what a lane derives to
 * can be asserted without a server, a bucket, or five tabs of clicking. A derivation that can only be
 * checked by building a graph and looking at it is one nobody checks.
 *
 * What it asserts is the part that fails *silently*. A lane that derives nothing renders as an empty
 * canvas, which reads as "this use case has no data" rather than as a broken reference; a Bridge that
 * corresponds nothing reads as two unrelated graphs; and a figure invented to fill a field is
 * indistinguishable from a measured one. Each of those is checked here against the real documents
 * rather than a fixture, because a fixture drifts from the thing it stands for.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chunkEvidence,
  conceptsFor,
  corpusDocuments,
  deriveLanes,
  dgbClasses,
  dgbCounts,
  dgbEntities,
  dgbMentions,
  dgbRelations,
  needsReview,
  selectedTables,
  shippedGraph,
  structuredTableCount,
  sgbCounts,
  sgbGraph,
  sgbStory,
  studioSources,
  studioUseCases,
  typeLinks,
} from '../studioLanes.js'

const backend = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []
let checks = 0

const ok = (label, detail = '') => {
  checks += 1
  console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
}
const bad = (label, detail = '') => {
  checks += 1
  problems.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}
const expect = (label, condition, detail) => (condition ? ok(label, detail) : bad(label, detail))

for (const file of ['db.json', 'db.CAPEX.json']) {
  const doc = JSON.parse(readFileSync(join(backend, file), 'utf8'))
  console.log(`\n${file}`)

  const cases = studioUseCases(doc)

  /*
   * **A document with no use case is skipped, not failed.**
   *
   * This script checks whether the *derivation* is right, and a document with nothing to derive from
   * gives it nothing to be right about — so failing here would be a lane verifier reporting a data
   * state. Whether a dataset *ought* to ship a committed brief is a different question with an owner
   * already: `check-docs` asserts it per dataset and names `npm run ingest:capex` as the fix. Two
   * guards over one fact is how they come to disagree.
   *
   * Said out loud rather than passed silently, because "0 checks, 0 failed" reads as a clean run.
   */
  if (cases.length === 0) {
    console.log('  — no use case in this document, so there is no lane to derive. Skipped.')
    console.log('    (whether it should ship one is check-docs’ claim, not this script’s)')
    continue
  }
  expect('the studio lists this document’s use cases', cases.length > 0, `${cases.length}`)

  /* Every use case is listed, not only the committed ones: a draft can already have been built, so a
     filtered list would hide graphs that exist. */
  expect(
    'every use case in the document reaches the list',
    cases.length === (doc.graph_use_cases ?? []).length,
    `${cases.length} of ${(doc.graph_use_cases ?? []).length}`,
  )

  const sources = studioSources(doc)
  expect(
    'the sources a lane is derived from are the document’s own',
    sources.length === (doc.projects ?? []).length + (doc.drives ?? []).length,
    `${sources.length}`,
  )

  /*
   * **Whether this document ships a graph rather than deriving one**, which changes what several of
   * the checks below are claims *about*.
   *
   * A derived Bridge row is nobody's decision yet and its reason is composed from a resolution
   * count; a shipped one carries a model's own prose and whatever verdict a person recorded against
   * it. Both are right, and asserting the derived rules over a shipped lane would fail the feature
   * rather than the fault. So the rules that are about the **derivation** are scoped to it, and a
   * shipped lane gets the rules that are about *it* — that every row resolves inside the lanes it
   * names, and that this app's own review rule agrees with the export's count.
   */
  const shipped = shippedGraph(doc)
  if (shipped) {
    console.log('  (this document ships a built graph — the lanes serve it rather than deriving)')
  }

  for (const useCase of doc.graph_use_cases ?? []) {
    const lanes = deriveLanes(doc, useCase)
    console.log(`  · ${useCase.use_case_id}`)

    /* A lane is derived from what is attached. A use case with picks but no lane means the derivation
       failed to resolve them, which renders as "nothing to build" — an answer, and the wrong one. */
    if ((useCase.sources ?? []).length > 0) {
      expect(
        'a use case with source picks derives at least one lane',
        lanes.hasStructured || lanes.hasDocuments,
        `${(useCase.sources ?? []).length} picks`,
      )
    }

    if (lanes.hasStructured) {
      const graph = sgbGraph(doc, useCase, 'verify')
      const counts = sgbCounts(doc, useCase)

      /* One answer to "how many tables does this lane cover", whichever path served it: the selector
         strip said *18 tables* over a drawing of five while it read `selectedTables` instead. */
      expect(
        'the table count every surface reports is the lane’s own',
        structuredTableCount(doc, useCase) === graph.tables.length,
        `${structuredTableCount(doc, useCase)} table(s)`,
      )
      expect('the structured lane derives tables', graph.tables.length > 0, `${graph.tables.length}`)
      if (!shipped) {
        /* **A claim about the derivation, so it is scoped to it.** A shipped lane's tables are the
           tables that build ran over — CAPEX's export names 5 where its picks admit 18 — and
           asserting the derived rule over it would fail the feature rather than the fault. */
        expect(
          'and the tables it derives are the picks it admitted',
          graph.tables.length === selectedTables(doc, useCase).length,
        )
      }
      expect('it derives concepts', graph.concepts.length > 0, `${graph.concepts.length}`)
      expect(
        'and the concepts are the canvas’s own, not a second nomination',
        graph.concepts.length === conceptsFor(doc, useCase).length,
      )

      /* Every edge must resolve to a node the graph carries. A dangling endpoint is dropped by the
         drawing rather than raised, which is the silent loss `validateDb` refuses on the canvas. */
      const refs = new Set([
        ...graph.tables.map((t) => t.table_ref),
        ...graph.columns.map((c) => c.column_ref),
        ...graph.concepts.map((c) => c.concept_ref),
        /* Both spellings of the story group's ref: the derivation writes it bare on a COVERS edge
           and a shipped lane writes it with its `story_group:` prefix. One check over one fact,
           widened rather than duplicated for the shipped path. */
        graph.story_group?.story_group_id,
        `story_group:${graph.story_group?.story_group_id}`,
      ])
      const dangling = graph.edges.filter((e) => !refs.has(e.src_ref) || !refs.has(e.dst_ref))
      expect(
        'every structured edge resolves at both ends',
        dangling.length === 0,
        dangling.length ? `${dangling.length} dangling, e.g. ${dangling[0].src_ref} -> ${dangling[0].dst_ref}` : `${graph.edges.length} edges`,
      )

      /* Counts are derived from the graph rather than typed, so the panel and the drawing cannot
         disagree about how big a build is. */
      expect(
        'the reported counts are the graph’s own',
        counts.table_count === graph.tables.length &&
          counts.column_count === graph.columns.length &&
          counts.concept_count === graph.concepts.length &&
          counts.relation_count === graph.edges.length,
      )

      /* A declared column has no sample, so its statistics are null rather than a plausible figure —
         the whole value of a real profile is that its figures were measured. */
      const invented = graph.columns.filter(
        (c) => c.profile.distinct_count_in_sample !== null && !c.profile.is_sample_claim,
      )
      expect(
        'a column with no sample carries no invented statistic',
        invented.length === 0,
        invented.length ? `${invented.length} columns claim a distinct count with no sample` : '',
      )

      const story = sgbStory(doc, useCase)
      expect('the story is the tenant’s own words', story.story.length > 0)
      expect(
        'and nobody has edited it at derivation time',
        story.edited_by_user === false,
        'an edit is the server’s runtime state, not the derivation’s',
      )
    }

    if (lanes.hasDocuments) {
      const entities = dgbEntities(doc, useCase)
      const relations = dgbRelations(doc, useCase)
      const counts = dgbCounts(doc, useCase)
      const documents = corpusDocuments(doc, useCase)

      expect('the document lane derives its corpus', documents.length > 0, `${documents.length}`)
      if (!shipped) {
        /* **The derived lane makes each document an entity of itself**, which is what puts a document
           on the canvas beside what it was found to be about. A shipped snapshot states its documents
           and its extracted entities in two separate lists, so this is a claim about the derivation
           and not about the lane. */
        expect(
          'every document in the corpus is an entity of the lane',
          documents.every((row) => entities.some((e) => e.entity_id === row.document.document_id)),
        )
      } else {
        /* What must hold instead: every mention points at an entity the snapshot carries. That was a
           real break — mentions were still derived from `document_extractions` while the entities came
           from the export, so every one of them was an orphan. */
        const ids = new Set(entities.map((e) => e.entity_id))
        expect(
          'every mention of a shipped lane points at an entity it carries',
          dgbMentions(doc, useCase).every((m) => ids.has(m.entity_id)),
          `${dgbMentions(doc, useCase).length} mention(s)`,
        )
      }

      /* A document is typed `Document` with its filing label beside it. Using the label as the type
         read plausibly and put a hue no ontology declares on the canvas, and every filing label into
         the Bridge. */
      const docEntities = entities.filter((e) => e.kind === 'document')
      expect(
        'a document is typed Document, with its filing label beside it',
        docEntities.every((e) => e.entity_type === 'Document'),
        `${docEntities.length} documents`,
      )

      const ids = new Set(entities.map((e) => e.entity_id))
      const dangling = relations.filter(
        (r) => !ids.has(r.subject_entity_id) || !ids.has(r.object_entity_id),
      )
      expect(
        'every document relation resolves at both ends',
        dangling.length === 0,
        dangling.length ? `${dangling.length} dangling` : `${relations.length} relations`,
      )
      expect(
        'the reported counts are the lane’s own',
        counts.entity_count === entities.length &&
          counts.relation_count === relations.length &&
          counts.class_count === dgbClasses(doc, useCase).length,
      )

      /* Resolution is the point of this lane: where two documents name one facility they share a
         node, and the mention count is what says so. */
      const shared = entities.filter((e) => e.kind === 'resolved' && e.mention_count > 1)
      if (entities.some((e) => e.kind === 'resolved')) {
        ok('entities resolve', `${shared.length} node(s) carry more than one mention`)
      }

      /* No document here stores its body, and the evidence says so rather than composing a sentence
         and labelling it verbatim. */
      const first = documents[0]
      const evidence = chunkEvidence(doc, useCase, `chunk:${first.document.document_id}`)
      expect(
        'the evidence names the document and invents no passage',
        evidence !== null && evidence.chunk_text === null && evidence.document_name.length > 0,
        'chunk_text is null, never a fabricated quotation',
      )

      const mentions = dgbMentions(doc, useCase)
      expect(
        'every mention points at an entity the lane carries',
        mentions.every((m) => ids.has(m.entity_id)),
        `${mentions.length} mentions`,
      )
    }

    if (lanes.hasStructured && lanes.hasDocuments) {
      const links = typeLinks(doc, useCase, 'verify')
      expect('the Bridge considers correspondences', links.length > 0, `${links.length}`)

      /* Reject rows are carried, not dropped: the list records what was *considered*, so a pair the
         derivation declined is distinguishable from one it never saw. */
      expect(
        'reject rows are carried rather than dropped',
        links.some((l) => l.decision === 'reject'),
      )
      /* Low-confidence first — attention goes where the judgement was closest. */
      const firstHigh = links.findIndex((l) => l.confidence === 'high')
      const lastLow = links.map((l) => l.confidence).lastIndexOf('low')
      expect(
        'and they are ordered low-confidence first',
        firstHigh === -1 || lastLow === -1 || lastLow < firstHigh,
      )
      /* Confidence is categorical. A number here would invite being read as a measurement. */
      expect(
        'confidence is categorical, never a score',
        links.every((l) => l.confidence === 'high' || l.confidence === 'low'),
      )
      if (shipped) {
        /*
         * A shipped Bridge is a record of a review that happened, so "every row starts undecided" is
         * false of it *by design*. What must hold instead is that every row is about two things both
         * lanes carry — a Type Link naming a concept the canvas has no node for draws a line from
         * nothing — and that this app's review rule and the export's own count agree, because the
         * Bridge tab and the publish route both read that rule.
         */
        const conceptRefs = new Set(sgbGraph(doc, useCase, 'verify').concepts.map((c) => c.concept_ref))
        const entityTypes = new Set(dgbEntities(doc, useCase).map((e) => e.entity_type))
        expect(
          'every shipped Type Link names a concept the structured lane carries',
          links.every((l) => conceptRefs.has(l.concept_ref)),
        )
        expect(
          'and an entity type the document lane carries',
          links.every((l) => entityTypes.has(l.entity_type)),
        )
        expect(
          'the app’s review rule agrees with the shipped count',
          links.filter(needsReview).length === (shipped.bridge?.counts?.needs_review ?? 0),
          `${links.filter(needsReview).length} to review`,
        )
        /* **A shipped Bridge reaches the reviewer undecided**, whatever the export recorded: a
           decision made in another system is not one this reader made, and a tab opening with
           *Needs review (0)* credits them with judgements they never made. */
        expect(
          'and every shipped pair arrives as a proposal, so the whole queue is theirs to decide',
          links.every((l) => l.decided_by === 'llm') &&
            links.filter(needsReview).length === links.length,
          `${links.length} pair(s), none pre-decided`,
        )
        /* Re-keyed to the run in hand, or every decision a reader records is filed under a build
           this process never made. */
        expect(
          'and every row is keyed to the build in hand',
          links.every((l) => l.bridge_build_id === 'verify'),
        )
      } else {
        /* An identity link is grounded in a resolution rather than in two names matching. */
        const identity = links.filter((l) => l.decision === 'identity')
        expect(
          'an identity link is grounded in a resolution',
          identity.every((l) => /resolved to a/.test(l.reason)),
          `${identity.length} identity link(s)`,
        )
        /* Nothing is decided by the derivation: every row starts needing a person — rejects
           included, since the gate covers every pair the deriver was put. */
        expect(
          'every pair starts undecided',
          links.every(needsReview),
        )
      }
    }
  }
}

console.log(
  `\nverify:studio-lanes — ${checks} checks, ${problems.length} failed`,
)
if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
