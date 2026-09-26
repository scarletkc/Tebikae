import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserPlan } from './ci-browser-plan.mjs';

const artifactName = 'verified-browser-builds';
const workflows = ['.github/workflows/check.yml', '.github/workflows/pages.yml'];
const buildPaths = { '/': 'dist', '/Tebikae/': '.artifacts/pages-dist' };

export function verification({ sha, runId, runAttempt }) {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    !/^[1-9]\d*$/.test(String(runId)) ||
    !/^[1-9]\d*$/.test(String(runAttempt))
  )
    throw new Error('Missing verification commit or run identity');
  return {
    schemaVersion: 1,
    sha,
    runId: String(runId),
    runAttempt: String(runAttempt),
    workflow: '.github/workflows/check.yml',
    builds: buildPaths,
    browsers: browserPlan([], true).include,
  };
}

export function validateBuild(directory, identity) {
  const expected = verification(identity);
  const manifest = JSON.parse(readFileSync(join(directory, 'browser-verification.json'), 'utf8'));
  if (JSON.stringify(manifest) !== JSON.stringify(expected))
    throw new Error('Full verification does not match the target commit, run or configuration');
  for (const path of Object.values(buildPaths)) {
    const info = JSON.parse(readFileSync(join(directory, path, 'build-info.json'), 'utf8'));
    if (
      info.commit !== identity.sha ||
      info.dirty !== false ||
      !existsSync(join(directory, path, 'index.html'))
    )
      throw new Error(`Build metadata or entrypoint does not match: ${path}`);
  }
}

export async function findVerifiedBuild({ request, repository, sha, now = Date.now() }) {
  const prefix = `/repos/${repository}/actions`;
  const { workflow_runs: runs } = await request(
    `${prefix}/runs?head_sha=${sha}&event=workflow_dispatch&status=success&per_page=100`,
  );
  for (const run of runs) {
    if (
      run.head_sha !== sha ||
      run.status !== 'completed' ||
      run.conclusion !== 'success' ||
      run.event !== 'workflow_dispatch' ||
      !workflows.includes(run.path) ||
      run.repository?.full_name?.toLowerCase() !== repository.toLowerCase()
    )
      continue;
    const { artifacts } = await request(`${prefix}/runs/${run.id}/artifacts?per_page=100`);
    const artifact = artifacts.find(
      (item) =>
        item.name === artifactName &&
        !item.expired &&
        Date.parse(item.expires_at) > now &&
        item.workflow_run?.head_sha === sha,
    );
    if (artifact)
      return { runId: String(run.id), runAttempt: String(run.run_attempt), artifactId: String(artifact.id) };
  }
  return null;
}

const output = (name, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
const summary = (message) => {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  const identity = {
    sha: process.env.GITHUB_SHA,
    runId: process.env.VERIFIED_RUN_ID || process.env.GITHUB_RUN_ID,
    runAttempt: process.env.VERIFIED_RUN_ATTEMPT || process.env.GITHUB_RUN_ATTEMPT,
  };
  if (command === 'record') {
    writeFileSync('browser-verification.json', JSON.stringify(verification(identity)));
    validateBuild('.', identity);
  } else if (command === 'find') {
    try {
      const candidate = await findVerifiedBuild({
        repository: process.env.GITHUB_REPOSITORY,
        sha: identity.sha,
        request: async (path) => {
          const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
            headers: {
              authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
              accept: 'application/vnd.github+json',
            },
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) throw new Error(`Actions API returned ${response.status}`);
          return response.json();
        },
      });
      if (candidate) {
        output('run_id', candidate.runId);
        output('run_attempt', candidate.runAttempt);
        output('artifact_id', candidate.artifactId);
      } else summary('No reusable full verification found. Run full verification for this deployment.');
    } catch (error) {
      summary(
        `Full verification lookup unavailable (${error.message}). Run full verification for this deployment.`,
      );
    }
  } else if (command === 'validate' || command === 'probe') {
    try {
      validateBuild(process.argv[3] || '.', identity);
      output('reused', 'true');
      summary(
        `Full verification: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
      );
    } catch (error) {
      if (command === 'validate') throw error;
      output('reused', 'false');
      summary(`Build cannot be reused (${error.message}). Run full verification for this deployment.`);
    }
  } else throw new Error(`Unknown verified-build command: ${command}`);
}
