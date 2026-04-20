"use client";

import { useState, useEffect, useId } from "react";
import { AlertCircle } from "lucide-react";

interface NumericInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Soft range: warn (yellow border) when outside, but allowed */
  softMin?: number;
  softMax?: number;
  /** Hard range: clamp on blur, error border until corrected */
  hardMin?: number;
  hardMax?: number;
  step?: number;
  unit?: string;
  className?: string;
  /** If false, renders a plain <input> (feature flag off) */
  enableSoftClamp?: boolean;
}

function clamp(v: number, min?: number, max?: number) {
  let result = v;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

export function NumericInput({
  label,
  value,
  onChange,
  softMin,
  softMax,
  hardMin = -1000,
  hardMax = 1000,
  step = 1,
  unit = "mm",
  className = "",
  enableSoftClamp = true,
}: NumericInputProps) {
  const hintId = useId();
  const [raw, setRaw] = useState(String(Math.round(value)));
  const [touched, setTouched] = useState(false);

  // Sync external value changes (undo/redo, preset apply) back into raw
  useEffect(() => {
    setRaw(String(Math.round(value)));
  }, [value]);

  if (!enableSoftClamp) {
    return (
      <input
        type="number"
        value={Math.round(value)}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`input w-full font-mono text-right text-xs h-8 ${className}`}
        aria-label={label}
      />
    );
  }

  const numeric = Number(raw);
  const isNaN_ = isNaN(numeric);
  const outsideSoft =
    !isNaN_ &&
    ((softMin !== undefined && numeric < softMin) ||
      (softMax !== undefined && numeric > softMax));
  const outsideHard = !isNaN_ && (numeric < hardMin || numeric > hardMax);

  const hintMsg = outsideHard
    ? `Giá trị phải trong ${hardMin}–${hardMax}${unit}. Tự động chỉnh lại.`
    : outsideSoft
    ? `Cảnh báo: ${label} ngoài vùng an toàn (${softMin ?? ""}–${softMax ?? ""}${unit}). Có thể ra ngoài print area.`
    : null;

  const borderClass = touched
    ? outsideHard
      ? "border-danger ring-1 ring-danger/40"
      : outsideSoft
      ? "border-warning ring-1 ring-warning/40"
      : ""
    : "";

  const handleBlur = () => {
    setTouched(true);
    if (isNaN_) {
      // Reset to last valid value
      setRaw(String(Math.round(value)));
      return;
    }
    const clamped = clamp(numeric, hardMin, hardMax);
    onChange(clamped);
    if (clamped !== numeric) {
      setRaw(String(Math.round(clamped)));
    }
  };

  return (
    <div className="relative">
      <input
        type="number"
        value={raw}
        step={step}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={handleBlur}
        className={`input w-full font-mono text-right text-xs h-8 transition-colors ${borderClass} ${className}`}
        aria-label={label}
        aria-invalid={touched && (outsideSoft || outsideHard)}
        aria-describedby={hintMsg ? hintId : undefined}
      />
      {touched && hintMsg && (
        <div
          id={hintId}
          role="alert"
          className={`absolute top-full left-0 mt-0.5 flex items-start gap-1 text-[10px] leading-tight z-10 ${
            outsideHard ? "text-danger" : "text-warning"
          }`}
        >
          <AlertCircle size={10} className="mt-0.5 shrink-0" />
          <span>{hintMsg}</span>
        </div>
      )}
    </div>
  );
}
