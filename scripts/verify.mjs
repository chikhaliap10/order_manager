#!/usr/bin/env node
// Zero-dependency static checks that run with plain `node`, no `npm install`
// required. This is NOT a substitute for `npm run build` (which does a real
// compile + full ESLint pass) -- it exists so there's a safety net available
// even offline, in a locked-down sandbox, or before you've bothered to
// install anything.
//
// Usage: node scripts/verify.mjs
// Exit code 0 = clean, 1 = problems found (prints details either way).

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
let problems = 0;

function findJsxFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsxFiles(full));
    else if (entry.name.endsWith(".jsx") || entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// ---- Check 1: every <Component ...> used in JSX is actually defined or
// imported somewhere in the same file. This is the exact bug class that
// caused "GroupNameEditor is not defined" to reach production -- Next.js's
// linter (react/jsx-no-undef) also catches this, but only if eslint is
// installed and `next build`/`next lint` is actually run before deploying.
function checkUndefinedComponents(file, src) {
  const rel = path.relative(ROOT, file);
  const used = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]));
  const defined = new Set([
    ...[...src.matchAll(/function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]),
    ...[...src.matchAll(/const\s+([A-Z][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1]),
    ...[...src.matchAll(/class\s+([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  ]);
  // Named imports: import { A, B } from "..."; and default imports: import X from "...";
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+["'][^"']+["']/g)) {
    for (const name of m[1].split(",")) defined.add(name.trim().split(" as ").pop().trim());
  }
  for (const m of src.matchAll(/import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+["'][^"']+["']/g)) {
    defined.add(m[1]);
  }
  defined.add("React").add("Fragment");

  const missing = [...used].filter((name) => !defined.has(name));
  if (missing.length) {
    problems++;
    console.log(`\n✗ ${rel}`);
    console.log(`  JSX component(s) used but never defined or imported: ${missing.join(", ")}`);
    console.log(`  This is exactly the class of bug that crashes the page at runtime with`);
    console.log(`  "ReferenceError: <Name> is not defined" -- fix by defining or importing it.`);
  }
  return missing.length === 0;
}

// ---- Check 2: unguarded `.variants` / `.items` access on menu data, i.e.
// `item.variants.foo` instead of `item.variants?.foo` or `(item.variants ||
// []).foo`. This is a targeted check for this app's specific known failure
// mode (old-format menu items missing a `variants` array) -- it's a
// heuristic, not a general type checker, so it may flag safe code too;
// treat it as "worth a second look", not gospel.
function checkUnguardedVariantAccess(file, src) {
  const rel = path.relative(ROOT, file);
  const lines = src.split("\n");
  const offenders = [];
  lines.forEach((line, i) => {
    // Flag `X.variants.` or `X.items.` that isn't already optional-chained
    // and isn't wrapped in `(... || [])`.
    const matches = line.matchAll(/\b(\w+)\.(variants|items)\.(?!filter\(\(v\)|map\(\(v\))/g);
    for (const m of matches) {
      const before = line.slice(Math.max(0, m.index - 3), m.index);
      const isGuarded = before.includes("?.") || line.includes(`(${m[1]}.${m[2]} ||`) || line.includes(`${m[1]}?.${m[2]}`);
      if (!isGuarded) offenders.push({ lineNum: i + 1, text: line.trim() });
    }
  });
  if (offenders.length) {
    console.log(`\n⚠ ${rel} — possibly-unguarded .variants/.items access (review, may be a false positive):`);
    for (const o of offenders.slice(0, 10)) console.log(`  L${o.lineNum}: ${o.text}`);
  }
  return offenders;
}

// ---- Check 3: balanced braces/parens (catches truncated edits) ----
function checkBalance(file, src) {
  const rel = path.relative(ROOT, file);
  const braces = (src.match(/\{/g) || []).length - (src.match(/\}/g) || []).length;
  const parens = (src.match(/\(/g) || []).length - (src.match(/\)/g) || []).length;
  if (braces !== 0 || parens !== 0) {
    problems++;
    console.log(`\n✗ ${rel}`);
    console.log(`  Unbalanced braces (${braces >= 0 ? "+" : ""}${braces}) or parens (${parens >= 0 ? "+" : ""}${parens}) -- likely a truncated/broken edit.`);
    return false;
  }
  return true;
}

console.log("Running dependency-free static checks (no npm install required)...\n");
console.log("NOTE: this is a supplement to `npm run build`, not a replacement for it.");
console.log("It cannot catch everything a real compile + ESLint pass would.");

const files = findJsxFiles(path.join(ROOT, "app")).concat(findJsxFiles(path.join(ROOT, "lib")));
let totalVariantWarnings = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  checkUndefinedComponents(file, src);
  checkBalance(file, src);
  totalVariantWarnings += checkUnguardedVariantAccess(file, src).length;
}

console.log(`\n${"-".repeat(60)}`);
if (problems === 0) {
  console.log(`✓ No undefined components, no unbalanced braces/parens across ${files.length} file(s).`);
  if (totalVariantWarnings > 0) {
    console.log(`  (${totalVariantWarnings} .variants/.items access warning(s) above -- worth a manual look.)`);
  }
  process.exit(0);
} else {
  console.log(`✗ ${problems} file(s) with real problems. Fix before deploying.`);
  process.exit(1);
}
