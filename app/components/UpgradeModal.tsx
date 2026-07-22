import { Modal, BlockStack, Text } from "@shopify/polaris";
import { PLAN_DETAILS, type Plan } from "../lib/plans";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Plan to visually highlight (the one being upsold). */
  highlight?: Plan;
  /** Optional reason shown at the top, e.g. "Bulk delete is a Pro feature." */
  reason?: string;
};

export default function UpgradeModal({ open, onClose, highlight = "pro", reason }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upgrade your plan"
      primaryAction={{ content: "Manage plan", url: "/app/billing" }}
      secondaryActions={[{ content: "Not now", onAction: onClose }]}
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="400">
          {reason && (
            <div
              style={{
                background: "#EEF0FF",
                border: "1px solid #C7D2FE",
                borderRadius: "8px",
                padding: "12px 14px",
              }}
            >
              <Text as="p" variant="bodySm" tone="subdued">
                {reason}
              </Text>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
            {PLAN_DETAILS.map((plan) => {
              const active = plan.id === highlight;
              return (
                <div
                  key={plan.id}
                  style={{
                    border: active ? "2px solid #6366F1" : "1px solid #E5E7EB",
                    borderRadius: "12px",
                    padding: "18px 16px",
                    background: active ? "linear-gradient(180deg, #F5F6FF, #FFFFFF)" : "#FFFFFF",
                    position: "relative",
                  }}
                >
                  {active && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-10px",
                        left: "16px",
                        background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
                        color: "#FFFFFF",
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: "0.4px",
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: "10px",
                      }}
                    >
                      Recommended
                    </span>
                  )}
                  <BlockStack gap="200">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingMd" fontWeight="bold">
                        {plan.name}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {plan.tagline}
                      </Text>
                    </BlockStack>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {plan.price}
                    </Text>
                    <BlockStack gap="100">
                      {plan.features.map((f) => (
                        <div key={f} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: "2px" }}>
                            <path d="M20 6L9 17l-5-5" stroke={active ? "#6366F1" : "#10B981"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <Text as="span" variant="bodySm">
                            {f}
                          </Text>
                        </div>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </div>
              );
            })}
          </div>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
