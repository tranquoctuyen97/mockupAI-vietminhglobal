import { createGmailAdapter } from "../src/lib/mailboxes/gmail-client";
import { selectReplyGateCandidate } from "../src/lib/mailboxes/gate-context";
import { sendGmailThreadReply } from "../src/lib/mailboxes/gmail-reply";
import { comment, resolveMailgateIdentity } from "../src/lib/rt/client";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

const REPLY_GATE_REQUIRED_ENV = [
  "GMAIL_TEST_USER",
  "GMAIL_TEST_APP_PASSWORD",
  "RT_URL",
  "RT_API_TOKEN",
] as const;

function replyGatePreflight() {
  const missing = REPLY_GATE_REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  return {
    gate: "C",
    status: missing.length === 0 ? "READY" : "MISSING_ENV",
    missing,
  };
}

async function labelsGate() {
  const credentials = {
    email: required("GMAIL_TEST_USER"),
    appPassword: required("GMAIL_TEST_APP_PASSWORD").replaceAll(" ", ""),
  };
  const adapter = createGmailAdapter(credentials);
  const initialSyncAfter = new Date(Date.now() - 180 * 24 * 60 * 60 * 1_000);
  const baseline = await adapter.scanInbox({ initialSyncAfter, lastCommittedUid: BigInt(0) });
  const target = baseline.messages.find((message) => !message.flags.includes("\\Seen"));
  if (!target) throw new Error("no_unread_inbox_message_for_gate");

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const originalName = `MockupAI/Gate-${suffix}`;
  const renamedName = `MockupAI/Gate-Renamed-${suffix}`;
  const evidence: Array<{ step: string; seen: boolean; hasLabel: boolean }> = [];

  const inspect = async (step: string, expectedLabel?: string) => {
    const scan = await adapter.scanInbox({ initialSyncAfter, lastCommittedUid: BigInt(0) });
    const current = scan.messages.find((message) => message.gmailMessageId === target.gmailMessageId);
    if (!current) throw new Error("gate_message_disappeared_from_inbox");
    const row = {
      step,
      seen: current.flags.includes("\\Seen"),
      hasLabel: expectedLabel ? current.labels.includes(expectedLabel) : false,
    };
    evidence.push(row);
    if (row.seen) throw new Error(`seen_flag_added_at_${step}`);
    return current;
  };

  try {
    await inspect("before");
    await adapter.createLabel(originalName);
    await inspect("create", originalName);
    await adapter.assignLabel([Number(target.uid)], originalName);
    await inspect("assign", originalName);
    await adapter.renameLabel(originalName, renamedName);
    await inspect("rename", renamedName);
    await adapter.unassignLabel([Number(target.uid)], renamedName);
    await inspect("unassign", renamedName);
    await adapter.deleteLabel(renamedName);
    await inspect("delete", renamedName);
    const catalog = await adapter.listVisibleLabels();
    if (catalog.some((label) => label.name === originalName || label.name === renamedName)) {
      throw new Error("disposable_label_still_present");
    }
    return {
      gate: "A",
      status: "PASS",
      gmailMessageId: target.gmailMessageId,
      gmailThreadId: target.gmailThreadId,
      uid: target.uid.toString(),
      evidence,
    };
  } catch (error) {
    try { await adapter.deleteLabel(renamedName); } catch { /* best-effort cleanup */ }
    try { await adapter.deleteLabel(originalName); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

async function replyThreadGate() {
  const credentials = {
    email: required("GMAIL_TEST_USER"),
    appPassword: required("GMAIL_TEST_APP_PASSWORD").replaceAll(" ", ""),
  };
  const adapter = createGmailAdapter(credentials);
  const initialSyncAfter = new Date(Date.now() - 180 * 24 * 60 * 60 * 1_000);
  const inbox = await adapter.scanInbox({ initialSyncAfter, lastCommittedUid: BigInt(0) });
  const remaining = [...inbox.messages];
  const selectCandidate = () =>
    selectReplyGateCandidate(remaining, credentials.email) ?? selectReplyGateCandidate(remaining);
  let candidate = selectCandidate();
  let identity: Awaited<ReturnType<typeof resolveMailgateIdentity>> = null;
  while (candidate) {
    identity = await resolveMailgateIdentity(candidate.latestExternalMessageId);
    if (identity) break;
    const index = remaining.findIndex(
      (message) => message.rfcMessageId === candidate?.latestExternalMessageId,
    );
    if (index >= 0) remaining.splice(index, 1);
    candidate = selectCandidate();
  }
  if (!candidate) throw new Error("no_gmail_inbox_message_with_reply_metadata");
  if (!identity) throw new Error("no_rt_ticket_for_gmail_inbox_message");

  const result = await sendGmailThreadReply({
    credentials,
    to: candidate.to,
    fromName: process.env.GMAIL_GATE_FROM_NAME?.trim() || "MockupAI Support",
    subject: candidate.subject,
    text: process.env.GMAIL_GATE_REPLY_TEXT?.trim() || "Gate C app-owned Gmail reply.",
    gmailThreadId: candidate.gmailThreadId,
    latestExternalMessageId: candidate.latestExternalMessageId,
    references: candidate.references,
    lookupByMessageId: adapter.lookupByMessageId,
  });

  const rtComment = await comment(identity.ticketId, {
    content: `Gmail-Message-ID: ${result.rfcMessageId}\n\nGate C app-owned Gmail reply recorded after Gmail Sent/thread read-back verification.`,
    contentType: "text/plain",
  });
  if (!rtComment.ok) throw new Error(rtComment.error ?? "rt_comment_failed");

  return {
    gate: "C",
    status: "PASS",
    mode: "app-owned-gmail-reply",
    rtTicketId: identity.ticketId,
    rtTransactionId: identity.transactionId,
    rtQueueId: identity.queueId,
    rfcMessageId: result.rfcMessageId,
    gmailMessageId: result.gmailMessageId,
    gmailThreadId: result.gmailThreadId,
    uid: result.uid.toString(),
    uidValidity: result.uidValidity.toString(),
    rtCommentStatus: rtComment.status,
  };
}

async function main() {
  const gate = process.argv[2];
  if (gate === "labels") {
    process.stdout.write(`${JSON.stringify(await labelsGate())}\n`);
    return;
  }
  if (gate === "reply-thread") {
    const preflight = replyGatePreflight();
    if (preflight.missing.length > 0) {
      process.stdout.write(`${JSON.stringify(preflight)}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${JSON.stringify(await replyThreadGate())}\n`);
    return;
  }
  if (gate === "reply-thread-preflight") {
    process.stdout.write(`${JSON.stringify(replyGatePreflight())}\n`);
    return;
  }
  throw new Error("usage: verify-rt-gmail-gates.ts labels|reply-thread|reply-thread-preflight");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "gate_failed"}\n`);
  process.exitCode = 1;
});
