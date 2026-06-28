// CJS shim for zeptomatch — provides the minimal API surface used by @prisma/dev
// zeptomatch is ESM-only, but @prisma/dev bundles as CJS and uses require("zeptomatch")
// This shim replaces it with a CJS-compatible implementation.
// Only the `default` export is used: zeptomatch.default(glob, path) → boolean

"use strict";

/**
 * Convert a zeptomatch-compatible glob pattern to a RegExp.
 * Supports: *, ?, **, {a,b}, [abc], [!abc]
 */
function globToRegex(glob) {
  let pattern = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    switch (c) {
      case "*": {
        if (glob[i + 1] === "*") {
          // ** — match anything including path separators (not needed here, but support it)
          pattern += ".*";
          i += 2;
          // skip optional trailing /
          if (glob[i] === "/") i++;
          continue;
        }
        // * — match anything except /
        pattern += "[^/]*";
        i++;
        continue;
      }
      case "?":
        pattern += "[^/]";
        i++;
        continue;
      case ".":
      case "(":
      case ")":
      case "+":
      case "^":
      case "$":
      case "|":
      case "\\":
        pattern += "\\" + c;
        i++;
        continue;
      case "{": {
        // Brace expansion {a,b,c}
        const close = glob.indexOf("}", i);
        if (close === -1) {
          pattern += "\\{";
          i++;
          continue;
        }
        const inner = glob.slice(i + 1, close);
        const options = inner.split(",");
        pattern += "(?:" + options.map(globToRegex).join("|") + ")";
        i = close + 1;
        continue;
      }
      case "[": {
        const close = glob.indexOf("]", i);
        if (close === -1) {
          pattern += "\\[";
          i++;
          continue;
        }
        pattern += glob.slice(i, close + 1);
        i = close + 1;
        continue;
      }
      default:
        pattern += c;
        i++;
    }
  }
  return new RegExp("^" + pattern + "$");
}

// Cache compiled globs
const cache = Object.create(null);

function zeptomatch(glob, path, _options) {
  // If it's an array of globs
  if (Array.isArray(glob)) {
    return glob.some(function (g) {
      return zeptomatch(g, path, _options);
    });
  }
  // Single glob
  var re = cache[glob];
  if (!re) {
    re = globToRegex(glob);
    cache[glob] = re;
  }
  return re.test(path);
}

zeptomatch.compile = function (glob, _options) {
  // Returns an object with a .test(path) method (matching zeptomatch API)
  var re;
  if (typeof glob === "string") {
    re = globToRegex(glob);
  } else if (Array.isArray(glob)) {
    var res = glob.map(function (g) {
      return globToRegex(g);
    });
    re = {
      test: function (path) {
        for (var i = 0; i < res.length; i++) {
          if (res[i].test(path)) return true;
        }
        return false;
      },
    };
  } else {
    re = { test: function () { return true; } };
  }
  return { test: function (path) { return re.test(path); } };
};

module.exports = zeptomatch;
