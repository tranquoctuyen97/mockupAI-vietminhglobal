import { readFileSync } from "node:fs";

describe("mailbox UI source", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

  it("does not render placeholder filter, sort, or assign controls", () => {
    expect(source).not.toContain("<Filter size=");
    expect(source).not.toContain("Sort: Newest");
    expect(source).not.toContain("<UserPlus");
    expect(source).not.toContain("> Assign");
  });

  it("opens internal note mode without pretending it is persisted", () => {
    expect(source).toContain('const [composerMode, setComposerMode] = useState<"reply" | "note">("reply")');
    expect(source).toContain('placeholder={composerMode === "reply" ? "Write your reply..." : "Write an internal note..."}');
    expect(source).toContain("onSaveInternalNote(internalNoteText)");
  });

  it("supports reply attachment upload without rendering unrelated composer tools", () => {
    expect(source).toContain("composerAttachments");
    expect(source).toContain("onUploadAttachment(file)");
    expect(source).toContain('title="Attachments"');
    expect(source).not.toContain('title="Emoji"');
    expect(source).not.toContain('title="Quick actions"');
    expect(source).not.toContain('title="More options"');
  });

  it("renders selected conversations in a Gmail-style reader layout", () => {
    expect(source).toContain("const readingConversation = Boolean(selectedConv)");
    expect(source).toContain("const inboxGridStyle = readingConversation");
    expect(source).toContain("style={inboxGridStyle}");
    expect(source).toContain("const [railCollapsed, setRailCollapsed] = useState(false)");
    expect(source).toContain("collapsed={railCollapsed}");
    expect(source).toContain("onToggleCollapsed={() => setRailCollapsed((value) => !value)}");
    expect(source).toContain("{!selectedConv ? (");
    expect(source).toContain("{selectedConv ? (");
    expect(source).toContain("onBack={() => {");
    expect(source).toContain("setSelectedConv(null)");
    expect(source).toContain("inboxReaderLayout");
    expect(source).toContain("inboxEmptyLayout");
    expect(source).toContain("inboxCollapsedReaderLayout");
    expect(source).toContain("threadAreaReader");
    expect(source).toContain("gmailThreadCard");
    expect(source).toContain("maxWidth: \"min(100%, 1180px)\"");
    expect(source).toContain("const isAdminReply = thread.displayType === \"app_reply\"");
    expect(source).toContain("const isInternalNote = thread.displayType === \"internal\"");
    expect(source).toContain("const internalNoteCount = internalNotes.length");
    expect(source).toContain("const visibleThreads = threads.filter((thread) => !thread.hidden && thread.displayType !== \"internal\")");
    expect(source).toContain("internalNoteBadge");
    expect(source).toContain("const [notesOpen, setNotesOpen] = useState(false)");
    expect(source).toContain("const internalNotes = threads.filter((thread) => !thread.hidden && thread.displayType === \"internal\")");
    expect(source).toContain("onClick={() => setNotesOpen((value) => !value)}");
    expect(source).toContain("internalNotesPanel");
    expect(source).toContain("internalNoteBody");
    expect(source).toContain("Customer email");
    expect(source).toContain("Admin reply");
    expect(source).toContain("Internal only");
    expect(source).toContain('<span style={internalOnlyBadge}>Internal only</span>');
    expect(source).not.toContain("{detailContactEmail}");
    expect(source).not.toContain("<strong>{senderLabel}</strong>");
    expect(source).toContain("const isHtmlThread = isHtmlEmail(thread.contentType, thread.body)");
    expect(source).toContain("const [expandedThreadIds, setExpandedThreadIds] = useState<string[]>([])");
    expect(source).toContain("const latestThread = [...threads].reverse().find((thread) => !thread.hidden && thread.displayType !== \"internal\")");
    expect(source).toContain("expanded={expandedThreadIds.includes(String(thread.id))}");
    expect(source).toContain("function summarizeEmailBody");
    expect(source).toContain("threadSummaryButton");
    expect(source).toContain("htmlThreadCard");
    expect(source).toContain("adminThreadCard");
    expect(source).toContain("internalThreadCard");
    expect(source).toContain('variant="admin"');
    expect(source).toContain('variant="customer"');
    expect(source).toContain('sender.name && sender.name !== sender.email');
    expect(source).toContain("<EmailBodyRenderer");
    expect(source).toContain("compact");
    expect(source).not.toContain("messageMenuButton");
    expect(source).toContain("const displayLabels = rowLabels.filter((label) => label.type === \"USER\" && label.state === \"ACTIVE\")");
    expect(source).toContain("const displayLabelChips = conversationLabels.filter((label) => label.type === \"USER\" && label.state === \"ACTIVE\")");
    expect(source).not.toContain("<span style={neutralBadge}>Email</span>");
    expect(source).toContain("const rowInternalNotes = conversation.internalNotes ?? []");
    expect(source).toContain("<StickyNote size={14} />");
    expect(source).toContain("setNotesOpen((value) => !value)");
    expect(source).toContain("rowNotePopover");
  });

  it("does not show the empty conversation reader on first load", () => {
    expect(source).toContain("{!selectedConv ? (");
    expect(source).toContain("{selectedConv ? (");
    expect(source).toContain(") : null}");
    expect(source).not.toContain("Select a conversation");
  });

  it("renders Gmail-style conversation label menu actions and tree labels", () => {
    expect(source).toContain("openLabelMenu(event.clientX, event.clientY)");
    expect(source).toContain("const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)");
    expect(source).toContain("position: \"fixed\"");
    expect(source).toContain("<span>Actions</span>");
    expect(source).toContain("Mark as unread");
    expect(source).toContain("Report spam");
    expect(source).toContain('window.confirm("Report this email as spam?")');
    expect(source).toContain('window.confirm("Move this email to Trash?")');
    expect(source).toContain('toast.loading("Reporting spam...")');
    expect(source).toContain('toast.loading("Moving to Trash...")');
    expect(source).toContain('toast.loading("Sending reply...")');
    expect(source).toContain('sending ? "Sending..." : "Reply"');
    expect(source).toContain("Skip sender");
    expect(source).toContain("Future emails from");
    expect(source).toContain("Sender skipped");
    expect(source).toContain("conversation.responseMetric");
    expect(source).toContain("responseTimeBadgeDanger");
    expect(source).not.toContain("Monthly summary");
    expect(source).not.toContain("monthlySummaryGrid");
    expect(source).toContain("skipConversationSender");
    expect(source).toContain("`skip:${conv.id}`");
    expect(source).toContain("setConversations((items) => items.filter((item) => item.id !== conv.id))");
    expect(source).toContain("label.type === \"USER\"");
    expect(source).toContain("label.type === \"USER\" && label.mutable && label.state === \"ACTIVE\"");
    expect(source).toContain("const safeLabelIds = targetLabelIds.filter((id) => assignableLabelIds.has(id))");
    expect(source).toContain("labelIds: safeLabelIds");
    expect(source).toContain("setDraftLabelIds(rowLabels.map((label) => label.id).filter((id) => assignableLabelIds.has(id)))");
    expect(source).toContain("!label.name.startsWith(\"[Gmail]\")");
    expect(source).not.toContain("function LabelPickerTreeRow");
    expect(source).not.toContain("const labelTree = buildLabelTree(filteredUserLabels)");
    expect(source).not.toContain("rowMenuButton");
  });

  it("separates bulk checkbox selection from opening a conversation", () => {
    expect(source).toContain("const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([])");
    expect(source).toContain("bulkSelected={bulkSelectedIds.includes(conversation.id)}");
    expect(source).toContain("onToggleBulk={() => toggleBulkConversation(conversation.id)}");
    expect(source).toContain("onClick={(event) => event.stopPropagation()}");
    expect(source).toContain("onChange={onToggleBulk}");
    expect(source).toContain("bulkToolbar");
    expect(source).toContain("selectedConversations.forEach(onReportSpam)");
    expect(source).toContain("selectedConversations.forEach(onDelete)");
    expect(source).toContain("Delete");
    expect(source).toContain("applyBulkLabels");
    expect(source).toContain("[...new Set([...currentUserLabelIds, ...bulkLabelIds])]");
  });

  it("shows Gmail thread message counts on conversation rows", () => {
    expect(source).toContain("const messageCount = conversation.articleCount");
    expect(source).toContain("messageCount > 1");
    expect(source).toContain("<Mail size={13} />");
    expect(source).toContain("{messageCount}");
  });

  it("uses the shared calendar-style date picker only for custom metrics ranges", () => {
    expect(source).toContain("function DatePickerField");
    expect(source).toContain("buildCalendarDays");
    expect(source).toContain('{preset === "custom" ? (');
    expect(source).toContain("DatePickerField value={from}");
    expect(source).toContain("DatePickerField value={to}");
    expect(source).not.toContain('type="date"');
  });
});
