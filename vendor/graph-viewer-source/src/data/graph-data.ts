import type { RawGraph } from "../types";
import { buildDemoGraph } from "./demo-dataset";

/**
 * The graph payload the app renders.
 *
 * To swap in the real export, replace this with the `DATA` object from the
 * original HTML and drop `demo-dataset.ts` / `facilities.ts`. `normalizeGraph`
 * reads `label` / `predicate` / `rel` / `kind` for the edge predicate and
 * `aggregate` / `class: "agg"` for dashed measure edges, so either spelling
 * used by the exporter will work unchanged.
 */
export const RAW_GRAPH: RawGraph = buildDemoGraph();
