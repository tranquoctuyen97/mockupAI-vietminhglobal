"use client";

import { AlertTriangle, AlertCircle, ChevronRight } from "lucide-react";
import type { BoundaryViolation } from "@/lib/placement/validate";

interface ValidationBannerProps {
  violations: BoundaryViolation[];
  onJumpTo?: (variantId: string, view: string) => void;
}

const ISSUE_MESSAGES: Record<string, string> = {
  outside_print_area: "Vượt ngoài vùng in",
  outside_safe_zone: "Gần mép an toàn",
  dpi_too_low: "Độ phân giải thấp",
  size_too_small: "Kích thước quá nhỏ",
};

const VIEW_LABELS: Record<string, string> = {
  front: "Mặt trước",
  back: "Mặt sau",
  sleeve_left: "Tay trái",
  sleeve_right: "Tay phải",
  neck_label: "Nhãn cổ",
  hem: "Gấu áo",
};

export function ValidationBanner({ violations, onJumpTo }: ValidationBannerProps) {
  if (violations.length === 0) return null;

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warn");

  return (
    <div className="flex flex-col gap-1.5 mb-3">
      {errors.map((v, i) => (
        <div
          key={`err-${i}`}
          className="flex items-center gap-2 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-xs"
        >
          <AlertCircle size={14} className="shrink-0" />
          <span className="flex-1">
            <strong>{v.variantId}</strong> · {VIEW_LABELS[v.view] ?? v.view}:{" "}
            {ISSUE_MESSAGES[v.issue] ?? v.issue}
            {v.issue === "dpi_too_low" && v.detail.dpi && ` (${v.detail.dpi} DPI)`}
          </span>
          {onJumpTo && (
            <button
              onClick={() => onJumpTo(v.variantId, v.view)}
              className="flex items-center gap-0.5 underline shrink-0"
            >
              Mở <ChevronRight size={12} />
            </button>
          )}
        </div>
      ))}
      {warnings.map((v, i) => (
        <div
          key={`warn-${i}`}
          className="flex items-center gap-2 px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs"
        >
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">
            <strong>{v.variantId}</strong> · {VIEW_LABELS[v.view] ?? v.view}:{" "}
            {ISSUE_MESSAGES[v.issue] ?? v.issue}
            {v.issue === "dpi_too_low" && v.detail.dpi && ` (${v.detail.dpi} DPI)`}
          </span>
          {onJumpTo && (
            <button
              onClick={() => onJumpTo(v.variantId, v.view)}
              className="flex items-center gap-0.5 underline shrink-0"
            >
              Mở <ChevronRight size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
