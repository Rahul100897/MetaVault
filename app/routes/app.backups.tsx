import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Card, Text, EmptyState, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function BackupsPage() {
  return (
    <Page
      title="Backups"
      titleMetadata={<Badge tone="attention">Agency</Badge>}
    >
      <Card>
        <EmptyState heading="Backup & Restore" image="">
          <Text as="p" variant="bodyMd" tone="subdued">
            Upgrade to Agency to create full store backups and restore metafields and metaobjects.
          </Text>
        </EmptyState>
      </Card>
    </Page>
  );
}
