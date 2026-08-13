import { AUDIENCES, LIBRARY, STARTERS } from '../data';
import { assumptionsForStarter } from './assumptions';
import { instantiate } from './blocks';
import type { Assumption, LibraryEntry, SavedReport, Starter } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** “13 Aug 2026, 14:05” — same shape as the seeded `saved_at` values. */
export function stamp(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(now.getDate())} ${MONTHS[now.getMonth()]} ${now.getFullYear()}, ${p(now.getHours())}:${p(now.getMinutes())}`;
}

/** Initials for the byline avatar: “Ana Delgado” → “AD”. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function audienceLabel(key: string): string {
  return AUDIENCES.find((a) => a.key === key)?.label ?? key;
}

export function newReportId(): string {
  return 'r' + Date.now().toString(36);
}

function starterById(id: string): Starter {
  const s = STARTERS.find((x) => x.id === id);
  if (!s) throw new Error(`library entry references unknown starter “${id}”`);
  return s;
}

/**
 * A seeded library row carries only a starter reference — rebuild the report from it.
 *
 * `graph` is the published graph these rows should read from. Without it they fall back to the
 * dataset's default, which names a graph that does not exist — and every card then says "Reads
 * from the VLS Compliance graph", asserting a live graph nobody published. The host passes the
 * real one; the prototype standing alone keeps its own.
 */
export function expandEntry(e: LibraryEntry, graph?: Assumption): SavedReport {
  const starter = starterById(e.starter);
  return {
    id: e.id,
    name: e.name,
    status: e.status,
    starterId: starter.id,
    question: starter.q,
    assumptions: assumptionsForStarter(starter, graph),
    filters: [],
    blocks: starter.blocks.map(instantiate),
    publishedBy: e.published_by,
    publishedRole: e.published_role,
    savedAt: e.saved_at,
    audience: e.audience,
  };
}

export function seedLibrary(graph?: Assumption): SavedReport[] {
  return LIBRARY.map((e) => expandEntry(e, graph));
}

/**
 * A governed definition, opened as a report.
 *
 * The definitions and the prototype's starters come from the same file in the package
 * (`07_reports/report_authoring_data.json`), so a governed row **is** one of these starters — which
 * is what makes Open and Edit possible on a row that arrived from the API. It is matched on
 * `report_tag` ("Report 2"), not on position and not on the title: a composed row carries its
 * origin report's tag too, and the titles differ between the tenant's heading and the starter's.
 *
 * Returns `null` rather than throwing when nothing matches, and the caller offers no Open on a row
 * it cannot build — a button that opens the wrong report is worse than a button that is absent.
 */
export function starterForTag(reportTag: string, reportId?: string): Starter | undefined {
  return (
    STARTERS.find((s) => s.report_tag === reportTag) ??
    (reportId ? STARTERS.find((s) => s.id === reportId) : undefined)
  );
}

/** Builds the report a governed row names, so the existing open/edit path can load it. */
export function fromGoverned(
  row: {
    reportId: string;
    reportTag: string;
    title: string;
    question: string;
    author: string | null;
    category: string;
    asOf: string | null;
    entitledRoles: { roleId: string; label: string }[];
  },
  graph?: Assumption,
): SavedReport | null {
  const starter = starterForTag(row.reportTag, row.reportId);
  if (!starter) return null;
  return {
    id: row.reportId,
    name: row.title,
    /* Every governed row the Library offers to open is published; a draft is not a definition. */
    status: 'published',
    starterId: starter.id,
    /* The tenant's question, not the starter's — the card quotes it and the report should agree. */
    question: row.question || starter.q,
    assumptions: assumptionsForStarter(starter, graph),
    filters: [],
    blocks: starter.blocks.map(instantiate),
    /* Whoever defined it, and nobody invented where it is missing. */
    publishedBy: row.author ?? 'unknown',
    publishedRole: row.category,
    savedAt: row.asOf ?? '',
    /*
     * The prototype's own audience vocabulary is a single group key, and a governed row names app
     * personas — a different pool. Rather than mistranslate one into the other, the report opens
     * under the prototype's default group and the *row* is where the real audience is stated.
     */
    audience: AUDIENCES[0]?.key ?? 'operations',
  };
}

/** Replaces the report with the same id, or appends it. Newest first. */
export function upsert(list: SavedReport[], report: SavedReport): SavedReport[] {
  const i = list.findIndex((r) => r.id === report.id);
  if (i < 0) return [report, ...list];
  const next = [...list];
  next[i] = report;
  return next;
}
