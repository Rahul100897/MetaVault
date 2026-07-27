/**
 * Liquid snippet generation (pure / client-safe).
 *
 * Produces copy-pasteable Liquid for a metafield definition or a metaobject
 * definition, with rendering chosen by the field's Shopify type.
 */

import type { OwnerType } from "./metafields";

/** The Liquid object a metafield hangs off, by owner type. */
export const LIQUID_OBJECT: Record<OwnerType, string> = {
  PRODUCT: "product",
  COLLECTION: "collection",
  CUSTOMER: "customer",
  ORDER: "order",
};

export type MetafieldTarget = {
  kind: "metafield";
  ownerType: OwnerType;
  namespace: string;
  key: string;
  type: string;
  name: string;
};

export type MetaobjectTarget = {
  kind: "metaobject";
  type: string;
  name: string;
  fields: Array<{ key: string; name: string; type: string }>;
};

export type SnippetTarget = MetafieldTarget | MetaobjectTarget;

/** Render one value expression according to its Shopify metafield type. */
function renderValue(expr: string, type: string, indent = "  "): string {
  if (type.startsWith("list.")) {
    const inner = type.slice("list.".length);
    return [
      `${indent}{% for item in ${expr}.value %}`,
      renderValue("item", inner, indent + "  "),
      `${indent}{% endfor %}`,
    ].join("\n");
  }

  switch (type) {
    case "multi_line_text_field":
      return `${indent}{{ ${expr} | newline_to_br }}`;
    case "boolean":
      return [
        `${indent}{% if ${expr} %}`,
        `${indent}  Yes`,
        `${indent}{% else %}`,
        `${indent}  No`,
        `${indent}{% endif %}`,
      ].join("\n");
    case "date":
      return `${indent}{{ ${expr} | date: "%b %d, %Y" }}`;
    case "date_time":
      return `${indent}{{ ${expr} | date: "%b %d, %Y at %I:%M %p" }}`;
    case "url":
      return `${indent}<a href="{{ ${expr} }}" target="_blank" rel="noopener">{{ ${expr} }}</a>`;
    case "file_reference":
    case "image_reference":
      return `${indent}<img src="{{ ${expr} | image_url: width: 800 }}" alt="" loading="lazy">`;
    case "json":
      return `${indent}{{ ${expr} | json }}`;
    case "money":
      return `${indent}{{ ${expr} | money }}`;
    case "rating":
      return `${indent}{{ ${expr}.value.rating }} / {{ ${expr}.value.scale_max }}`;
    case "metaobject_reference":
      return [
        `${indent}{% assign ref = ${expr}.value %}`,
        `${indent}{{ ref.handle }}`,
      ].join("\n");
    case "product_reference":
      return `${indent}<a href="{{ ${expr}.value.url }}">{{ ${expr}.value.title }}</a>`;
    case "collection_reference":
      return `${indent}<a href="{{ ${expr}.value.url }}">{{ ${expr}.value.title }}</a>`;
    case "number_integer":
    case "number_decimal":
    case "single_line_text_field":
    default:
      return `${indent}{{ ${expr} }}`;
  }
}

export function generateSnippet(target: SnippetTarget): string {
  if (target.kind === "metafield") {
    const obj = LIQUID_OBJECT[target.ownerType];
    const path = `${obj}.metafields.${target.namespace}.${target.key}`;
    return [
      `{%- comment -%} ${target.name} — ${target.namespace}.${target.key} (${target.type}) {%- endcomment -%}`,
      `{% assign value = ${path} %}`,
      `{% if value != blank %}`,
      `  <div class="mv-${target.key}">`,
      renderValue("value", target.type, "    "),
      `  </div>`,
      `{% endif %}`,
    ].join("\n");
  }

  // Metaobject: loop every entry of this type.
  const lines: string[] = [
    `{%- comment -%} All "${target.name}" entries ({${""}{ ${target.type} }}) {%- endcomment -%}`,
    `{% for entry in shop.metaobjects.${target.type}.values %}`,
    `  <div class="mv-${target.type}">`,
  ];
  for (const f of target.fields) {
    lines.push(`    {%- comment -%} ${f.name} {%- endcomment -%}`);
    lines.push(renderValue(`entry.${f.key}`, f.type, "    "));
  }
  lines.push(`  </div>`);
  lines.push(`{% endfor %}`);
  return lines.join("\n");
}

/** Short hint on where the snippet belongs. */
export function snippetHint(target: SnippetTarget): string {
  if (target.kind === "metafield") {
    const obj = LIQUID_OBJECT[target.ownerType];
    return `Paste into a template or section where a \`${obj}\` object is in scope (e.g. templates/${obj}.liquid).`;
  }
  return "Paste into any template or section — `shop.metaobjects` is globally available.";
}
