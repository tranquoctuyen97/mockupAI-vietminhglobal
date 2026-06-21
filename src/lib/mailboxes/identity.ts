export interface MailboxIdentityInput {
  customerId: number;
  fromName?: string;
  fromEmail?: string;
}

export interface ParsedEmailIdentity {
  name: string;
  email: string;
}

export function parseEmailIdentity(value?: string | null): ParsedEmailIdentity {
  const raw = value?.trim() ?? "";
  if (!raw) return { name: "", email: "" };

  const angleMatch = raw.match(/^(?:"?([^"<]*)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1]?.trim().replace(/^"|"$/g, "") ?? "";
    const email = angleMatch[2]?.trim() ?? "";
    return { name: name || email, email };
  }

  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) return { name: raw, email: "" };

  const email = emailMatch[0];
  const name = raw
    .replace(email, "")
    .replace(/[<>"']/g, "")
    .trim();

  return { name: name || email, email };
}

export function displayMailboxIdentity(input: MailboxIdentityInput): string {
  return input.fromName || input.fromEmail || `Customer #${input.customerId}`;
}
