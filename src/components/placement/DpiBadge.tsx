"use client";

import { AlertTriangle, CheckCircle, Info } from "lucide-react";
import type { DpiResult } from "@/lib/placement/dpi";

export function DpiBadge({ result }: { result: DpiResult }) {
  const { severity, label } = result;

  let colorClass = "bg-wise-green/10 text-wise-green border-wise-green/20";
  let Icon = CheckCircle;

  if (severity === "error") {
    colorClass = "bg-danger/10 text-danger border-danger/20";
    Icon = AlertTriangle;
  } else if (severity === "warn") {
    colorClass = "bg-warning/10 text-warning border-warning/20";
    Icon = Info;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${colorClass}`}
    >
      <Icon size={14} />
      <span>{label}</span>
    </div>
  );
}
