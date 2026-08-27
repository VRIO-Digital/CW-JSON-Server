import type { Dataset } from '../data';

/**
 * Moving the dataset into JSON gave up compile-time checking: a `as Dataset`
 * assertion on a JSON import is not verified by TypeScript (even
 * `{ meta: {} } as Dataset` compiles). This walks the loaded data instead, so a
 * typo in `dataset.json` fails loudly at startup rather than rendering as
 * `undefined` somewhere deep in a block.
 */

const KINDS = ['cat', 'num', 'cta', 'text'];
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
  'row_model',
];

/* Always non-empty: without them there is no population to report on and no way to compose a report. */
const COLLECTIONS: (keyof Dataset)[] = ['audiences', 'fields', 'generators', 'starters', 'presets'];

/**
 * The three rosters only some datasets have rows for, and the block each one draws.
 *
 * EPA ships facility, quarterly and manifest-trace rosters; CAPEX's authoring fixture is projects and
 * nothing else, so requiring these non-empty would refuse a dataset that is complete on its own terms.
 * The rule is not "may be empty" but **"may be empty exactly when the row model does not draw it"** —
 * an empty roster behind a block a starter can still add is a panel that renders nothing.
 */
const OPTIONAL_ROSTERS: { key: keyof Dataset; block: string }[] = [
  { key: 'facilities', block: 'facilities' },
  { key: 'quarters', block: 'quarterly' },
  { key: 'traces', block: 'traces' },
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

  /* Every one of these is printed somewhere with no fallback behind it: the persona in the header, the
     noun in a table's count, the example under the Ask box, the provenance on the confirm step. A
     missing one renders the word "undefined" on screen, which is why they are checked rather than
     defaulted — a default here would put this file's words in the tenant's mouth. */
  for (const k of [
    'persona_name',
    'persona_role',
    'persona_initials',
    'entity_plural',
    'entity_singular',
    'ask_placeholder',
    'scope_line',
    'source_trace',
  ] as const) {
    if (!d.meta?.[k]) bad.push(`meta.${k} is missing`);
  }

  const fieldKeys = new Set(d.fields.map((f) => f.key));

  /*
   * ---------------- the row model, and the rows read through it ----------------
   *
   * This block checked EPA's eleven columns by name — `risk` one of three levels, `cd` a boolean, six
   * named numbers — which is the same mistake the engine made, in the one place whose job is to catch
   * it. What is actually required of a row is what the dataset says it reads: a name, a state the tones
   * cover, and a number in every column a chart may rank by.
   */
  const rm = d.row_model;
  if (rm) {
    if (!rm.label) bad.push('row_model.label names no column');
    else if (!fieldKeys.has(rm.label)) bad.push(`row_model.label is "${rm.label}", which is not a field`);
    if (rm.status && !fieldKeys.has(rm.status)) {
      bad.push(`row_model.status is "${rm.status}", which is not a field`);
    }
    if (!rm.measures?.length) bad.push('row_model.measures is empty — no chart could rank anything');
    rm.measures?.forEach((m) => {
      if (!fieldKeys.has(m)) bad.push(`row_model.measures names "${m}", which is not a field`);
    });
    /* Every scope the reader can pick has to admit rows on purpose. A missing rule selects nothing,
       which reads as a slice that matched no rows rather than as an option nobody wired up. */
    d.opts.scope?.options?.forEach((o) => {
      if (!rm.scopes?.[o.value]) bad.push(`row_model.scopes has no rule for the "${o.value}" scope`);
    });
    rm.kpis?.forEach((k, i) => {
      if (!k.key || !k.label) bad.push(`row_model.kpis[${i}] needs key and label`);
      if (k.agg !== 'rows' && !k.field) bad.push(`row_model.kpis[${i}] (${k.key}) aggregates no field`);
      if (k.field && !fieldKeys.has(k.field)) {
        bad.push(`row_model.kpis[${i}] reads "${k.field}", which is not a field`);
      }
    });
    for (const { key, block } of OPTIONAL_ROSTERS) {
      const rows = d[key];
      const drawn = rm.blocks?.includes(block as never);
      if (!Array.isArray(rows)) bad.push(`"${key}" must be an array`);
      else if (drawn && rows.length === 0) {
        bad.push(`"${key}" is empty, but row_model.blocks lists "${block}" — that block would draw nothing`);
      }
    }

    d.generators.forEach((g, i) => {
      if (!g[rm.label]) bad.push(`generators[${i}] has no ${rm.label}`);
      if (rm.status && !rm.tones?.[String(g[rm.status] ?? '')]) {
        bad.push(`generators[${i}].${rm.status} is "${String(g[rm.status] ?? '')}", which row_model.tones does not cover`);
      }
      rm.measures?.forEach((m) => {
        if (typeof g[m] !== 'number' || Number.isNaN(g[m] as number)) {
          bad.push(`generators[${i}].${m} must be a number — a chart ranks by it`);
        }
      });
    });
  }

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
