"use client";

import { FlipHorizontal } from "lucide-react";

interface MirrorButtonProps {
  mirrored: boolean;
  onToggle: () => void;
}

export function MirrorButton({ mirrored, onToggle }: MirrorButtonProps) {
  return (
    <button
      onClick={onToggle}
      aria-label="Lật ngang"
      title="Lật ngang (phím F)"
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors ${
        mirrored
          ? "border-wise-green bg-wise-green/10 text-wise-green font-medium"
          : "border-border-default hover:border-wise-green/50 text-text-secondary"
      }`}
    >
      <FlipHorizontal size={13} />
      <span>Lật ngang</span>
    </button>
  );
}
