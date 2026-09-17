# Contributing to Tebikae

Keep contributions focused on one feature, fix, or documentation improvement. Explain the problem and the intended behavior so reviewers can assess the change without needing earlier conversations.

## Local setup

Use the Node.js version required by `engines` and the pnpm version declared in `packageManager` in [package.json](package.json).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

See [development and deployment](docs/development.md) for environment details and [the protocol guide](docs/protocol.md) for data formats and module boundaries.

## Making changes

- Keep unrelated refactors and formatting changes out of the PR.
- Route note writes through the application layer and sync engine. UI components must not call GitHub write endpoints directly.
- Preserve the distinction between saving a local draft and syncing it to GitHub.
- Update English and Simplified Chinese translations together when changing user-facing text.
- Add regression coverage for bug fixes and tests for meaningful new behavior. Update the relevant documentation when behavior or setup changes.
- Use test fixtures for browser checks and screenshots. Keep tokens and private notebook content out of commits, logs, and PR attachments.

## Validation

For code changes, run the applicable checks and report the commands and results in the PR:

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm exec playwright install
pnpm test:e2e
pnpm build
```

The browser suite covers Chromium, Firefox, and WebKit with mocked GitHub responses. Ordinary PRs run full Chromium E2E and production PWA checks plus WebKit smoke tests. Changes to browser-sensitive areas add the affected WebKit and Firefox suites. Every Pages deployment requires all three engines in full before environment approval and publishes the tested build; manually dispatched Check runs also select full coverage. There is no daily schedule. Local `pnpm test:e2e` still runs all three by default. See [browser test selection](docs/browser-testing.md) for the path rules and focused commands. For changes affecting offline behavior, service workers, production assets, or deployment paths, also run the production PWA checks described in [the PWA testing guide](docs/testing-pwa.md). The [CI workflow](.github/workflows/check.yml) defines the automated checks.

For documentation-only changes, check formatting, links, and the accuracy of any commands or behavioral claims. A full application test run is not required for prose-only edits.

State any checks you did not run and why. Distinguish local results from CI results. Tests against a real GitHub repository are opt-in and require separate authorization from the maintainer; follow the dedicated procedure in the development guide.

## Required screenshots for UI changes

**Every PR that changes the UI must include screenshots in its description or a review comment and must be visually verified before it is ready to merge. Passing automated tests alone does not satisfy this requirement.** This includes changes to layout, styling, components, visible text, and interaction states.

- Capture the running app with the PR changes applied. Mockups and screenshots from an earlier implementation do not verify the submitted change.
- Include before-and-after screenshots for existing UI. For a new screen or component, include screenshots of the new UI and explain where it appears.
- Cover every affected screen or component and the states relevant to the change, such as loading, empty, error, success, or an open dialog.
- For responsive UI changes, include desktop and narrow mobile viewports. Include affected light/dark themes and English/Chinese variants when the change can alter contrast, wrapping, or layout.
- Label screenshots with the screen or state, viewport size, browser, and applicable theme or language. Embed them in the PR or link directly to accessible screenshot artifacts.
- Inspect the screenshots for clipped text, overflow, overlap, alignment, and controls that are hard to see or reach. Describe the interactions you checked separately; a screenshot alone cannot verify keyboard navigation or that an action works.
- Refresh the screenshots after follow-up commits change the UI they show. Use synthetic content and ensure screenshots contain no credentials or private data.

If you cannot capture the affected UI, explain the limitation and keep the PR in draft until screenshot verification is complete.

## Opening a pull request

Use a descriptive Conventional Commit title, such as `fix(editor): preserve unsaved text` or `feat(export): add Markdown download`.

Include:

- The problem, the resulting behavior, and any relevant issue link.
- The scope of the change and any compatibility or data-format implications.
- Validation commands and results, including untested cases or known limitations.
- The required screenshots and visual verification notes for any UI changes.

Keep the description current as the implementation changes. Address review findings and ensure the applicable CI checks pass on the latest commit before requesting a merge.
