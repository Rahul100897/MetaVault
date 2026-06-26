import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Card, Text, EmptyState, Badge, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function ImportExportPage() {
  return (
    <Page
      title="Import / Export"
      titleMetadata={<Badge tone="warning">Pro</Badge>}
    >
      <Card>
        <EmptyState heading="CSV Import & Export" image="">
          <InlineStack gap="200" blockAlign="center">
            <Text as="p" variant="bodyMd" tone="subdued">
              Upgrade to Pro to import and export metafields and metaobjects as CSV files.
            </Text>
          </InlineStack>
        </EmptyState>
      </Card>
    </Page>
  );
}
