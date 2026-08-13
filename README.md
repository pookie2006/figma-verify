# Figma Verify

**An MCP server that lets AI agents check their code against the Figma design — and self-correct until it's pixel-perfect.**

**🔗 Live demo:** [pookie2006.github.io/figma-verify](https://pookie2006.github.io/figma-verify/) — the interactive drift report, the flawed implementation it's scoring, and a pixel-faithful reference build.

> First-time setup: open [Settings → Pages](https://github.com/pookie2006/figma-verify/settings/pages) and either set Source to **GitHub Actions**, *or* set Source to **Deploy from a branch** → `main` → `/docs`. Until that toggle is flipped once, the `github.io` URL returns 404.

Figma's MCP server pushes design context *into* agents, and agents generate code from it. But nothing closes the loop: no tool lets the agent **verify** that the implementation actually matches the design. Figma Verify closes that loop — the agent implements, verifies, reads the drift report, fixes its code, and re-runs until the fidelity score is 100.

```
        ┌────────────────────────────────────────────────┐
        │                    Agent loop                  │
        │                                                │
        │   implement ──► verify_implementation ──► fix  │
        │       ▲                                    │   │
        │       └────────── drift report ◄───────────┘   │
        └────────────────────────────────────────────────┘
```

## How it works

Figma Verify pulls the design's node tree from the Figma REST API and the live page's DOM + computed styles via headless Chromium (Playwright). Both sides are normalized into the same schema, matched (text anchors → container ancestry → geometry), and diffed with configurable tolerances. The result is a drift report with per-element diffs, severity levels, CSS selector hints, and a fidelity score from 0–100.

## Repository layout

All code lives in [`figma-verify/`](figma-verify/):

| Path | What it is |
|---|---|
| `figma-verify/src/` | MCP server, CLI, Figma normalization, DOM extraction, matcher, diff engine, report renderer |
| `figma-verify/tests/` | Fixture-driven unit tests plus a Playwright e2e suite |
| `figma-verify/demo/` | A deliberately flawed implementation of a design frame, with a recorded design fixture for offline runs |

## Quickstart

The GitHub repo and the npm package are both named `figma-verify`, so after a clone you are in the **repo root** (this folder). The runnable package — including `npm run studio` — is one level down:

```bash
# from the clone root (pookie2006/figma-verify)
git pull origin main          # needed if this checkout predates the studio server
cd figma-verify               # the inner package, the one with src/studio/server.ts
npm install
npx playwright install chromium
export FIGMA_TOKEN=figd_...   # same terminal you start the studio from
npm run studio                # http://127.0.0.1:4174
```

`npm run studio` from the **repo root** also works (it forwards into the inner package), as long as you have pulled a revision that includes that script. If you see `Missing script: "studio"`, this checkout is older than the studio server — `git pull origin main` and try again. Do not run it from a leftover copy under Downloads that was never updated.

See the full documentation in [`figma-verify/README.md`](figma-verify/README.md) for MCP registration (Cursor, Claude Code, VS Code), the `verify_implementation` and `get_design_spec` tools, CLI usage, tolerances, and the severity model.

## License

[MIT](LICENSE)
