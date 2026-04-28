export type ShirtView = "front" | "back" | "sleeve_left" | "sleeve_right" | "neck_label";

export const VIEW_LABELS: Record<ShirtView, string> = {
  front: "Mặt trước",
  back: "Mặt sau",
  sleeve_left: "Tay trái",
  sleeve_right: "Tay phải",
  neck_label: "Cổ áo",
};

// SVG viewBox: 600 wide × 700 tall — accommodates shirt with margin
export const SVG_VIEWBOX_W = 600;
export const SVG_VIEWBOX_H = 700;

// Shirt body bounds in SVG coords (front view)
export const SHIRT_BOUNDS = {
  shoulderY: 90,
  hemY: 660,
  bodyLeft: 140,
  bodyRight: 460,
};

// Print area positioning on shirt (front view) — chest center
export const PRINT_AREA_CENTER_X = 300;
export const PRINT_AREA_CENTER_Y = 380;
export const PRINT_AREA_SVG_HEIGHT = 280;

export function shirtBodyPath(view: ShirtView): string {
  if (view === "front" || view === "back") {
    return `
      M 145,95
      L 230,82
      C 240,140 270,165 300,165
      C 330,165 360,140 370,82
      L 455,95
      L 555,165
      L 510,265
      L 465,250
      L 465,655
      Q 465,665 455,665
      L 145,665
      Q 135,665 135,655
      L 135,250
      L 90,265
      L 45,165
      Z
    `;
  }
  if (view === "sleeve_left" || view === "sleeve_right") {
    return `
      M 200,150
      L 400,150
      L 430,500
      Q 430,520 410,520
      L 190,520
      Q 170,520 170,500
      Z
    `;
  }
  return `
    M 250,250
    L 350,250
    L 360,400
    L 240,400
    Z
  `;
}

export function darken(hex: string, amount = 0.15): string {
  const h = hex.replace("#", "");
  const num = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  r = Math.max(0, Math.floor(r * (1 - amount)));
  g = Math.max(0, Math.floor(g * (1 - amount)));
  b = Math.max(0, Math.floor(b * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function strokeColor(bg: string): string {
  const h = bg.replace("#", "");
  const num = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 200 ? "#666" : "#1a1a1a";
}

/**
 * Generate a standalone SVG string of the shirt silhouette.
 * Used by backend worker to render to PNG.
 */
export function generateShirtSvg(view: ShirtView, colorHex: string): string {
  const bodyPath = shirtBodyPath(view);
  const stroke = strokeColor(colorHex);
  const innerCollar = darken(colorHex, 0.25);

  let extraPaths = "";
  if (view === "front" || view === "back") {
    if (view === "front") {
      extraPaths += `<path d="M 230,82 C 240,140 270,165 300,165 C 330,165 360,140 370,82 Z" fill="${innerCollar}" stroke="${stroke}" stroke-width="1.5" />`;
    }
    if (view === "back") {
      extraPaths += `<path d="M 250,82 C 260,110 280,125 300,125 C 320,125 340,110 350,82 Z" fill="${innerCollar}" stroke="${stroke}" stroke-width="1.5" />`;
    }
    extraPaths += `
      <path d="M 130,250 Q 150,255 170,255" stroke="${stroke}" stroke-width="1" stroke-dasharray="4,3" fill="none" opacity="0.6" />
      <path d="M 470,250 Q 450,255 430,255" stroke="${stroke}" stroke-width="1" stroke-dasharray="4,3" fill="none" opacity="0.6" />
      <line x1="145" y1="640" x2="455" y2="640" stroke="${stroke}" stroke-width="1" stroke-dasharray="3,2" opacity="0.5" />
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_VIEWBOX_W} ${SVG_VIEWBOX_H}">
    <defs>
      <filter id="shirtShadow" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
        <feOffset dx="0" dy="4" result="offsetblur" />
        <feFlood flood-color="#000" flood-opacity="0.15" />
        <feComposite in2="offsetblur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="#f5f3ee" />
    <path d="${bodyPath}" fill="${colorHex}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" filter="url(#shirtShadow)" />
    ${extraPaths}
  </svg>`;
}
