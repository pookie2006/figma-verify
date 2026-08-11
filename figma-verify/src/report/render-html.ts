import type { DriftReport, NormalizedElement } from "../types.js";
import { CSS } from "./html/css.js";
import { VIEWER_JS } from "./html/viewer.js";

export interface HtmlReportInput {
  report: DriftReport;
  /** Full normalized design including the root frame at index 0. */
  design: NormalizedElement[];
  /** PNG screenshot of the implementation, base64-encoded. */
  screenshotBase64?: string;
}

/**
 * Render a fully self-contained interactive HTML report: no external
 * resources, all data embedded as JSON, viewer logic inlined.
 *
 * The viewer is styled after the Figma editor itself: a light three-panel
 * layout with a layers tree, a pannable/zoomable dotted canvas holding the
 * design and implementation frames (side-by-side, onion-skin overlay, or
 * swipe compare), and a contextual inspect panel with the fidelity score
 * dashboard and per-element diffs.
 */
export function renderHtmlReport(input: HtmlReportInput): string {
  const payload = {
    report: input.report,
    design: input.design,
    screenshot: input.screenshotBase64 ?? null,
  };
  // \u003c-escape so "</script>" inside strings cannot close the data block.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");

  return (
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Figma Verify — ${escapeHtml(input.report.frameName)}</title>
<style>${CSS}</style>
</head>
<body class="mode-side">
<div id="fv-toolbar">
  <div class="brand"><span class="brand-mark"></span>Figma Verify</div>
  <div class="meta" id="fv-meta"></div>
  <div class="tb-group seg" id="fv-mode">
    <button type="button" data-mode="side" class="active">Side by side</button>
    <button type="button" data-mode="overlay">Overlay</button>
    <button type="button" data-mode="swipe">Swipe</button>
  </div>
  <div class="tb-group" id="fv-onion" hidden>
    <span>Design opacity</span>
    <input type="range" id="fv-onion-slider" min="0" max="100" value="50" />
  </div>
  <div class="tb-group zoom">
    <button type="button" id="fv-zoom-out" title="Zoom out (-)">&minus;</button>
    <span id="fv-zoom">100%</span>
    <button type="button" id="fv-zoom-in" title="Zoom in (+)">+</button>
    <button type="button" id="fv-zoom-fit" title="Fit (0)">Fit</button>
    <button type="button" id="fv-zoom-100" title="Actual size (1)">100%</button>
  </div>
  <button id="fv-overlay-toggle" type="button" aria-pressed="true"><span class="tog-dot"></span>Markers on</button>
</div>
<div id="fv-editor">
  <aside id="fv-layers">
    <div class="panel-head">Layers</div>
    <div id="fv-tree"></div>
  </aside>
  <div id="fv-canvas">
    <div id="fv-world">
      <div class="frame-block" id="fv-design-block">
        <div class="frame-label"><span id="fv-design-label"></span></div>
        <div class="stage" id="fv-design-stage"></div>
      </div>
      <div class="frame-block" id="fv-impl-block">
        <div class="frame-label"><span id="fv-impl-label"></span></div>
        <div class="stage" id="fv-impl-stage"></div>
      </div>
      <div id="fv-swipe-handle" hidden><div class="grip"></div></div>
    </div>
    <div id="fv-legend"></div>
  </div>
  <aside id="fv-inspect">
    <div id="fv-inspect-score">
      <div class="gauge-wrap">
        <svg id="fv-gauge" viewBox="0 0 96 96" width="120" height="120" aria-hidden="true">
          <circle class="gauge-bg" cx="48" cy="48" r="40" />
          <circle class="gauge-fg" id="fv-gauge-arc" cx="48" cy="48" r="40" />
        </svg>
        <div class="gauge-center">
          <span class="grade" id="fv-grade"></span>
          <span class="gauge-score" id="fv-score"></span>
        </div>
      </div>
      <div class="score-title">Fidelity Score</div>
      <div class="score-sub" id="fv-score-sub"></div>
      <div class="pill-row" id="fv-sev-pills"></div>
      <div class="pill-hint">Click a pill to filter markers</div>
      <label class="cascade-check"><input type="checkbox" id="fv-hide-cascade" /> Hide cascade-only markers</label>
      <div class="side-label">Score breakdown</div>
      <div id="fv-categories"></div>
      <div class="side-label">Scoring profile</div>
      <select id="fv-profile"></select>
      <p class="profile-desc" id="fv-profile-desc"></p>
      <details class="walkthrough">
        <summary>Score walkthrough</summary>
        <div id="fv-breakdown"></div>
      </details>
    </div>
    <div id="fv-inspect-el" hidden>
      <div id="fv-detail"></div>
    </div>
  </aside>
</div>
<div id="fv-drawer" class="collapsed">
  <div class="drawer-head">
    <button id="fv-drawer-toggle" type="button">
      <span class="chev">&#9662;</span>
      Fix instructions (for the implementing agent)
      <span class="count-badge" id="fv-drawer-count"></span>
    </button>
    <button id="fv-copy-ins" type="button">Copy as agent prompt</button>
  </div>
  <div id="fv-drawer-body"><div id="fv-instructions"></div></div>
</div>
<script type="application/json" id="fv-data">` +
    json +
    `</script>
<script>${VIEWER_JS}</script>
</body>
</html>
`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
