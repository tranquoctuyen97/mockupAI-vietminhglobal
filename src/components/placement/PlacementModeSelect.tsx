"use client";

import type { PlacementMode } from "@/lib/placement/types";

interface PlacementModeSelectProps {
  value: PlacementMode;
  onChange: (mode: PlacementMode) => void;
}

const MODES: { value: PlacementMode; label: string; desc: string }[] = [
  {
    value: "preserve",
    label: "Giữ tỉ lệ",
    desc: "An toàn — Printify scale giữ nguyên tỉ lệ W/H",
  },
  {
    value: "stretch",
    label: "Kéo giãn",
    desc: "Lấp đầy print area, có thể bị méo",
  },
  {
    value: "exact",
    label: "Chính xác mm",
    desc: "Printify dùng đúng kích thước mm, không scale",
  },
];

export function PlacementModeSelect({ value, onChange }: PlacementModeSelectProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-text-secondary block">
        Chế độ đặt in
      </label>
      <div className="flex flex-col gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            className={`text-left px-3 py-2 rounded-md border text-xs transition-colors ${
              value === m.value
                ? "border-wise-green bg-wise-green/8 font-semibold"
                : "border-border-default hover:border-wise-green/50"
            }`}
          >
            <span className="block">{m.label}</span>
            <span className="block text-[10px] text-text-secondary mt-0.5 opacity-70">
              {m.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
