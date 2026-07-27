import { useMemo, useState } from "react";
import { Modal, Tabs, Text, BlockStack, InlineStack, Button } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { generateSnippet, snippetHint, type SnippetTarget } from "../lib/liquid";
import {
  generateGraphqlMutation,
  generateGraphqlQuery,
  graphqlHint,
} from "../lib/graphql-snippet";

/**
 * Copy-pasteable code for one metafield or metaobject, opened from the Actions
 * column of the metafields and metaobjects tables (and reusable anywhere else a
 * definition is in hand).
 */

type Props = {
  /** Null closes the modal; the target is what snippets are generated from. */
  target: SnippetTarget | null;
  onClose: () => void;
};

type Token = { text: string; color: string };

const CODE_COLORS = {
  plain: "#E5E7EB",
  comment: "#6B7280",
  tag: "#A5B4FC",
  string: "#86EFAC",
  keyword: "#F0ABFC",
};

/**
 * Deliberately tiny highlighter — enough to make Liquid tags and GraphQL
 * strings scannable without pulling a syntax-highlighting dependency into the
 * bundle for what is a read-only code block.
 */
function highlight(code: string, language: "liquid" | "graphql"): Token[][] {
  const pattern =
    language === "liquid"
      ? /(\{%-?[\s\S]*?-?%\}|\{\{[\s\S]*?\}\})|("[^"]*")/g
      : /(#[^\n]*)|("[^"]*")|\b(query|mutation|fragment)\b/g;

  return code.split("\n").map((line) => {
    const tokens: Token[] = [];
    let lastIndex = 0;
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ text: line.slice(lastIndex, match.index), color: CODE_COLORS.plain });
      }
      const [full, first, second, third] = match;
      let color = CODE_COLORS.plain;
      if (language === "liquid") {
        color = first ? CODE_COLORS.tag : CODE_COLORS.string;
      } else if (first) {
        color = CODE_COLORS.comment;
      } else if (second) {
        color = CODE_COLORS.string;
      } else if (third) {
        color = CODE_COLORS.keyword;
      }
      tokens.push({ text: full, color });
      lastIndex = match.index + full.length;
    }

    if (lastIndex < line.length) {
      tokens.push({ text: line.slice(lastIndex), color: CODE_COLORS.plain });
    }
    return tokens;
  });
}

function CodeBlock({ code, language }: { code: string; language: "liquid" | "graphql" }) {
  const lines = useMemo(() => highlight(code, language), [code, language]);

  return (
    <pre
      style={{
        margin: 0,
        background: "#0A0F1E",
        borderRadius: "10px",
        padding: "16px 18px",
        fontSize: "12.5px",
        lineHeight: 1.65,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        overflowX: "auto",
        maxHeight: "340px",
        overflowY: "auto",
        color: CODE_COLORS.plain,
      }}
    >
      <code>
        {lines.map((tokens, i) => (
          <div key={i}>
            {tokens.length === 0 ? (
              " "
            ) : (
              tokens.map((t, j) => (
                <span key={j} style={{ color: t.color }}>
                  {t.text}
                </span>
              ))
            )}
          </div>
        ))}
      </code>
    </pre>
  );
}

function Snippet({
  title,
  description,
  code,
  language,
  onCopy,
}: {
  title: string;
  description: string;
  code: string;
  language: "liquid" | "graphql";
  onCopy: (code: string, label: string) => void;
}) {
  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="050">
          <Text as="h3" variant="bodyMd" fontWeight="semibold">
            {title}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        </BlockStack>
        <Button size="slim" onClick={() => onCopy(code, title)}>
          Copy
        </Button>
      </InlineStack>
      <CodeBlock code={code} language={language} />
    </BlockStack>
  );
}

export default function SnippetModal({ target, onClose }: Props) {
  const shopify = useAppBridge();
  const [tab, setTab] = useState(0);

  const snippets = useMemo(() => {
    if (!target) return null;
    return {
      liquid: generateSnippet(target),
      liquidHint: snippetHint(target),
      query: generateGraphqlQuery(target),
      mutation: generateGraphqlMutation(target),
      graphqlHint: graphqlHint(target),
    };
  }, [target]);

  const copy = async (code: string, label: string) => {
    try {
      await navigator.clipboard.writeText(code);
      shopify.toast.show(`${label} copied to clipboard`);
    } catch {
      shopify.toast.show("Couldn't copy — select the text and copy manually", {
        isError: true,
      });
    }
  };

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? `Code for ${target.name}` : "Code"}
      size="large"
      secondaryActions={[{ content: "Close", onAction: onClose }]}
    >
      <Tabs
        tabs={[
          { id: "liquid", content: "Liquid", panelID: "liquid-panel" },
          { id: "graphql", content: "GraphQL", panelID: "graphql-panel" },
        ]}
        selected={tab}
        onSelect={setTab}
      >
        <Modal.Section>
          {!snippets || !target ? null : tab === 0 ? (
            <Snippet
              title={target.kind === "metafield" ? "Render this metafield" : "Render every entry"}
              description={snippets.liquidHint}
              code={snippets.liquid}
              language="liquid"
              onCopy={copy}
            />
          ) : (
            <BlockStack gap="500">
              <Snippet
                title="Read"
                description={snippets.graphqlHint}
                code={snippets.query}
                language="graphql"
                onCopy={copy}
              />
              <Snippet
                title="Write"
                description={
                  target.kind === "metafield"
                    ? "metafieldsSet upserts up to 25 metafields per request."
                    : "metaobjectUpsert creates the entry if the handle doesn't exist yet."
                }
                code={snippets.mutation}
                language="graphql"
                onCopy={copy}
              />
            </BlockStack>
          )}
        </Modal.Section>
      </Tabs>
    </Modal>
  );
}
