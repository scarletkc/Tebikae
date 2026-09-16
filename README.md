# Tebikae

_Simple notes, powered by GitHub Issues._

A quiet place for Markdown notes and checklists, stored as Issues in your own private GitHub repository. Tebikae is a static web app: your browser talks directly to GitHub, with local drafts in IndexedDB.

## Run locally

Use Node.js 24 and the pnpm version declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed local address. Connect a private repository you own and a fine-grained personal access token limited to that repository, with **Issues: Read and write**. Connecting only reads data. See [connection and privacy](docs/getting-started.md).

Select **Remember this connection in this browser** to save your connection with encryption and restore it when you return. This option is off by default; otherwise the token stays in the current tab's memory. Disconnect in Settings to remove saved credentials. See [connection and privacy](docs/getting-started.md#数据与隐私) for the local encryption limits. “Saved to this device” and “Synced to GitHub” are separate states.

## Included

- Visual Markdown editing with a source mode, checklists, links, code, and GFM tables.
- GitHub labels, search and combined filters, colors, pinning, archive, and recoverable trash.
- Simplified Chinese and English; light, dark, and system themes.
- Local drafts, a persistent sync queue, conflict resolution, recovery copies, and JSON / Markdown exports, including a bulk Markdown ZIP with a preview and optional trash inclusion.
- An installable PWA with an offline app shell and editor.

## Development

See [Contributing](CONTRIBUTING.md) for the contribution workflow, validation requirements, and required screenshots for UI changes.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install
pnpm test:e2e
pnpm build
pnpm preview
```

Production output is `dist/`; it needs no business backend. See [development and deployment](docs/development.md) for static hosting, the GitHub Pages base path, production PWA checks, and the opt-in live-repository test.

## Project references

- [Product and architecture specification](docs/github-issues-notes-product-architecture.md)
- [Data protocol and module boundaries](docs/protocol.md)
- [Acceptance record and remaining manual checks](docs/acceptance.md)
- [Later work: MCP, Skill, and other extensions](docs/roadmap.md)

## License

Copyright (c) 2026 ScarletKc. Licensed under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`).
