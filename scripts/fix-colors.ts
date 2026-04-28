import 'dotenv/config';
import { prisma } from '../src/lib/db';

function colorToHex(colorName: string): string {
  const map: Record<string, string> = {
    white: "#FFFFFF",
    black: "#111111",
    navy: "#131E3A",
    "midnight navy": "#131E3A",
    red: "#C41E3A",
    "cardinal red": "#8A0303",
    "dark red": "#8B0000",
    "sport grey": "#9B9B9B",
    "dark heather": "#414141",
    "heather grey": "#9B9B9B",
    "athletic heather": "#9B9B9B",
    heather: "#B7C9E2",
    "royal blue": "#4169E1",
    royal: "#4169E1",
    "forest green": "#228B22",
    "kelly green": "#4CBB17",
    "irish green": "#008000",
    "military green": "#4B5320",
    "dark green": "#006400",
    green: "#008000",
    maroon: "#800000",
    purple: "#800080",
    "purple rush": "#7851A9",
    orange: "#FFA500",
    "light blue": "#ADD8E6",
    "light pink": "#FFB6C1",
    pink: "#FFC0CB",
    gold: "#FFD700",
    yellow: "#FFFF00",
    charcoal: "#36454F",
    "ash grey": "#B2BEB5",
    "heavy metal": "#545454",
    grey: "#808080",
    gray: "#808080",
    "light grey": "#D3D3D3",
    brown: "#8B4513",
    "dark chocolate": "#3B2F2F",
    tan: "#D2B48C",
    sand: "#C2B280",
    natural: "#F5F5DC",
    cream: "#FFFDD0",
    olive: "#808000",
    indigo: "#4B0082",
    coral: "#FF7F50",
    teal: "#008080",
    turquoise: "#40E0D0",
    blue: "#0000FF",
  };

  let key = colorName.toLowerCase().trim();
  if (map[key]) return map[key];

  const prefixesToStrip = ["solid ", "vintage ", "heather "];
  for (const prefix of prefixesToStrip) {
    if (key.startsWith(prefix)) {
      const strippedKey = key.slice(prefix.length).trim();
      if (map[strippedKey]) return map[strippedKey];
    }
  }

  const baseColors = ["black", "white", "navy", "red", "royal", "green", "maroon", "purple", "orange", "yellow", "grey", "gray", "brown", "blue", "pink"];
  for (const base of baseColors) {
    if (key.includes(base)) {
      return map[base];
    }
  }

  return "#CCCCCC";
}

(async () => {
  console.log('--- Starting Colors Migration ---');
  
  const colors = await prisma.storeColor.findMany();
  let updatedColors = 0;

  for (const color of colors) {
    if (!color.name) continue;
    
    const expectedHex = colorToHex(color.name);
    if (color.hex !== expectedHex) {
      console.log(`[StoreColor ${color.id}] Updating: ${color.name} (${color.hex} -> ${expectedHex})`);
      await prisma.storeColor.update({
        where: { id: color.id },
        data: { hex: expectedHex }
      });
      updatedColors++;
    }
  }

  console.log(`--- Migration complete. Updated ${updatedColors} colors. ---`);
  await prisma.$disconnect();
})();
