# vendor/

Source material this app was built *from*, kept for reference and deliberately **outside
`src/`**.

## `graph-viewer-source/`

The standalone Context Weave graph viewer — the folder `src/graph-viewer` was vendored from.
It is a whole Vite app (its own `package.json`, `index.html`, demo dataset), and it lived at
`src/grap` for a while, which caused two problems worth recording:

- **Two live copies of one viewer.** Anything under `src/` can be imported, and a second
  canvas that could be imported is the "second truth" the studio is built to avoid. It is
  also type-checked by `tsc -b` and swept by `check-docs`, which is how its raw-px
  stylesheet started failing the `--sp-*` rule for a component nobody renders.
- **Its demo dataset.** The viewer shipped with synthetic facilities and penalties. In the
  app the graph is the tenant's, adapted from `GET /graph-studio/:id/canvas`; the demo data
  stayed here so it cannot be rendered by accident.

Read it to see what the viewer does on its own — `npm i && npm run dev` inside it still
works. Change `src/graph-viewer` for anything the app should do.
