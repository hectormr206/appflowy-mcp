# Contributing

Thanks for considering a contribution. This doc covers the repo layout, how to
add a new tool, how to run tests, and the release process.

## Repo layout

```
appflowy-mcp/
├── src/
│   ├── index.ts       # MCP server — tool registration lives here
│   ├── client.ts      # AppFlowyClient: auth + REST wrapper
│   ├── docEdit.ts     # Yjs-backed document editor (load, edit, insert, replace)
│   ├── yjsDoc.ts      # Yjs -> markdown decoder (fetch_page_markdown)
│   ├── inline.ts      # Inline markdown -> Delta ops parser
│   └── cells.ts       # Friendly value -> on-wire database cell encoders
├── test/              # node:test unit tests (run with `npm test`)
├── scripts/
│   └── smoke.ts       # Opt-in live E2E test against a real instance
├── examples/          # Copy-pasteable usage examples for LLM clients
├── .github/workflows/ # CI + auto-publish
├── README.md
└── package.json
```

## Design principle — thin adapter

This MCP is a **thin adapter** over AppFlowy-Cloud's REST surface. It does NOT
invent features, create shadow state, or simulate non-existent endpoints. If
the server does not expose something, the README documents the gap rather than
shipping a fake. Every tool is backed by a verified route in `AppFlowy-Cloud/src/api/*.rs`.

Re-read the README's [Design principles](README.md#design-principles) section
before proposing a tool.

## Adding a new tool — checklist

1. **Verify the endpoint exists in AppFlowy-Cloud source.** Grep
   `AppFlowy-Cloud/src/api/*.rs` and `libs/shared-entity` for the backing
   route. If it does not exist upstream, open an AppFlowy-Cloud issue first —
   do not ship a fake. Add a row to [Known limits](README.md#known-limits-awaiting-appflowy-upstream)
   instead.
2. **Wire the call via `AppFlowyClient.request`.** Use typed `method`, `path`,
   and `opts.query` / `opts.body`. Do not call `fetch` directly from tool
   handlers.
3. **Add a zod schema** for the tool's input. Keep fields minimal — prefer the
   server's field names.
4. **Register the tool in `src/index.ts`** with a concise description. The
   description is what the LLM sees; be specific about what the tool does and
   what it returns.
5. **Update the README tool table.** Add the tool to the right section, mark
   version (e.g. `v0.8 —`), and call out any client-side work or caveats.
6. **Add a test.**
   - Pure logic (encoders, parsers, URL builders): unit test in `test/`.
   - End-to-end flow: add to `scripts/smoke.ts` if safe and cleanable.
7. **Verify it builds:** `npm run build`. CI runs this on every push.

If you are tempted to invent shadow state or simulate missing features, stop.
Document the gap and ship nothing.

## Running tests

```bash
npm install
npm test          # unit tests (node:test + tsx)
npm run build     # typecheck + compile
```

### Smoke (opt-in)

```bash
export APPFLOWY_BASE_URL=https://appflowy.your-host.com
export APPFLOWY_EMAIL=you@example.com
export APPFLOWY_PASSWORD=...
npm run smoke
```

Smoke creates a throwaway page, edits it, verifies the round trip, then
trashes it. It requires a live AppFlowy-Cloud and will be skipped (no-op,
exit 0) when env vars are missing — CI relies on this behavior.

## Release process

Releases are tag-driven. CI publishes to npm automatically when you push a
`v*.*.*` tag.

1. Bump the version in:
   - `package.json` (`version` field)
   - `src/index.ts` (`new McpServer({ version: "..." })`)
2. Commit: `chore: bump to vX.Y.Z`.
3. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z release notes..."`.
4. Push: `git push origin main --follow-tags`.
5. CI runs build + tests, then publishes to npm and creates a GitHub Release
   with auto-generated notes derived from the tag message + commit log.

### Required repo secret

`NPM_TOKEN` — an npm automation token with publish rights for
`@hectormr206/appflowy-mcp`. Set it under
**Repo settings -> Secrets and variables -> Actions**.

## Commit style

Conventional commits:

- `feat:` new tool or meaningful capability
- `fix:` bug fix
- `test:` tests added / changed
- `docs:` README / CONTRIBUTING / examples
- `ci:` GitHub Actions / release plumbing
- `refactor:` non-behavioral code reshuffle
- `chore:` version bumps, deps, housekeeping

Keep the subject under 72 chars. Explain the *why* in the body when it is not
obvious. Reference the upstream AppFlowy-Cloud route when adding a tool.
