"use client";

import { useRotationSnapHint } from "@/hooks/useRotationSnapHint";

interface RotationControlProps {
  value: number;
  onChange: (deg: number) => void;
}

const SNAP_DEGREES = [0, 45, 90, 135, 180, -45, -90, -135];
const SNAP_TOLERANCE = 3;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/**
 * Find the nearest snap angle if within tolerance.
 * Returns the snap angle or null if no snap applies.
 */
function findSnap(deg: number): number | null {
  for (const snap of SNAP_DEGREES) {
    if (Math.abs(deg - snap) <= SNAP_TOLERANCE) return snap;
  }
  return null;
}

export function RotationControl({ value, onChange }: RotationControlProps) {
  const { triggerHint } = useRotationSnapHint();
  const rounded = Math.round(value);

  /** Called from slider — apply snap + show hint if snapping */
  const handleSliderChange = (rawDeg: number) => {
    const snap = findSnap(rawDeg);
    if (snap !== null && snap !== rawDeg) {
      onChange(snap);
      triggerHint(snap);
    } else {
      onChange(rawDeg);
    }
  };

  /** Called from numeric input — no snap, exact value */
  const handleNumericChange = (rawDeg: number) => {
    onChange(clamp(rawDeg, -180, 180));
  };

  return (
    <div className="space-y-2">
      {/* Label + numeric input (no snap) */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-secondary">Xoay (°)</label>
        <input
          type="number"
          min={-180}
          max={180}
          step={1}
          value={rounded}
          onChange={(e) => handleNumericChange(Number(e.target.value))}
          className="input w-16 text-right text-xs font-mono h-7 px-2"
          aria-label="Góc xoay theo số"
          title="Nhập số — không có snap"
        />
      </div>

      {/* Slider — applies snap */}
      <input
        type="range"
        min={-180}
        max={180}
        step={1}
        value={rounded}
        onChange={(e) => handleSliderChange(Number(e.target.value))}
        className="w-full accent-wise-green"
        aria-label="Slider xoay (có snap tại 0/45/90/135/180)"
      />

      {/* Snap preset buttons */}
      <div className="flex flex-wrap gap-1">
        {SNAP_DEGREES.map((deg) => (
          <button
            key={deg}
            onClick={() => onChange(deg)}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              rounded === deg
                ? "bg-wise-green text-white border-wise-green"
                : "border-border-default hover:border-wise-green hover:text-wise-green"
            }`}
            aria-label={`Xoay ${deg}°`}
          >
            {deg}°
          </button>
        ))}
      </div>
    </div>
  );
}
