import { AUDIENCES, LIBRARY, STARTERS } from '../data';
import { assumptionsForStarter } from './assumptions';
import { instantiate } from './blocks';
import type { LibraryEntry, SavedReport, Starter } from '../types';

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

/** A seeded library row carries only a starter reference — rebuild the report from it. */
export function expandEntry(e: LibraryEntry): SavedReport {
  const starter = starterById(e.starter);
  return {
    id: e.id,
    name: e.name,
    status: e.status,
    starterId: starter.id,
    question: starter.q,
    assumptions: assumptionsForStarter(starter),
    filters: [],
    blocks: starter.blocks.map(instantiate),
    publishedBy: e.published_by,
    publishedRole: e.published_role,
    savedAt: e.saved_at,
    audience: e.audience,
  };
}

export function seedLibrary(): SavedReport[] {
  return LIBRARY.map(expandEntry);
}

/** Replaces the report with the same id, or appends it. Newest first. */
export function upsert(list: SavedReport[], report: SavedReport): SavedReport[] {
  const i = list.findIndex((r) => r.id === report.id);
  if (i < 0) return [report, ...list];
  const next = [...list];
  next[i] = report;
  return next;
}
