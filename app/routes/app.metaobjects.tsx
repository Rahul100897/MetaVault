import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Card, Text, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function MetaobjectsPage() {
  return (
    <Page title="Metaobjects">
      <Card>
        <EmptyState heading="Metaobjects editor coming soon" image="">
          <Text as="p" variant="bodyMd" tone="subdued">
            The metaobjects viewer and editor will be built in Phase 2.
          </Text>
        </EmptyState>
      </Card>
    </Page>
  );
}
