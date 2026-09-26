import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
// Maskable icons are cropped to a platform shape, so keep the whole folded tile inside the 80% safe
// zone on a full-bleed white background; cropping it directly would cut off the folded corner.
const inner = svg.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="#fff"/><g transform="translate(38 38) scale(0.6)">${inner}</g></svg>`;
const outputs = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', maskable, 512],
];
const browser = await chromium.launch();
try {
  for (const [name, source, size] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${source}`,
    );
    await page.screenshot({
      path: new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
