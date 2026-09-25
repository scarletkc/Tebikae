// Guards the UI conventions in docs/ui-overhaul-plan.md so finished migrations cannot regress.
// Run from the repository root: node scripts/check-ui-rules.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Stylesheets that may exist. Remove an entry when its file is deleted; never add one.
const ALLOWED_CSS = new Set([
  'src/styles/app.css',
  'src/styles/layers.css',
  'src/styles/theme.css',
  'src/styles/legacy.css',
  'src/features/editor/editor.css', // ProseMirror content typography (allowed long term)
  'src/features/labels/labels.css', // legacy, migrate into components
  'src/features/notes/notes.css', // legacy, migrate into components
]);
// legacy.css may only shrink. Lower this number whenever a migration deletes rules.
const LEGACY_MAX_LINES = 1740;
// Raw colors are allowed only in the token file and where colors are user data (GitHub label colors).
const RAW_COLOR_ALLOWED = ['src/styles/theme.css', 'src/features/labels/'];

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;
const LEGACY_BUTTON = /["'`\s]button (?:primary|secondary|wide)\b|\btext-button\b|\bdanger-button\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path.replaceAll('\\', '/'));
  }
  return out;
}

const problems = [];
const report = (file, line, message) => problems.push(`${file}:${line}  ${message}`);

for (const file of walk('src')) {
  const isCss = file.endsWith('.css');
  const isCode = /\.(tsx?|jsx?)$/.test(file);
  if (!isCss && !isCode) continue;
  if (isCss && !ALLOWED_CSS.has(file))
    report(file, 1, 'new stylesheet: style with Tailwind classes and src/ui components instead');
  const rawColorAllowed = RAW_COLOR_ALLOWED.some((prefix) => file.startsWith(prefix));
  const lines = readFileSync(file, 'utf8').split('\n');
  if (file === 'src/styles/legacy.css' && lines.length > LEGACY_MAX_LINES)
    report(
      file,
      lines.length,
      `legacy.css grew to ${lines.length} lines (max ${LEGACY_MAX_LINES}); do not add legacy CSS`,
    );
  lines.forEach((text, index) => {
    const line = index + 1;
    const code = text.replace(/\/\/.*$|\/\*.*?\*\//g, '');
    if (!rawColorAllowed && RAW_COLOR.test(code))
      report(file, line, 'raw color: use a token from src/styles/theme.css');
    if (isCss) {
      const px = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(code);
      const rem = /font-size:\s*(\d*\.\d+|\d+)rem/.exec(code);
      if ((px && Number(px[1]) < 12) || (rem && Number(rem[1]) < 0.75))
        report(file, line, 'font-size below 12px');
    } else {
      if (LEGACY_BUTTON.test(code)) report(file, line, 'legacy button class: use <Button> from src/ui');
      if (/style=\{\{[^}]*zIndex/.test(code)) report(file, line, 'inline z-index: use the z-* scale');
    }
  });
}

if (problems.length) {
  console.error('UI rule violations (see docs/ui-overhaul-plan.md):');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('OK: UI rules hold.');
