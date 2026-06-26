import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Card, Text, BlockStack, Badge, Button, InlineStack, Divider } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function SettingsPage() {
  return (
    <Page title="Settings">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd" fontWeight="semibold">
              Subscription
            </Text>
            <Divider />
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Free Plan
                  </Text>
                  <Badge tone="info">Current</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  50 metafield edits/day · Metaobjects viewer
                </Text>
              </BlockStack>
            </InlineStack>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Pro Plan
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">$15/month</Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Unlimited edits · CSV import/export · Job history
                </Text>
              </BlockStack>
              <Button variant="primary">Upgrade</Button>
            </InlineStack>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Agency Plan
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">$29/month</Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Everything in Pro · Backup/restore · Cross-store copy · Liquid snippets
                </Text>
              </BlockStack>
              <Button variant="secondary">Upgrade</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
