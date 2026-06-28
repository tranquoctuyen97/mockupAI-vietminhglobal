# RT + Gmail production gates

Date: 2026-06-25 (Asia/Ho_Chi_Minh)

This report is intentionally credential-safe. It contains no Gmail App Password, RT root password, RT API token, SMTP transcript, raw message body, or mailbox address.

## Version and environment evidence

| Component | Evidence | Result |
|---|---|---|
| Request Tracker | Pinned image `firefart/requesttracker@sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8`; lab returned RT `6.0.3` | PASS |
| getmail6 | Worker image `mockupai-mailbox-worker:rt6.0.3`; `getmail --version` returned `6.20.00` | PASS |
| rt-mailgate runtime | `rt-mailgate --help` rendered after installing required Perl runtime dependencies | PASS |
| Disposable RT lab | RT on `127.0.0.1:18082`; RT and PostgreSQL containers healthy during the gates | PASS |
| Gmail test account | Disposable Gmail App Password account loaded from local secret file; account value not recorded here | PASS |

## Gate results

### Gate A — Gmail label create/assign/rename/unassign/delete

Status: **PASS**

Evidence:

| Step | `\Seen` present? | Expected label present? |
|---|---:|---:|
| before | no | no |
| create | no | no |
| assign | no | yes |
| rename | no | yes |
| unassign | no | no |
| delete | no | no |

Sanitized IDs:

- Gmail message ID: `1868846369917845320`
- Gmail thread ID: `1868846369917845320`
- UID: `151`

The disposable user label was removed after the gate.

### Gate B — verified mailgate identity and duplicate retry

Status: **PASS**

Input Message-ID:

```text
<mockupai-gate-b2-1782343525800@example.test>
```

Evidence:

- first wrapper run exited `0`;
- retry wrapper run exited `0`;
- stdout/stderr were empty for both wrapper runs;
- REST2 attachment lookup by exact Message-ID returned exactly one attachment;
- attachment ID: `9`;
- RT transaction ID: `62`;
- RT ticket ID persisted in app DB: `3`;
- app `GmailMessageLink` row persisted `rtTicketId=3`, `rtTransactionId=62`, and a `MailboxConversation` mapping;
- retry did not create a second RT attachment or second app mapping for the same Message-ID.

### Gate C — Gmail SMTP Sent and conversation threading

Status: **PASS AFTER REVISED APP-OWNED GMAIL REPLY RERUN**

Gate C was first run against the disposable Gmail account and RT lab using the earlier design where RT emitted the agent reply through `/REST/2.0/ticket/:id/correspond`. RT did create tickets and sent outbound mail through the configured Gmail SMTP/msmtp path, but Gmail did not keep RT replies in the same Gmail thread as the inbound customer message.

Failing ticket evidence:

- inbound Message-ID: `<mockupai-gate-c-1782345601123@example.test>`;
- inbound Gmail thread ID: `1868924823890955331`;
- RT ticket ID: `6`;
- inbound RT transaction ID: `91`;
- RT correspond transaction ID: `93`;
- RT EmailRecord transaction ID: `94`;
- RT log showed the correspond email was sent;
- Gmail All Mail contained RT outbound messages for the ticket, but they were in new Gmail thread IDs, not `1868924823890955331`.

Observed Gmail threading evidence:

| Message | Message-ID | Gmail thread ID | Relevant headers |
|---|---|---|---|
| inbound customer message | `<mockupai-gate-c-1782345601123@example.test>` | `1868924823890955331` | original subject |
| RT autoreply | `<rt-6.0.3-1-1782345611-1815.6-7-0@mockupai-gate.local>` | `1868924833958382856` | `In-Reply-To` pointed at the inbound Message-ID, but subject was rewritten with RT autoreply prefix |
| RT agent reply | `<rt-6.0.3-1-1782345635-1771.6-5-0@mockupai-gate.local>` | `1868924861020763728` | no inbound `In-Reply-To`; `References` contained only RT pseudo-reference |

Root cause:

RT's REST2 `ticket/:id/correspond` path builds an internal correspondence message. RT 6.0.3 then emits outbound headers based on its internal RT pseudo-reference rather than the original Gmail Message-ID. Gmail receives the RT outbound mail, but because the outbound subject/header chain no longer matches the original Gmail thread strongly enough, Gmail splits it into separate conversation threads.

Earlier self-send attempt also exposed a second lab-specific issue: when the customer address equals the queue correspondence address, RT skips outgoing mail because it detects the recipient as pointing back to this RT instance. The plus-address retry avoided that skip and proved the remaining failure is the threading headers, not delivery.

Design revision accepted on 2026-06-25:

- App sends agent replies directly through the selected Gmail SMTP account, not through RT correspondence.
- The app generates the outbound RFC Message-ID, sets `In-Reply-To` to the latest customer Gmail Message-ID, and sets `References` to the known Gmail reference chain.
- Gmail Sent is read back by exact generated Message-ID and must be in the same Gmail thread as the inbound customer message.
- Only after Gmail accepts and read-back verifies the reply, the app records the already-sent reply in RT as an internal comment with a safe `Gmail-Message-ID: <generated-id>` metadata line.
- RT must not send a duplicate outbound email for the app reply.

The failed evidence above is retained as the reason the architecture changed. The implementation has since been updated to the revised app-owned Gmail reply path.

Rerun evidence on 2026-06-25:

- Gate C verifier discovered the Gmail Inbox candidate automatically from email + App Password.
- It resolved the matching RT ticket/transaction/queue by exact RFC Message-ID.
- The app sent the agent reply through Gmail SMTP.
- Gmail Sent read-back found the generated RFC Message-ID.
- Gmail thread ID matched the inbound thread ID.
- RT recorded the already-sent Gmail reply as an internal comment.
- RT did not create a `Correspond` transaction for the app reply.

Sanitized result:

```json
{
  "gate": "C",
  "status": "PASS",
  "mode": "app-owned-gmail-reply",
  "rtTicketId": 2,
  "rtTransactionId": 48,
  "rtQueueId": 1,
  "gmailThreadId": "1868962415021337219",
  "rtCommentStatus": 201
}
```

RT ticket history after the app reply contained one inbound `Create` transaction and one app-reply `Comment` containing the safe `Gmail-Message-ID` metadata line. A lab-only `SystemError` was also present because the disposable RT image had no msmtp account configured for RT autoreply delivery; it was not created by the app-owned reply path and no RT `Correspond` transaction was created for the app reply.

### Gate D — permission denial must fail delivery

Status: **PASS**

Input Message-ID:

```text
<mockupai-gate-d-1782345128614@example.test>
```

Denied-path evidence:

- `CreateTicket` was revoked from the disposable queue;
- wrapper exited `75`;
- stdout/stderr were empty;
- REST2 attachment lookup by exact Message-ID returned zero items;
- app `GmailMessageLink` still had `rtTicketId=null`, `rtTransactionId=null`, and `conversationId=null`.

Restored-path evidence:

- `CreateTicket` was restored;
- the same input wrapper run exited `0`;
- REST2 attachment lookup by exact Message-ID returned exactly one attachment;
- attachment ID: `13`;
- RT transaction ID: `73`;
- RT ticket ID persisted in app DB: `4`;
- app `GmailMessageLink` row persisted `rtTicketId=4`, `rtTransactionId=73`, and a `MailboxConversation` mapping.

## Checkpoint decision

The mandatory live checkpoint is **passed** for Gates A, B, C, and D.

Implementation work has proceeded on the revised design with source/build/unit verification. Final deployment readiness still requires the remaining full disposable Gmail acceptance/resilience matrix.

The current evidence already proved this is a design issue, not a small wrapper bug: app replies that must behave like Gmail replies need outbound `In-Reply-To` / `References` to include the original Gmail thread message chain. RT REST2 correspondence alone does not currently preserve that chain in a way Gmail accepts for same-thread grouping.

No production mailbox or production RT instance was used.
