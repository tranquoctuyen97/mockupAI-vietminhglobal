export interface GmailCredentials {
  email: string;
  appPassword: string;
}

export interface GmailMessageMetadata {
  uid: bigint;
  uidValidity: bigint;
  gmailMessageId: string;
  gmailThreadId: string;
  rfcMessageId: string | null;
  internalDate: Date;
  subject?: string;
  fromEmail?: string;
  fromName?: string;
  flags: string[];
  labels: string[];
}

export interface GmailLabelDescriptor {
  name: string;
  normalizedName: string;
  type: "USER" | "INBOX" | "IMPORTANT" | "STARRED";
  mutable: boolean;
}

export interface GmailScanResult {
  uidValidity: bigint;
  messages: GmailMessageMetadata[];
}
