import { pathToFileURL } from 'node:url';

export function checksPassed({ plan, validate, browsers, documentationOnly, runBrowsers }) {
  if (plan !== 'success') return false;
  if (documentationOnly === 'true')
    return runBrowsers === 'false' && validate === 'skipped' && browsers === 'skipped';
  if (documentationOnly !== 'false' || validate !== 'success') return false;
  if (runBrowsers === 'true') return browsers === 'success';
  return runBrowsers === 'false' && browsers === 'skipped';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = {
    plan: process.env.PLAN,
    validate: process.env.VALIDATE,
    browsers: process.env.BROWSERS,
    documentationOnly: process.env.DOCUMENTATION_ONLY,
    runBrowsers: process.env.RUN_BROWSERS,
  };
  if (!checksPassed(result)) {
    console.error('Required checks did not complete as planned:', result);
    process.exitCode = 1;
  }
}
