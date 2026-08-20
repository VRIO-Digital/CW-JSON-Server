import type { Dataset } from '../data';

/**
 * Moving the dataset into JSON gave up compile-time checking: a `as Dataset`
 * assertion on a JSON import is not verified by TypeScript (even
 * `{ meta: {} } as Dataset` compiles). This walks the loaded data instead, so a
 * typo in `dataset.json` fails loudly at startup rather than rendering as
 * `undefined` somewhere deep in a block.
 */

/* 'text' is a free-text column — a project name or a reason for variance. The catalogue this was
   written against had none, so it was not in the list; a tenant that has them is not malformed. */
const KINDS = ['cat', 'num', 'cta', 'text'];
const SPINES = ['register', 'generators', 'facilities', 'quarters', 'traces'];
const BLOCK_TYPES = ['kpis', 'chart', 'table', 'facilities', 'quarterly', 'traces'];
const SLOTS = ['graph', 'scope', 'measure', 'horizon'];

const STATUSES = ['draft', 'published'];

/*
 * The keys a dataset must carry at all.
 *
 * EPA's four spines were on this list — `generators`, `facilities`, `quarters`, `traces` — so a
 * dataset with one register was refused for not having three rosters it has no business having. The
 * register is required below under whichever name the dataset uses, and `library` is optional: the
 * prototype's seeded shelf is its own fiction and a hosted dataset ships none.
 */
const TOP_LEVEL: (keyof Dataset)[] = [
  'meta',
  'audiences',
  'fields',
  'assumptions',
  'opts',
  'starters',
  'presets',
  'slice_default',
];

/* Of those, the ones that must not be empty — a dataset with no fields or no starters renders
   nothing at all, which is a lost dataset rather than a small one. */
const COLLECTIONS: (keyof Dataset)[] = ['audiences', 'fields', 'starters', 'presets'];

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

  /*
   * **The register, checked against the field catalogue rather than against EPA's field names.**
   *
   * This used to require `generator`, a `risk` from three literals, a boolean `cd` and six named
   * numbers — which is a description of one tenant's rows, so another tenant's register could not be
   * valid however well-formed it was. What is checked now is the thing that actually breaks a render:
   * a row missing a field the catalogue says is available renders as a blank cell, and a field the
   * catalogue calls numeric holding a string sorts and totals as `NaN`.
   */
  const register = d.register ?? d.generators ?? [];
  if (register.length === 0) bad.push('the register is empty — the flow would compose over nothing');

  const labelField = d.label_field ?? d.fields.find((f) => f.kind !== 'num')?.key;
  if (!labelField) {
    bad.push('no label_field, and no non-numeric field to fall back to — no row could be named');
  } else if (!fieldKeys.has(labelField)) {
    bad.push(`label_field "${labelField}" is not one of the fields`);
  }

  const available = d.fields.filter((f) => f.avail !== false);
  register.forEach((row, i) => {
    if (labelField && !row[labelField]) bad.push(`register[${i}] has no ${labelField}`);
    for (const f of available) {
      const v = row[f.key];
      if (v === undefined) {
        bad.push(`register[${i}] has no "${f.key}", which the catalogue lists as available`);
      } else if (f.kind === 'num' && (typeof v !== 'number' || Number.isNaN(v))) {
        bad.push(`register[${i}].${f.key} must be a number`);
      }
    }
  });

  /* A tile reads a field, so a tile naming one the register does not carry is a blank figure. */
  (d.kpis ?? []).forEach((k, i) => {
    const at = `kpis[${i}] (${k.key || '?'})`;
    if (!k.key || !k.label) bad.push(`${at} needs a key and a label`);
    for (const ref of [k.field, k.against]) {
      if (ref && !fieldKeys.has(ref)) bad.push(`${at} reads "${ref}", which is not a field`);
    }
  });

  /* A chart may only plot a field that exists and is numeric. */
  (d.measures ?? []).forEach((m) => {
    const f = d.fields.find((x) => x.key === m);
    if (!f) bad.push(`measures names "${m}", which is not a field`);
    else if (f.kind !== 'num') bad.push(`measures names "${m}", which the catalogue calls ${f.kind}`);
  });

  /*
   * EPA's three secondary spines, checked only where the dataset carries them. A tenant whose
   * authoring flow has one register does not, and requiring them would mean inventing three rosters
   * to satisfy a validator.
   */
  (d.quarters ?? []).forEach((q, i) => {
    if (!q.quarter) bad.push(`quarters[${i}] has no label`);
    for (const n of ['manifests', 'tons', 'rej', 'res'] as const) {
      if (typeof q[n] !== 'number') bad.push(`quarters[${i}].${n} must be a number`);
    }
  });

  (d.traces ?? []).forEach((t, i) => {
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
