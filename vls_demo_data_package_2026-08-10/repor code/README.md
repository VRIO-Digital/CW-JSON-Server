# Context·Weave — report authoring prototype

React + TypeScript port of the single-file HTML prototype.

Navigation is two levels: a **Reports** item in the sidebar, opening a strip of three tabs.

**Reports → three tabs**

- **Library** — every saved report as a card: name, status, the byline of whoever published
  it, audience, and **Edit** / **Delete** actions.
- **Author a report** — the three-step flow: **Ask** a question in plain English →
  **Confirm** the read-back sentence (assumptions are clickable) → **Report**, editable
  block by block. Publishing asks for a report name and an audience.
- **Operational audience** — not built yet: an under-development placeholder with an inline
  SVG illustration, the count of reports already queued for the group, and what the finished
  read-only view will do. `ReportPane` already accepts `readOnly` + `provenance` for it, and
  `LibraryPane` has its `mode="audience"` branch — neither is routed to yet.

The tab strip is sticky, so it stays put while a long report scrolls under it.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm run typecheck
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/data/dataset.json` | The demo dataset — generators, facilities, quarters, manifest traces, starters, presets. Edit figures here |
| `src/data/validate.ts` | Startup check on that JSON (a `as Dataset` assertion on a JSON import is not verified by TypeScript) |
| `src/data.ts` | Typed accessor over the JSON — the named exports every other module imports |
| `src/types.ts` | Domain and UI types |
| `src/lib/select.ts` | Scope + filter selection over generators |
| `src/lib/format.ts` | Value formatting, field lookup, risk → colour tone |
| `src/lib/blocks.ts` | Block identity, KPI definitions, measure list |
| `src/panes/` | `LibraryPane` (cards, both tabs) and the three authoring steps: `AskPane`, `ConfirmPane`, `ReportPane` |
| `src/components/Sidebar.tsx` | The Reports nav item, with its count and the persona footer |
| `src/components/Tabs.tsx` | The tab strip used inside the Reports section |
| `src/components/PublishDialog.tsx` | Name + audience prompt shown before publishing |
| `src/lib/library.ts` | Saved-report shape, seeding from JSON, upsert, timestamps, initials |
| `src/components/blocks/` | The six block bodies plus the filter bar and block chrome |
| `src/components/MenuProvider.tsx` | Anchored popover menus (portal, closes on outside click / Escape) |
| `src/styles.css` | Design tokens and all component styles, carried over unchanged |

## How state flows

`App.tsx` owns everything: the current step, the prompt, the selected starter, the four
assumptions (graph / scope / measure / horizon), the filter chips, the block list, and edit
mode. Panes are presentational and take callbacks.

- **Graph** is the published graph the report resolves against. It appears as the first
  dropdown in the read-back sentence and is named again in the report's trust line.
- **Scope** comes from the `scope` assumption and selects the population (`scopeSet`).
- **Filters** slice that population (`applyFilters`); a chip set to `All` is a no-op.
  Changing scope clears filters, since the old values may no longer exist.
- **Blocks** are specs given an id by `instantiate`. Editing patches a block in place;
  `blockSig` stops the add-block menu re-offering something already on the page.

## Block types

`kpis`, `chart` (bars or columns), `table`, `facilities`, `quarterly`, `traces`. Only the
first three read the filtered generator rows; the other three render their own spine.

## Notes

- Demo data only — nothing is wired to a live graph.
- The field picker deliberately lists fields the graph *can't* serve (waste code,
  transporter, daily volume) with the reason attached, rather than hiding them.
