// Fails when a CSS class that tests select on no longer appears anywhere in src/.
// Run from the repository root: node scripts/check-test-hooks.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(path);
  }
  return out;
}

// Any single-line string literal shaped like a CSS selector: '.a', '.a .b', '.a:has-text("x")'.
const literal = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
const selectorShape = /^[\w\s.#>+~,:()[\]="'*^$|-]+$/;
const used = new Map();
for (const file of walk('tests', ['.ts', '.tsx'])) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    for (const [, , value] of line.matchAll(literal)) {
      if (!selectorShape.test(value)) continue;
      for (const [, name] of value.matchAll(/(?:^|[\s>+~,(:\]])\.([a-z][\w-]*)/g)) {
        if (!used.has(name)) used.set(name, new Set());
        used.get(name).add(file);
      }
    }
  }
}

// Classes that tests assert are absent (toHaveCount(0)), plus file extensions that look like classes.
const IGNORED = new Set([
  'context-more',
  'context-check',
  'filter-button',
  'count-badge',
  'filter-clear-button',
  'language-menu-icon',
  'results-toolbar',
  'webmanifest',
  'png',
]);
for (const name of IGNORED) used.delete(name);

const source = walk('src', ['.ts', '.tsx'])
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const missing = [...used].filter(([name]) => !new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, 'm').test(source));
if (missing.length) {
  console.error('Test selectors reference classes that no longer exist in src/:');
  for (const [name, files] of missing) console.error(`  .${name}  <- ${[...files].join(', ')}`);
  process.exit(1);
}
console.log(`OK: ${used.size} test hook classes still present in src/.`);
