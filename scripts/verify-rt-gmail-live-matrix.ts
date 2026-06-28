import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type MatrixKind = "acceptance" | "resilience";

interface MatrixCase {
  id: string;
  kind: MatrixKind;
  title: string;
  evidenceRequired: string[];
  notes: string;
}

export const LIVE_MATRIX_REQUIRED_ENV = [
  "GMAIL_TEST_USER",
  "GMAIL_TEST_APP_PASSWORD",
  "RT_URL",
  "RT_API_TOKEN",
] as const;

const OPTIONAL_MULTI_MAILBOX_ENV = [
  "GMAIL_TEST_USER_B",
  "GMAIL_TEST_APP_PASSWORD_B",
] as const;

export const LIVE_MATRIX_TEMPLATE_PATH = "docs/reports/2026-06-24-rt-gmail-live-matrix.md";
const ACCEPTANCE_MATRIX_HEADING = "## Acceptance matrix";
const RESILIENCE_MATRIX_HEADING = "## Resilience matrix";

export const ACCEPTANCE_MATRIX: MatrixCase[] = [
  {
    id: "age-window",
    kind: "acceptance",
    title: "Initial import respects the configured Inbox bootstrap window",
    evidenceRequired: [
      "one five-month-old Inbox message imported",
      "one seven-month-old Inbox message excluded",
      "cursor advances only after verified RT linkage",
    ],
    notes: "Requires disposable Inbox seed messages around the initialSyncAfter boundary.",
  },
  {
    id: "excluded-mailboxes",
    kind: "acceptance",
    title: "Spam, Trash, Sent, and unrelated All Mail are never ingested",
    evidenceRequired: [
      "Spam seed not linked to RT",
      "Trash seed not linked to RT",
      "Sent seed not linked to RT",
      "All Mail archived-only seed not linked to RT",
    ],
    notes: "Normal ingestion must lock/scan INBOX only.",
  },
  {
    id: "unread-preserved",
    kind: "acceptance",
    title: "Gmail Unread is preserved across import, retry, labels, and waiting",
    evidenceRequired: [
      "baseline message starts unread",
      "message remains unread after import",
      "message remains unread after retry",
      "message remains unread after label mutations",
      "message remains unread after five minutes",
    ],
    notes: "Use IMAP metadata/flags readback only; never fetch message source as a side effect.",
  },
  {
    id: "duplicate-poll",
    kind: "acceptance",
    title: "Repeated or overlapping poll creates no duplicate ticket",
    evidenceRequired: [
      "two overlapping sync attempts observed",
      "one RT ticket for the Gmail message",
      "one Gmail message link for the Gmail message",
    ],
    notes: "Exercises DB lease plus verified-link cursor advancement.",
  },
  {
    id: "label-crud",
    kind: "acceptance",
    title: "Create, rename, delete, assign, and unassign Gmail labels from the app",
    evidenceRequired: [
      "create readback",
      "assign readback",
      "rename readback",
      "unassign readback",
      "delete readback",
      "Unread flag remains false for Seen throughout",
    ],
    notes: "Equivalent to Gate A plus app operation outbox state verification.",
  },
  {
    id: "cross-mailbox-isolation",
    kind: "acceptance",
    title: "Mailbox A labels never appear under mailbox B",
    evidenceRequired: [
      "mailbox A user label visible only under mailbox A",
      "mailbox B catalog excludes mailbox A label",
      "label filter resolves only against selected app mailbox ID",
    ],
    notes: "Second disposable mailbox is preferred; source guard can prove route scoping but live run should use two accounts when available.",
  },
  {
    id: "reply-inheritance",
    kind: "acceptance",
    title: "Conversation labels propagate to a new customer reply",
    evidenceRequired: [
      "conversation has confirmed label before customer reply",
      "new inbound Gmail message shares Gmail thread ID",
      "new inbound UID receives inherited label operation",
      "RT custom field reflects final labels",
    ],
    notes: "Customer reply must land in INBOX and keep the same Gmail thread.",
  },
  {
    id: "closed-ticket-label-mutation",
    kind: "acceptance",
    title: "Closed/archived imported ticket remains readable and label-mutable",
    evidenceRequired: [
      "ticket status changed to app closed / RT resolved",
      "detail endpoint still reads the conversation",
      "label assignment succeeds after close",
      "RT custom field mirrors label after close",
    ],
    notes: "Confirms the app can manage Gmail labels without reopening the ticket.",
  },
  {
    id: "gmail-sent-thread-reply",
    kind: "acceptance",
    title: "App reply appears in Gmail Sent with the same Gmail thread ID",
    evidenceRequired: [
      "generated RFC Message-ID found by Gmail readback",
      "readback message has Gmail Sent semantics",
      "readback Gmail thread ID equals inbound thread ID",
      "RT receives internal comment after Gmail verification",
    ],
    notes: "Equivalent to revised Gate C using email/App Password plus RT URL/token only.",
  },
  {
    id: "body-attachment-readable",
    kind: "acceptance",
    title: "Sender, body, HTML, plain text, and attachments remain readable",
    evidenceRequired: [
      "sender normalized",
      "plain text body rendered",
      "HTML body sanitized and rendered",
      "attachment metadata returned",
      "body-part attachments are not shown as downloadable files",
    ],
    notes: "Requires a disposable message with plain/html alternatives and a real attachment.",
  },
];

export const RESILIENCE_MATRIX: MatrixCase[] = [
  {
    id: "rt-down",
    kind: "resilience",
    title: "RT down",
    evidenceRequired: ["sync reports retryable RT/network failure", "no false success", "recovery succeeds after RT restoration"],
    notes: "Stop or firewall disposable RT only.",
  },
  {
    id: "gmail-imap-down",
    kind: "resilience",
    title: "Gmail IMAP down",
    evidenceRequired: ["IMAP failure recorded with safe code", "mailbox not falsely advanced", "recovery succeeds"],
    notes: "Use invalid host/network override in disposable runner, not a production account.",
  },
  {
    id: "gmail-smtp-down",
    kind: "resilience",
    title: "Gmail SMTP down",
    evidenceRequired: ["reply send fails before RT comment", "no Gmail Message-ID comment recorded", "retry succeeds after restoration"],
    notes: "App-owned Gmail reply must not create RT correspondence before Gmail verification.",
  },
  {
    id: "revoked-app-password",
    kind: "resilience",
    title: "Revoked App Password",
    evidenceRequired: ["safe degraded state", "no credential leakage", "rotation restores provisioning/sync"],
    notes: "Use disposable Gmail App Password only.",
  },
  {
    id: "worker-kill-before-gmail-mutation",
    kind: "resilience",
    title: "Worker killed before Gmail label mutation",
    evidenceRequired: ["operation remains retryable", "Gmail label not partially applied", "retry succeeds once"],
    notes: "Exercises label outbox before side effects.",
  },
  {
    id: "worker-kill-after-gmail-mutation",
    kind: "resilience",
    title: "Worker killed after Gmail label mutation",
    evidenceRequired: ["operation retry is idempotent", "Gmail readback converges", "DB/RT final state has one label set"],
    notes: "Exercises readback plus idempotency key behavior.",
  },
  {
    id: "mailgate-wrapper-kill-after-rt-accept",
    kind: "resilience",
    title: "Mailgate wrapper killed after RT accept",
    evidenceRequired: ["RT identity can be reconciled", "retry creates no duplicate ticket", "cursor advances after verified linkage"],
    notes: "Use disposable wrapper fault injection.",
  },
  {
    id: "duplicate-scheduler",
    kind: "resilience",
    title: "Duplicate scheduler",
    evidenceRequired: ["two dispatchers observed", "DB lease allows one active sync", "no duplicate ticket/link"],
    notes: "Exercises multi-worker deployment safety.",
  },
  {
    id: "concurrent-label-and-sync",
    kind: "resilience",
    title: "Concurrent label operation and mailbox sync",
    evidenceRequired: ["pending label protected from catalog overwrite", "conversation final labels correct", "RT custom field correct"],
    notes: "Exercises in-flight CRUD protection during label catalog refresh.",
  },
  {
    id: "uidvalidity-mismatch",
    kind: "resilience",
    title: "UIDVALIDITY mismatch",
    evidenceRequired: ["cursor reset to zero", "bounded Inbox rescan", "no duplicate linked ticket"],
    notes: "Can be simulated in unit tests; live mailbox run should record observed handling if Gmail changes UIDVALIDITY.",
  },
  {
    id: "high-fanout-label-rename-delete",
    kind: "resilience",
    title: "High-fanout label rename/delete",
    evidenceRequired: ["many conversations updated", "operation does not leak credentials", "failed item state is retryable/dead-lettered safely"],
    notes: "Use disposable data volume; record timing and final catalog state.",
  },
];

function redact(name: string, value: string | undefined) {
  if (!value) return { name, present: false };
  return { name, present: true, preview: `${value.slice(0, 2)}…${value.slice(-2)}` };
}

function preflight() {
  const missing = LIVE_MATRIX_REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  const optionalMissing = OPTIONAL_MULTI_MAILBOX_ENV.filter((name) => !process.env[name]?.trim());
  return {
    status: missing.length === 0 ? "READY" : "MISSING_ENV",
    required: LIVE_MATRIX_REQUIRED_ENV.map((name) => redact(name, process.env[name])),
    optional: OPTIONAL_MULTI_MAILBOX_ENV.map((name) => redact(name, process.env[name])),
    missing,
    optionalMissing,
    matrix: {
      acceptance: ACCEPTANCE_MATRIX.map(({ id, title }) => ({ id, title })),
      resilience: RESILIENCE_MATRIX.map(({ id, title }) => ({ id, title })),
    },
    notes: [
      "Run only against disposable Gmail and disposable RT.",
      "The output intentionally redacts env values and never prints App Passwords or RT tokens.",
      optionalMissing.length
        ? "Cross-mailbox live proof is stronger when GMAIL_TEST_USER_B/GMAIL_TEST_APP_PASSWORD_B are provided."
        : "Two-mailbox live proof inputs are present.",
    ],
  };
}

function checklist() {
  return {
    status: "CHECKLIST",
    acceptance: ACCEPTANCE_MATRIX,
    resilience: RESILIENCE_MATRIX,
  };
}

function sanitizeEvidence(text: string): string {
  return text
    .replace(/(GMAIL_TEST_APP_PASSWORD|RT_API_TOKEN|RT_ROOT_PASSWORD)=\S+/g, "$1=[REDACTED]")
    .replace(/(Authorization:\s*token\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(pass(word)?\s*[:=]\s*)[^\s]+/gi, "$1[REDACTED]");
}

function matrixSection(heading: string, cases: MatrixCase[]): string {
  const sections = cases.map((item) => [
    `### ${item.id} — ${item.title}`,
    "",
    `Status: PENDING`,
    "",
    "Evidence required:",
    ...item.evidenceRequired.map((evidence) => `- [ ] ${evidence}`),
    "",
    `Notes: ${item.notes}`,
    "",
    "Sanitized evidence:",
    "",
    "```text",
    "TODO: paste sanitized command output, IDs, and timestamps here.",
    "```",
  ].join("\n"));
  return [heading, "", ...sections].join("\n\n");
}

function templateMarkdown(): string {
  return sanitizeEvidence(`# RT + Gmail disposable live matrix

Generated: TODO live run timestamp, for example 2026-06-25T10:00:00.000Z

This file is a credential-safe template for Task 16's full disposable Gmail/RT acceptance and resilience matrix.

Do not paste Gmail App Passwords, RT API tokens, RT root passwords, raw email bodies, SMTP transcripts, or production mailbox addresses into this file.

Allowed evidence:

- sanitized Gmail message IDs, Gmail thread IDs, IMAP UIDs, RT ticket IDs, RT transaction IDs, queue IDs, timestamps, and PASS/FAIL summaries;
- command names and redacted preflight output;
- short paraphrased body/attachment observations without raw customer content.

Recommended commands:

\`\`\`bash
npm run mailbox:matrix:preflight
npm run mailbox:matrix:checklist
tsx scripts/verify-rt-gmail-gates.ts labels
tsx scripts/verify-rt-gmail-gates.ts reply-thread
\`\`\`

${matrixSection(ACCEPTANCE_MATRIX_HEADING, ACCEPTANCE_MATRIX)}

${matrixSection(RESILIENCE_MATRIX_HEADING, RESILIENCE_MATRIX)}
`);
}

function writeTemplate(outputPath = LIVE_MATRIX_TEMPLATE_PATH) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const body = templateMarkdown();
  writeFileSync(outputPath, body, { encoding: "utf8", flag: "w" });
  return { status: "TEMPLATE_WRITTEN", path: outputPath };
}

function usage() {
  return {
    usage: "tsx scripts/verify-rt-gmail-live-matrix.ts preflight|checklist|template|run",
    safeFirstStep: "tsx scripts/verify-rt-gmail-live-matrix.ts preflight",
  };
}

async function main() {
  const command = process.argv[2] ?? "preflight";
  if (command === "preflight") {
    process.stdout.write(`${JSON.stringify(preflight(), null, 2)}\n`);
    return;
  }
  if (command === "checklist") {
    process.stdout.write(`${JSON.stringify(checklist(), null, 2)}\n`);
    return;
  }
  if (command === "template") {
    process.stdout.write(`${JSON.stringify(writeTemplate(), null, 2)}\n`);
    return;
  }
  if (command === "run") {
    const ready = preflight();
    if (ready.status !== "READY") {
      process.stdout.write(`${JSON.stringify(ready, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${JSON.stringify({
      status: "MANUAL_LAB_REQUIRED",
      reason: "The full matrix includes destructive dependency-failure and worker-kill scenarios. Use the checklist output to drive a disposable Gmail/RT lab run and record sanitized evidence in docs/reports/2026-06-24-rt-getmail-mailbox-verification.md.",
      next: "Run Gates A/B/C/D first, then execute each listed acceptance/resilience case against disposable infrastructure.",
      cases: {
        acceptance: ACCEPTANCE_MATRIX.map((item) => item.id),
        resilience: RESILIENCE_MATRIX.map((item) => item.id),
      },
    }, null, 2)}\n`);
    process.exitCode = 3;
    return;
  }
  process.stdout.write(`${JSON.stringify(usage(), null, 2)}\n`);
  process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "live_matrix_failed"}\n`);
  process.exitCode = 1;
});
