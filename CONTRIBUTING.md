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

Run focused tests for the behavior you changed, along with relevant formatting, type, lint, or build checks. For UI changes, check the affected interactions and provide the screenshots required below. See the [development guide](docs/development.md#检查) for commands.

Focused local validation is sufficient to open a PR. You do not need to install every browser or repeat the complete E2E/PWA suites locally. CI runs static checks, the full unit suite, and browser tests selected for the change. Its required checks must pass on the latest commit before merging; [browser test selection](docs/browser-testing.md) explains that coverage and the full checks required before deployment.

For documentation-only changes, check formatting, links, and the accuracy of any commands or behavioral claims. A full application test run is not required for prose-only edits.

In the PR, state which local commands and interactions you checked, their results, and any relevant behavior you could not verify. Keep local results separate from CI results. You do not need to list unrelated suites left to CI.

Mobile keyboards, input methods, and other device-specific behavior need verification on the affected device or emulator. Tests that write to a real GitHub repository require separate maintainer authorization; follow the [live-repository procedure](docs/development.md#可选真实仓库验收).

## Required screenshots for UI changes

**Every PR that changes the UI must include screenshots in its description or a review comment and must be visually verified before it is ready to merge. Passing automated tests alone does not satisfy this requirement.** This includes changes to layout, styling, components, visible text, and interaction states.

- Capture the running app with the PR changes applied. Mockups and screenshots from an earlier implementation do not verify the submitted change.
- Include before-and-after screenshots for existing UI. For a new screen or component, include screenshots of the new UI and explain where it appears.
- Cover every affected screen or component and the states relevant to the change, such as loading, empty, error, success, or an open dialog.
- For responsive UI changes, include desktop and narrow mobile viewports. Include affected light/dark themes and English/Chinese variants when the change can alter contrast, wrapping, or layout.
- Label screenshots with the screen or state, viewport size, browser, and applicable theme or language. Embed them in the PR or link directly to accessible screenshot artifacts.
- Inspect the screenshots for clipped text, overflow, overlap, alignment, and controls that are hard to see or reach. Describe the interactions you checked separately; a screenshot alone cannot verify keyboard navigation or that an action works.
- Refresh the screenshots after follow-up commits change the UI they show. Use synthetic content and ensure screenshots contain no credentials or private data.

Use `pnpm screenshots` to capture the built-in scenarios. If they do not cover your change, modify or add scenarios and mock data under `tests/screenshots/`; extend the shared helpers or configuration when needed. Passing the existing scenarios does not establish coverage of new UI or states. See the [screenshot guide](docs/screenshots.md) for focused commands, helper methods, and an example of adding a scenario.

If you cannot upload screenshots in the browser and have push access to this repository, use [GitHub CLI attachments](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli). Check `gh pr comment --help` for `--attach` and upgrade `gh` if it is missing. Put captions and visual verification notes in `screenshots.md`, then replace `PR_NUMBER` and the image paths below:

```sh
gh pr comment PR_NUMBER --repo scarletkc/Tebikae --body-file screenshots.md --attach before.png --attach after.png
```

If you do not have push access here, upload the screenshots as attachments to an issue in your own public fork, then copy the uploaded image links into this PR. Replace `YOUR_USERNAME/Tebikae` with your fork, enable issues there if needed, and create the screenshot issue:

```sh
gh repo edit YOUR_USERNAME/Tebikae --enable-issues
gh issue create --repo YOUR_USERNAME/Tebikae --title "Screenshots for Tebikae PR PR_NUMBER" --body-file screenshots.md --attach before.png --attach after.png
gh issue view SCREENSHOT_ISSUE_NUMBER --repo YOUR_USERNAME/Tebikae --json body --jq .body
```

Use the issue number returned by `gh issue create` for `SCREENSHOT_ISSUE_NUMBER`. Save the Markdown printed by `gh issue view`, which contains the uploaded image URLs, as UTF-8 in `uploaded-screenshots.md`. Post it with `gh pr comment PR_NUMBER --repo scarletkc/Tebikae --body-file uploaded-screenshots.md` (without `--attach`) and verify that reviewers can open the images.

Keep review screenshots out of Git commits and the PR's file changes. Do not create a separate branch just to host them.

If you cannot capture the affected UI, explain the limitation and keep the PR in draft until screenshot verification is complete.

## Opening a pull request

Use a descriptive Conventional Commit title, such as `fix(editor): preserve unsaved text` or `feat(export): add Markdown download`.

Use Conventional Commit types in branch names as `<type>/<short-description>`, such as `feat/markdown-export` or `fix/editor-unsaved-text`.

Include:

- The problem, the resulting behavior, and any relevant issue link.
- The scope of the change and any compatibility or data-format implications.
- Validation commands and results, including untested cases or known limitations.
- The required screenshots and visual verification notes for any UI changes.

Keep the description current as the implementation changes. Address review findings and ensure the applicable CI checks pass on the latest commit before requesting a merge.
