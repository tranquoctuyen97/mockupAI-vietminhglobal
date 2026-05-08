import { notFound } from "next/navigation";
import { isInternalControlsDebugEnabled, getAppLocale } from "@/lib/config/runtime-controls";
import { getCopy } from "@/lib/i18n/copy";
import InternalFlagsClient from "./InternalFlagsClient";

export default function InternalFlagsPage() {
  if (!isInternalControlsDebugEnabled()) {
    notFound();
  }

  const text = getCopy(getAppLocale()).controls;
  return <InternalFlagsClient text={text} />;
}
