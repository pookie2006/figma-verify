# Figma Verify

**An MCP server that lets AI agents check their code against the Figma design — and self-correct until it's pixel-perfect.**

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

```bash
cd figma-verify
npm install
npx playwright install chromium
npm test
```

See the full documentation in [`figma-verify/README.md`](figma-verify/README.md) for MCP registration (Cursor, Claude Code, VS Code), the `verify_implementation` and `get_design_spec` tools, CLI usage, tolerances, and the severity model.

## License

[MIT](LICENSE)
