import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Card, Text, BlockStack, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function MetafieldsPage() {
  return (
    <Page title="Metafields">
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <EmptyState
            heading="Metafields editor coming soon"
            image=""
          >
            <Text as="p" variant="bodyMd" tone="subdued">
              The bulk metafields spreadsheet editor will be built in Phase 2.
            </Text>
          </EmptyState>
        </BlockStack>
      </Card>
    </Page>
  );
}
