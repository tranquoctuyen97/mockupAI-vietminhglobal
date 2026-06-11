/**
 * Shared formatter to convert plain text descriptions into safe HTML paragraph structures
 * without loading heavy HTML sanitization dependencies.
 */
export function formatPlainDescription(description?: string | null): string {
  if (!description) return "";

  const normalizedInput = description.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  // Escape plain text special HTML characters
  const escaped = normalizedInput
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // Split by two or more newlines into paragraphs
  const paragraphs = escaped.split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      const formatted = trimmed.replace(/\n/g, "<br />");
      return `<p>${formatted}</p>`;
    })
    .filter(Boolean)
    .join("");
}
