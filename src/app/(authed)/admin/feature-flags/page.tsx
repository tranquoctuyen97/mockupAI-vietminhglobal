import { notFound, redirect } from "next/navigation";
import { isInternalControlsDebugEnabled } from "@/lib/config/runtime-controls";

export default function LegacyFeatureFlagsPage() {
  if (isInternalControlsDebugEnabled()) {
    redirect("/admin/internal/flags");
  }

  notFound();
}
