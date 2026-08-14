/**
 * Support form vocabulary and validation. Pure / client-safe (no DB, no
 * secrets) so the route component and the server action validate against the
 * exact same rules — mirroring the plans.ts / plan.server.ts split.
 */

export type RequestType = "suggestion" | "bug" | "question" | "billing" | "other";
export type Urgency = "low" | "normal" | "blocking";

export type RequestTypeOption = {
  id: RequestType;
  label: string;
  /** Shown under the label in the type picker. */
  helpText: string;
  /** Placeholder that tells the merchant what detail is actually useful. */
  messagePlaceholder: string;
};

export const REQUEST_TYPES: RequestTypeOption[] = [
  {
    id: "suggestion",
    label: "Suggestion or feature request",
    helpText: "Something you wish MetaVault did, or did differently.",
    messagePlaceholder:
      "What would you like to be able to do, and what are you doing today instead?",
  },
  {
    id: "bug",
    label: "Bug report",
    helpText: "Something is broken, wrong, or not doing what it says.",
    messagePlaceholder:
      "What did you do, what did you expect, and what happened instead? Exact steps help most.",
  },
  {
    id: "question",
    label: "How do I use a feature",
    helpText: "You want help getting something done.",
    messagePlaceholder: "What are you trying to achieve, and where did you get stuck?",
  },
  {
    id: "billing",
    label: "Billing or account",
    helpText: "Plans, charges, subscriptions, or your install.",
    messagePlaceholder: "Which charge or plan is this about?",
  },
  {
    id: "other",
    label: "Something else",
    helpText: "Anything that doesn't fit the options above.",
    messagePlaceholder: "Tell us what's on your mind.",
  },
];

export const URGENCIES: Array<{ id: Urgency; label: string }> = [
  { id: "low", label: "Low — a minor annoyance" },
  { id: "normal", label: "Normal — I can work around it" },
  { id: "blocking", label: "Blocking — I can't get my work done" },
];

/**
 * Feature areas, matching the sidebar so a merchant picks the same word they
 * clicked. `value` is stored verbatim; keep these stable.
 */
export const AREAS = [
  "Metafields",
  "Metaobjects",
  "Import / Export",
  "Jobs",
  "Backups & restore",
  "Cross-store copy",
  "Liquid snippets",
  "Orphan cleaner",
  "Activity log",
  "Plans & billing",
  "Something else",
] as const;

export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 5000;
export const MESSAGE_MIN = 20;

/** Submissions allowed per shop per hour, and the window used to spot dupes. */
export const RATE_LIMIT_PER_HOUR = 5;
export const DUPLICATE_WINDOW_MINUTES = 5;

export function isRequestType(value: string): value is RequestType {
  return REQUEST_TYPES.some((t) => t.id === value);
}

export function isUrgency(value: string): value is Urgency {
  return URGENCIES.some((u) => u.id === value);
}

export function requestTypeLabel(type: string): string {
  return REQUEST_TYPES.find((t) => t.id === type)?.label ?? type;
}

export function urgencyLabel(urgency: string): string {
  return URGENCIES.find((u) => u.id === urgency)?.label ?? urgency;
}

/**
 * Good enough to catch typos, deliberately not RFC 5322. An over-strict regex
 * that rejects a real address is worse than a lenient one: the merchant just
 * loses the reply.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export type SupportFormValues = {
  type: string;
  area: string;
  subject: string;
  message: string;
  replyEmail: string;
  urgency: string;
};

/** Per-field errors, keyed by field name. Empty object means valid. */
export type SupportFormErrors = Partial<Record<keyof SupportFormValues, string>>;

/**
 * The single source of validation truth. The form runs it to show inline errors
 * on submit; the action runs it again because a client check is a convenience,
 * never a guarantee.
 */
export function validateSupportForm(values: SupportFormValues): SupportFormErrors {
  const errors: SupportFormErrors = {};

  if (!isRequestType(values.type)) {
    errors.type = "Choose what this is about.";
  }

  const subject = values.subject.trim();
  if (!subject) {
    errors.subject = "Add a short subject.";
  } else if (subject.length > SUBJECT_MAX) {
    errors.subject = `Keep the subject under ${SUBJECT_MAX} characters.`;
  }

  const message = values.message.trim();
  if (!message) {
    errors.message = "Add some details so we can help.";
  } else if (message.length < MESSAGE_MIN) {
    errors.message = `A little more detail, please — at least ${MESSAGE_MIN} characters.`;
  } else if (message.length > MESSAGE_MAX) {
    errors.message = `That's over the ${MESSAGE_MAX.toLocaleString()} character limit.`;
  }

  if (!values.replyEmail.trim()) {
    errors.replyEmail = "We need an email address to reply to.";
  } else if (!isValidEmail(values.replyEmail)) {
    errors.replyEmail = "That doesn't look like an email address.";
  }

  // Urgency only exists for bug reports, and only then must it be a known value.
  if (values.type === "bug" && values.urgency && !isUrgency(values.urgency)) {
    errors.urgency = "Choose how urgent this is.";
  }

  return errors;
}

export function hasErrors(errors: SupportFormErrors): boolean {
  return Object.keys(errors).length > 0;
}
