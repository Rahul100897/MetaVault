/**
 * Admin GraphQL snippet generation (pure / client-safe).
 *
 * The Liquid snippets in ./liquid.ts cover reading a value in a theme; these
 * cover reading and writing the same value through the Admin API, which is what
 * developers building against the store actually need.
 */

import type { OwnerType } from "./metafields";
import type { SnippetTarget } from "./liquid";

/** Singular QueryRoot field for each owner type. */
const QUERY_ROOT: Record<OwnerType, string> = {
  PRODUCT: "product",
  COLLECTION: "collection",
  CUSTOMER: "customer",
  ORDER: "order",
};

/** Field used as the owner's human-readable label in the generated query. */
const LABEL_FIELD: Record<OwnerType, string> = {
  PRODUCT: "title",
  COLLECTION: "title",
  CUSTOMER: "displayName",
  ORDER: "name",
};

function pascal(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/** A read query for the target. */
export function generateGraphqlQuery(target: SnippetTarget): string {
  if (target.kind === "metafield") {
    const root = QUERY_ROOT[target.ownerType];
    const label = LABEL_FIELD[target.ownerType];
    const opName = `${pascal(root)}${pascal(target.key)}`;
    return [
      `query ${opName}($id: ID!) {`,
      `  ${root}(id: $id) {`,
      `    id`,
      `    ${label}`,
      `    metafield(namespace: "${target.namespace}", key: "${target.key}") {`,
      `      id`,
      `      namespace`,
      `      key`,
      `      type`,
      `      value`,
      `    }`,
      `  }`,
      `}`,
      ``,
      `# Variables`,
      `# { "id": "gid://shopify/${pascal(root)}/1234567890" }`,
    ].join("\n");
  }

  const opName = pascal(target.type);
  const lines = [
    `query ${opName}Entries($first: Int!, $after: String) {`,
    `  metaobjects(type: "${target.type}", first: $first, after: $after) {`,
    `    pageInfo { hasNextPage endCursor }`,
    `    nodes {`,
    `      id`,
    `      handle`,
    `      displayName`,
  ];
  for (const f of target.fields) {
    lines.push(`      ${f.key}: field(key: "${f.key}") { value type }`);
  }
  lines.push(`    }`, `  }`, `}`, ``, `# Variables`, `# { "first": 50 }`);
  return lines.join("\n");
}

/** A write mutation for the target. */
export function generateGraphqlMutation(target: SnippetTarget): string {
  if (target.kind === "metafield") {
    const root = QUERY_ROOT[target.ownerType];
    return [
      `mutation Set${pascal(target.key)}($metafields: [MetafieldsSetInput!]!) {`,
      `  metafieldsSet(metafields: $metafields) {`,
      `    metafields { id namespace key type value }`,
      `    userErrors { field message code }`,
      `  }`,
      `}`,
      ``,
      `# Variables — up to 25 metafields per request`,
      `# {`,
      `#   "metafields": [`,
      `#     {`,
      `#       "ownerId": "gid://shopify/${pascal(root)}/1234567890",`,
      `#       "namespace": "${target.namespace}",`,
      `#       "key": "${target.key}",`,
      `#       "type": "${target.type}",`,
      `#       "value": "…"`,
      `#     }`,
      `#   ]`,
      `# }`,
    ].join("\n");
  }

  const fieldsJson = target.fields
    .map((f, i) => `#       { "key": "${f.key}", "value": "…" }${i < target.fields.length - 1 ? "," : ""}`)
    .join("\n");

  return [
    `mutation Upsert${pascal(target.type)}($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {`,
    `  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {`,
    `    metaobject { id handle displayName }`,
    `    userErrors { field message code }`,
    `  }`,
    `}`,
    ``,
    `# Variables`,
    `# {`,
    `#   "handle": { "type": "${target.type}", "handle": "my-entry" },`,
    `#   "metaobject": {`,
    `#     "fields": [`,
    fieldsJson,
    `#     ]`,
    `#   }`,
    `# }`,
  ].join("\n");
}

/** Where to run the generated GraphQL. */
export function graphqlHint(target: SnippetTarget): string {
  return target.kind === "metafield"
    ? "Run against the Admin GraphQL API. Reading customer or order metafields requires the matching read scope."
    : "Run against the Admin GraphQL API with read_metaobjects / write_metaobjects.";
}
