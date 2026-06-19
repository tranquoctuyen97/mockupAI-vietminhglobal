import {
  isRealPrintifyMockupMedia,
  type PrintifyMediaRef,
} from "./real-printify-media";
import { parseMockupSourceUrl } from "./source-url";

export type TemplateDefaultMockupSource = "PRINTIFY" | "CUSTOM";

export function shouldShowInOfficialGallery(
  image: PrintifyMediaRef,
  defaultMockupSource: TemplateDefaultMockupSource,
): boolean {
  const parsed = parseMockupSourceUrl(image.sourceUrl ?? "");

  if (defaultMockupSource === "CUSTOM") {
    return parsed.kind === "custom" || parsed.kind === "library";
  }

  if (parsed.kind === "custom") {
    return parsed.scope === "draft";
  }

  return isRealPrintifyMockupMedia(image);
}
