/**
 * Client-safe dashboard types and pure helpers (no network, no secrets), so
 * route components can import them. The GraphQL operations live in
 * dashboard.server.ts.
 */

/**
 * A definition tally. `capped` means the store has more definitions than one
 * page holds, so `total` is a floor and the UI should render it as "N+" rather
 * than claim an exact figure.
 */
export type DefinitionCount = { total: number; capped: boolean };

export type DefinitionCounts = {
  metafields: DefinitionCount;
  metaobjects: DefinitionCount;
};

/** Renders a tally for a stat card; "—" when the count could not be fetched. */
export function formatDefinitionCount(count: DefinitionCount | null | undefined): string {
  if (!count) return "—";
  return count.capped ? `${count.total}+` : String(count.total);
}
