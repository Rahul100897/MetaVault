/**
 * Metaobject GraphQL operations (Shopify Admin API).
 * Client-safe types/helpers live in ./metaobjects.ts.
 */
import { graphqlRequest, type AdminClient } from "./graphql.server";
import type {
  MetaobjectDefinitionSummary,
  MetaobjectEntry,
  MetaobjectFieldValue,
  MetaobjectPage,
} from "./metaobjects";

export type { AdminClient };

// --- Definitions -----------------------------------------------------------

type RawDefinition = {
  id: string;
  type: string;
  name: string;
  displayNameKey: string | null;
  capabilities: { publishable: { enabled: boolean } };
  fieldDefinitions: Array<{ key: string; name: string; required: boolean; type: { name: string } }>;
  metaobjectsCount: number;
};

export async function listDefinitions(admin: AdminClient): Promise<MetaobjectDefinitionSummary[]> {
  const query = `#graphql
    query MetaobjectDefinitions {
      metaobjectDefinitions(first: 100) {
        nodes {
          id
          type
          name
          displayNameKey
          metaobjectsCount
          capabilities { publishable { enabled } }
          fieldDefinitions { key name required type { name } }
        }
      }
    }`;
  const data = await graphqlRequest<{ metaobjectDefinitions: { nodes: RawDefinition[] } }>(
    admin,
    query,
  );
  return data.metaobjectDefinitions.nodes.map((d) => ({
    id: d.id,
    type: d.type,
    name: d.name,
    displayNameKey: d.displayNameKey,
    publishable: d.capabilities.publishable.enabled,
    entryCount: d.metaobjectsCount,
    fieldDefinitions: d.fieldDefinitions.map((f) => ({
      key: f.key,
      name: f.name,
      type: f.type.name,
      required: f.required,
    })),
  }));
}

/** Full definition object (for the schema-as-JSON export). */
export async function getDefinitionByType(
  admin: AdminClient,
  type: string,
): Promise<unknown> {
  const query = `#graphql
    query MetaobjectDefinitionByType($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        id
        type
        name
        description
        displayNameKey
        capabilities {
          publishable { enabled }
          translatable { enabled }
        }
        access { admin storefront }
        fieldDefinitions {
          key
          name
          description
          required
          type { name category }
          validations { name value }
        }
      }
    }`;
  const data = await graphqlRequest<{ metaobjectDefinitionByType: unknown }>(admin, query, { type });
  return data.metaobjectDefinitionByType;
}

// --- Entries ---------------------------------------------------------------

type RawField = {
  key: string;
  value: string | null;
  type: string;
  reference: null | {
    __typename: string;
    handle?: string;
    displayName?: string;
    url?: string;
    image?: { url: string } | null;
    alt?: string | null;
  };
};

type RawEntry = {
  id: string;
  handle: string;
  displayName: string;
  updatedAt: string;
  capabilities?: { publishable?: { status: string } | null } | null;
  fields: RawField[];
};

function mapField(f: RawField): MetaobjectFieldValue {
  const out: MetaobjectFieldValue = { key: f.key, value: f.value ?? "", type: f.type };
  const ref = f.reference;
  if (ref) {
    if (ref.__typename === "Metaobject") {
      out.refDisplay = ref.displayName ?? null;
      out.refHandle = ref.handle ?? null;
    } else if (ref.__typename === "MediaImage") {
      out.fileUrl = ref.image?.url ?? null;
      out.thumbnailUrl = ref.image?.url ?? null;
      out.fileName = ref.alt ?? null;
    } else if (ref.__typename === "GenericFile") {
      out.fileUrl = ref.url ?? null;
      out.fileName = ref.url ? ref.url.split("/").pop() ?? null : null;
    }
  }
  return out;
}

export async function listEntries(
  admin: AdminClient,
  { type, first = 50, after = null }: { type: string; first?: number; after?: string | null },
): Promise<MetaobjectPage> {
  const query = `#graphql
    query MetaobjectEntries($type: String!, $first: Int!, $after: String) {
      metaobjects(type: $type, first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          displayName
          updatedAt
          capabilities { publishable { status } }
          fields {
            key
            value
            type
            reference {
              __typename
              ... on Metaobject { handle displayName }
              ... on MediaImage { image { url } alt }
              ... on GenericFile { url }
            }
          }
        }
      }
    }`;
  const data = await graphqlRequest<{
    metaobjects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawEntry[] };
  }>(admin, query, { type, first, after });

  const entries: MetaobjectEntry[] = data.metaobjects.nodes.map((n) => {
    const fields: Record<string, MetaobjectFieldValue> = {};
    for (const f of n.fields) fields[f.key] = mapField(f);
    return {
      id: n.id,
      handle: n.handle,
      displayName: n.displayName,
      status: n.capabilities?.publishable?.status ?? null,
      updatedAt: n.updatedAt,
      fields,
    };
  });

  return {
    entries,
    hasNextPage: data.metaobjects.pageInfo.hasNextPage,
    endCursor: data.metaobjects.pageInfo.endCursor,
  };
}

// --- Mutations -------------------------------------------------------------

export type FieldInput = { key: string; value: string };
export type UserError = { field: string[] | null; message: string; code?: string };

export type MutationResult = {
  entry: { id: string; handle: string } | null;
  userErrors: UserError[];
};

export async function createEntry(
  admin: AdminClient,
  {
    type,
    handle,
    fields,
    status,
  }: { type: string; handle?: string; fields: FieldInput[]; status?: "ACTIVE" | "DRAFT" },
): Promise<MutationResult> {
  const mutation = `#graphql
    mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message code }
      }
    }`;
  const metaobject: Record<string, unknown> = { type, fields };
  if (handle) metaobject.handle = handle;
  if (status) metaobject.capabilities = { publishable: { status } };

  const data = await graphqlRequest<{
    metaobjectCreate: { metaobject: { id: string; handle: string } | null; userErrors: UserError[] };
  }>(admin, mutation, { metaobject });
  return { entry: data.metaobjectCreate.metaobject, userErrors: data.metaobjectCreate.userErrors };
}

export async function updateEntry(
  admin: AdminClient,
  {
    id,
    handle,
    fields,
    status,
  }: { id: string; handle?: string; fields?: FieldInput[]; status?: "ACTIVE" | "DRAFT" },
): Promise<MutationResult> {
  const mutation = `#graphql
    mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message code }
      }
    }`;
  const metaobject: Record<string, unknown> = {};
  if (handle !== undefined) metaobject.handle = handle;
  if (fields) metaobject.fields = fields;
  if (status) metaobject.capabilities = { publishable: { status } };

  const data = await graphqlRequest<{
    metaobjectUpdate: { metaobject: { id: string; handle: string } | null; userErrors: UserError[] };
  }>(admin, mutation, { id, metaobject });
  return { entry: data.metaobjectUpdate.metaobject, userErrors: data.metaobjectUpdate.userErrors };
}

export async function deleteEntry(
  admin: AdminClient,
  id: string,
): Promise<{ deletedId: string | null; userErrors: UserError[] }> {
  const mutation = `#graphql
    mutation MetaobjectDelete($id: ID!) {
      metaobjectDelete(id: $id) {
        deletedId
        userErrors { field message code }
      }
    }`;
  const data = await graphqlRequest<{
    metaobjectDelete: { deletedId: string | null; userErrors: UserError[] };
  }>(admin, mutation, { id });
  return data.metaobjectDelete;
}
