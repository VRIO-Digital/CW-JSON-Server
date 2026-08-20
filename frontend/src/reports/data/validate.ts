import type { Dataset } from '../data';

/**
 * Moving the dataset into JSON gave up compile-time checking: a `as Dataset`
 * assertion on a JSON import is not verified by TypeScript (even
 * `{ meta: {} } as Dataset` compiles). This walks the loaded data instead, so a
 * typo in `dataset.json` fails loudly at startup rather than rendering as
 * `undefined` somewhere deep in a block.
 */

const RISKS = ['high', 'med', 'low'];
const KINDS = ['cat', 'num', 'cta'];
const SPINES = ['generators', 'facilities', 'quarters', 'traces'];
const BLOCK_TYPES = ['kpis', 'chart', 'table', 'facilities', 'quarterly', 'traces'];
const SLOTS = ['graph', 'scope', 'measure', 'horizon'];

const STATUSES = ['draft', 'published'];

const TOP_LEVEL: (keyof Dataset)[] = [
  'meta',
  'audiences',
  'library',
  'fields',
  'assumptions',
  'opts',
  'generators',
  'facilities',
  'quarters',
  'traces',
  'starters',
  'presets',
  'slice_default',
];

const COLLECTIONS: (keyof Dataset)[] = [
  'audiences',
  'fields',
  'generators',
  'facilities',
  'quarters',
  'traces',
  'starters',
  'presets',
];

export function validateDataset(d: Dataset): Dataset {
  const bad: string[] = [];
  const oneOf = (where: string, value: unknown, allowed: string[]) => {
    if (!allowed.includes(String(value))) bad.push(`${where}: “${String(value)}” is not one of ${allowed.join(', ')}`);
  };

  for (const key of TOP_LEVEL) {
    if (d[key] == null) bad.push(`missing top-level key “${key}”`);
  }
  for (const key of COLLECTIONS) {
    const v = d[key];
    if (v != null && (!Array.isArray(v) || v.length === 0)) bad.push(`“${key}” must be a non-empty array`);
  }
  if (bad.length) throw new Error('dataset.json is malformed:\n  · ' + bad.join('\n  · '));

  for (const k of Object.keys(d.assumptions)) oneOf('assumptions', k, SLOTS);
  for (const k of SLOTS) {
    const slot = k as keyof typeof d.opts;
    const opts = d.opts[slot];
    const chosen = d.assumptions[slot];
    if (!opts?.options?.length) bad.push(`opts.${k} has no options`);
    if (!opts?.q) bad.push(`opts.${k} has no question`);
    if (!chosen?.value || !chosen?.label) bad.push(`assumptions.${k} needs both value and label`);
    // The default has to be one of the offered options, or the menu opens with
    // nothing marked as selected.
    else if (opts?.options && !opts.options.some((o) => o.value === chosen.value)) {
      bad.push(`assumptions.${k} defaults to “${chosen.value}”, which is not one of opts.${k}`);
    }
  }

  d.fields.forEach((f, i) => {
    if (!f.key || !f.label) bad.push(`fields[${i}] needs key and label`);
    oneOf(`fields[${i}].kind`, f.kind, KINDS);
    if (f.avail === false && !f.note) bad.push(`fields[${i}] (${f.key}) is unavailable but has no note explaining why`);
  });

  const fieldKeys = new Set(d.fields.map((f) => f.key));

  d.generators.forEach((g, i) => {
    if (!g.generator) bad.push(`generators[${i}] has no name`);
    oneOf(`generators[${i}].risk`, g.risk, RISKS);
    if (typeof g.cd !== 'boolean') bad.push(`generators[${i}].cd must be a boolean`);
    for (const n of ['evals', 'viols', 'enf', 'penalty', 'tons', 'manifests'] as const) {
      if (typeof g[n] !== 'number' || Number.isNaN(g[n])) bad.push(`generators[${i}].${n} must be a number`);
    }
  });

  d.quarters.forEach((q, i) => {
    if (!q.quarter) bad.push(`quarters[${i}] has no label`);
    for (const n of ['manifests', 'tons', 'rej', 'res'] as const) {
      if (typeof q[n] !== 'number') bad.push(`quarters[${i}].${n} must be a number`);
    }
  });

  d.traces.forEach((t, i) => {
    if (!t.mtn) bad.push(`traces[${i}] has no manifest tracking number`);
    if (!Array.isArray(t.transporters) || t.transporters.length === 0) {
      bad.push(`traces[${i}] (${t.mtn}) has no transporters`);
    }
  });

  d.starters.forEach((s, i) => {
    const at = `starters[${i}] (${s.id || '?'})`;
    if (!s.id || !s.label || !s.q || !s.title) bad.push(`${at} needs id, label, q and title`);
    oneOf(`${at}.spine`, s.spine, SPINES);
    if (!s.blocks?.length) bad.push(`${at} has no blocks`);
    s.blocks?.forEach((b, j) => oneOf(`${at}.blocks[${j}].type`, b.type, BLOCK_TYPES));
    s.reading?.slots?.forEach((slot) => {
      oneOf(`${at}.reading.slots`, slot, SLOTS);
      if (!s.reading.template.includes(`{${slot}}`)) {
        bad.push(`${at}.reading declares slot “${slot}” but the template has no {${slot}} placeholder`);
      }
    });
  });

  d.presets.forEach((p, i) => {
    if (!p.label) bad.push(`presets[${i}] has no label`);
    oneOf(`presets[${i}].block.type`, p.block?.type, BLOCK_TYPES);
  });

  d.slice_default.forEach((k) => {
    if (!fieldKeys.has(k)) bad.push(`slice_default references unknown field “${k}”`);
  });

  const audienceKeys = new Set(d.audiences.map((a) => a.key));
  d.audiences.forEach((a, i) => {
    if (!a.key || !a.label) bad.push(`audiences[${i}] needs key and label`);
  });

  // `library` may legitimately be empty — a fresh workspace has published nothing.
  if (!Array.isArray(d.library)) bad.push('“library” must be an array');
  else {
    const starterIds = new Set(d.starters.map((s) => s.id));
    const seen = new Set<string>();
    d.library.forEach((r, i) => {
      const at = `library[${i}] (${r.name || r.id || '?'})`;
      if (!r.id || !r.name) bad.push(`${at} needs id and name`);
      if (r.id && seen.has(r.id)) bad.push(`${at} reuses id “${r.id}”`);
      if (r.id) seen.add(r.id);
      oneOf(`${at}.status`, r.status, STATUSES);
      if (!starterIds.has(r.starter)) bad.push(`${at} is built from unknown starter “${r.starter}”`);
      if (!audienceKeys.has(r.audience)) bad.push(`${at} targets unknown audience “${r.audience}”`);
      if (!r.published_by || !r.saved_at) bad.push(`${at} needs published_by and saved_at`);
    });
  }

  if (bad.length) throw new Error('dataset.json is malformed:\n  · ' + bad.join('\n  · '));
  return d;
}
