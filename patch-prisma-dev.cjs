// Patch @prisma/dev to fix ERR_REQUIRE_ESM with zeptomatch on Node 20
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "node_modules/@prisma/dev/dist/state.cjs");
let content = fs.readFileSync(file, "utf8");

const shim = "var ne={default:function(p,s){if(!p)return true;var g=String(p);if(g===\"*\")return true;if(g.indexOf(\"*\")<0)return g===String(s);var parts=g.split(\"*\");var str=String(s);if(!str.startsWith(parts[0]))return false;if(!str.endsWith(parts[parts.length-1]))return false;return true}};var _PATCHED_ZEPTOMATCH_=1";
const originalSearch = 'var ne=T(require("zeptomatch"),1)';
const marker = "_PATCHED_ZEPTOMATCH_";

if (content.includes(marker)) {
  // Check if exactly one var ne= leads up to the marker — if so, already clean.
  const markerIdx = content.indexOf(marker);
  const firstNeIdx = content.indexOf("var ne=");
  const secondNeIdx = content.indexOf("var ne=", firstNeIdx + 1);
  // Healthy: one var ne= that is part of our shim, marker appears once after it
  if (firstNeIdx >= 0 && firstNeIdx < markerIdx && (secondNeIdx < 0 || secondNeIdx > markerIdx)) {
    console.log("Already patched correctly.");
    process.exit(0);
  }
  // Broken: multiple var ne= or marker in unexpected position — surgical fix
  const markerEnd = content.indexOf(marker) + (marker + "=1").length;
  // Find the earliest var ne= before the marker
  const neStart = content.indexOf("var ne=");
  if (neStart >= 0 && neStart < markerEnd) {
    const fixed = content.substring(0, neStart) + shim + content.substring(markerEnd);
    fs.writeFileSync(file, fixed, "utf8");
    console.log("Repaired broken/duplicate patch.");
    process.exit(0);
  }
  console.error("Could not repair: marker found but var ne= not in expected position.");
  process.exit(1);
}

if (!content.includes(originalSearch)) {
  console.error("Pattern not found — patch cannot be applied.");
  process.exit(1);
}

content = content.replace(originalSearch, function() { return shim; });
fs.writeFileSync(file, content, "utf8");
console.log("Patched successfully.");
