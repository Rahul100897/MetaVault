/**
 * Client-safe metafield types and pure helpers (no network, no secrets), so
 * both route components and server code can import them. The GraphQL operations
 * live in metafields.server.ts.
 */

export type OwnerType = "PRODUCT" | "COLLECTION" | "CUSTOMER" | "ORDER";

type OwnerConfig = {
  /** GraphQL connection field on QueryRoot */
  field: string;
  /** Field used as the human-readable owner label */
  labelField: string;
  /** UI label */
  label: string;
};

export const OWNER_CONFIG: Record<OwnerType, OwnerConfig> = {
  PRODUCT: { field: "products", labelField: "title", label: "Products" },
  COLLECTION: { field: "collections", labelField: "title", label: "Collections" },
  CUSTOMER: { field: "customers", labelField: "displayName", label: "Customers" },
  ORDER: { field: "orders", labelField: "name", label: "Orders" },
};

export const OWNER_TYPES = Object.keys(OWNER_CONFIG) as OwnerType[];

export function isOwnerType(value: string): value is OwnerType {
  return value in OWNER_CONFIG;
}

export type MetafieldRow = {
  /** Metafield GID */
  id: string;
  ownerId: string;
  ownerLabel: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type MetafieldPage = {
  rows: MetafieldRow[];
  hasNextPage: boolean;
  endCursor: string | null;
};

export type MetafieldSetInput = {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type UserError = { field: string[] | null; message: string; code?: string };

export type SetResult = {
  metafields: Array<{ id: string; namespace: string; key: string; value: string; type: string }>;
  userErrors: UserError[];
};

export type MetafieldIdentifier = {
  ownerId: string;
  namespace: string;
  key: string;
};

export type DeleteResult = {
  deletedMetafields: Array<{ ownerId: string; namespace: string; key: string }>;
  userErrors: UserError[];
};

/** Split an array into chunks of `size` (used for the 25-per-request limit). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
