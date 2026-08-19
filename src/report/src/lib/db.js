/* ==========================================================================
   THE FIXTURE STORE

   db.json is assembled from the three files the demo package shipped with —
   report_data.json (the world), report_specs.json (the report definitions) and
   report_resolved.json (what the product's resolver returned for each of the
   three published reports).

   Nothing here computes a figure. That is the whole discipline the prototype
   was written around and the reason this port reads a resolved payload rather
   than a fact set: a second implementation of the aggregation rules agrees with
   the first only until one of them is edited. Every number these components
   print came out of `display` or `exact` on a served payload.
   ========================================================================== */
import db from '../data/db.json'

export { db }

export const tenant   = db.tenant
export const personas = db.personas
export const people   = db.people

/* The three published reports, in library order. */
export const reports = db.reports

export const reportById   = id   => reports.find(r => r.id === id) || null
export const reportBySlug = slug => reports.find(r => r.slug === slug) || null

/* The resolver output. Keyed by report id, exactly as the resolver emitted it. */
export const resolvedById = id => db.resolved[id] || null

/* Every page in this build is served under one persona, because that is how the
   three standalone HTML pages were produced: they signed in as the Domain
   Architect and opened one report. The persona is READ OFF THE RESOLVED VIEW
   rather than chosen here — a scope is a property of the run that produced the
   figures, and picking one in the browser is how a client ends up declaring its
   own predicate. */
export const personaOf = view =>
  db.personas[String(view?.persona || '').replace(/^persona_/, '')] || null

/* Drafts and the one removed report are carried so the library can show the
   lifecycle states honestly rather than implying the library is only ever three
   published rows. */
export const reportDrafts   = db.reportDrafts
export const removedReports = db.removedReports

/* Report status → the class the prototype's stylesheet paints it with. */
export const STATUS_PILL = {
  published: 'hi',
  pending_approval: 'md',
  draft: 'neu',
  blocked: 'lo',
  archived: 'lo',
  stale_baseline: 'md',
}

export const statusLabel = s => String(s || '').replace(/_/g, ' ')
