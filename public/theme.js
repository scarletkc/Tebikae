/* Apply the stored preference before the first paint. */
try {
  const preference = localStorage.getItem('tebikae.theme') || 'system';
  document.documentElement.dataset.theme =
    preference === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference === 'dark'
        ? 'dark'
        : 'light';
} catch {
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
/* Keep the browser/PWA status bar in step with the canvas color (see src/styles/theme.css). */
document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#191919' : '#ffffff');
