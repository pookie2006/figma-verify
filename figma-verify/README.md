# Figma Verify

**An MCP server that lets AI agents check their code against the design — and self-correct until it's pixel-perfect.**

## The gap

Figma's MCP server pushes design context *into* agents (`get_code`, `get_variable_defs`), and agents generate code from it. But nothing closes the loop: no tool lets the agent **verify** that the implementation actually matches the design. Existing comparison tools (Pixelay, Uiprobe, OverlayQA) are human-facing browser overlays — none are callable by an agent.

Figma Verify closes the loop. The agent implements, verifies, reads the drift report, fixes its code, and re-runs until the fidelity score is 100.

```
        ┌────────────────────────────────────────────────┐
        │                    Agent loop                  │
        │                                                │
        │   implement ──► verify_implementation ──► fix  │
        │       ▲                                    │   │
        │       └────────── drift report ◄───────────┘   │
        └────────────────────────────────────────────────┘
```

![Demo: Cursor converging a flawed implementation to pixel-perfect](docs/demo.gif)
*(demo GIF placeholder)*

## Architecture

```
 Figma share URL                          Live URL
       │                                     │
       ▼                                     ▼
┌───────────────┐                   ┌──────────────────┐
│ Figma REST API│                   │ Playwright       │
│ /files/:key/  │                   │ (headless        │
│ nodes         │                   │  Chromium)       │
└──────┬────────┘                   └────────┬─────────┘
       │ node tree                           │ DOM + computed styles
       ▼                                     ▼
┌───────────────┐                   ┌──────────────────┐
│ normalize.ts  │                   │ extract.ts       │
└──────┬────────┘                   └────────┬─────────┘
       │        NormalizedElement[]          │
       └────────────────┬────────────────────┘
                        ▼
              ┌──────────────────┐
              │ matcher.ts       │  text anchors → container LCA → geometry IoU
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ diff.ts          │  tolerances + severity scoring
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ render.ts        │  markdown + JSON drift report,
              └──────────────────┘  fidelity score 0–100
```

Both sources reduce to the same normalized schema — every element becomes
`{ id, role, name, text?, bounds (frame-relative), styles { colors, typography, padding, gap, radius, … } }` —
so matching and diffing are source-agnostic.

### Matching (v1 scope: auto-layout frames)

1. **Text anchors first.** Unique normalized text strings pair design text nodes to DOM text elements directly.
2. **Containers by children.** A design container maps to the lowest common ancestor of its matched text children in the DOM, ties broken by bounding-box IoU.
3. **Leftovers by geometry.** Remaining nodes match greedily on IoU + role above a floor (0.4); below it, the design node is reported **missing** (critical).

The browser viewport width is set to the Figma frame width so coordinates compare 1:1.

### Severity model

| Severity | Meaning | Score deduction |
|---|---|---|
| critical | missing element, wrong text content | −15 |
| high | color, fontFamily, fontWeight, fontSize drift | −5 |
| medium | spacing / size / radius beyond tolerance | −2 |
| low | beyond tolerance but within 2× (noted, not failed) | −0.5 |

Default tolerances: position/size ±2px, spacing/padding/gap ±1px, fontSize ±0.5px, colors compared by RGB distance. All configurable per call.

## Quickstart

```bash
git clone <this-repo> && cd figma-verify
npm install
npx playwright install chromium
```

Get a Figma personal access token at [figma.com/settings](https://www.figma.com/settings) (Security → Personal access tokens) and export it:

```bash
export FIGMA_TOKEN=figd_...
```

### Register in Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "figma-verify": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/figma-verify/src/index.ts"],
      "env": { "FIGMA_TOKEN": "figd_..." }
    }
  }
}
```

Also works in Claude Code (`claude mcp add`) and VS Code — anything that speaks MCP over stdio.

### MCP tools

- **`verify_implementation({ figma_url, live_url, viewport_width?, tolerances? })`** — full drift report: markdown summary plus JSON with per-element diffs (property, expected, actual, severity, CSS selector hint so the agent can locate the element to fix).
- **`get_design_spec({ figma_url })`** — just the normalized design spec, for inspecting the target before/without diffing.

`figma_url` is a "Copy link to selection" URL — it must contain `?node-id=...`.

### CLI (for demos and debugging)

```bash
# Against the real Figma API:
npm run cli -- "https://www.figma.com/design/KEY/name?node-id=1-2" http://localhost:5173

# Offline, using the recorded fixture (no token needed):
npm run demo:serve                 # serves demo/ on :4173 (separate terminal)
npm run cli -- --fixture demo/design-fixture.json http://localhost:4173
```

Exit code 0 = fidelity 100, 1 = drift found, 2 = error.

## Demo

`demo/index.html` is a deliberately flawed implementation of the `Signup Card` design frame (recorded in `demo/design-fixture.json`). Five flaws are planted:

1. Wrong brand color on the button (`#7c3aed` instead of `#4f46e5`) — **high**
2. Wrong title font size (20px instead of 24px) — **high**
3. Missing element (the guarantee badge) — **critical**
4. Wrong card padding (24px instead of 32px) — **medium**
5. Wrong card border radius (8px instead of 16px) — **medium**

Run the CLI as above and watch the report catch all five. Point an agent at the report and it fixes the page; re-run until the score is 100.

## Tests

```bash
npm test
```

Fixture-driven; no network and no `FIGMA_TOKEN` required. The e2e suite spins up a local static server for the demo page and needs Playwright's Chromium.

## Honest v1 limitations

- **Auto-layout frames only.** Free-floating/absolute Figma layouts still diff, but position noise makes reports less useful.
- **Single viewport.** One frame = one width; responsive behavior isn't checked (run per-breakpoint frame instead).
- **No visual pixel diff.** Comparison is structural (computed styles), so gradients, shadows, image content, and blend modes aren't compared yet.
- **Max corner radius only** when Figma corners differ per-corner.
- **Text matching assumes reasonably unique strings.** Heavily repeated text (e.g. ten identical "Edit" buttons) falls back to geometric disambiguation.
- **Component states** (hover, pressed) aren't exercised — only the initial render.

## License

MIT
