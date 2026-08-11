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
 * Information architecture (first paint, in order): the fidelity score for
 * the active profile, a root-cause companion line, a one-sentence plain
 * English summary, severity pills (root-cause counts by default), the
 * design/implementation canvas, and — open by default whenever there is
 * anything to fix — the ordered agent fix instructions. A layers tree and
 * a contextual per-element inspector round out the workspace. The layout
 * collapses to overlay drawers at ≤1199px and a single-column mobile view
 * with a sticky score header and a canvas/fixes tab bar at ≤799px.
 */
export function renderHtmlReport(input: HtmlReportInput): string {
  const { report } = input;
  const payload = {
    report,
    design: input.design,
    screenshot: input.screenshotBase64 ?? null,
  };
  // \u003c-escape so "</script>" inside strings cannot close the data block.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const hasFixes = report.fixInstructions.length > 0;

  return (
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Figma Verify — ${escapeHtml(report.frameName)}</title>
<style>${CSS}</style>
</head>
<body class="mode-side">
<div id="fv-scrim"></div>
<header id="fv-toolbar">
  <h1 class="brand">
    <svg class="brand-mark" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.2" y="1.2" width="17.6" height="17.6" rx="5" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M5.6 10.4l3 3 6-6.8" fill="none" stroke="var(--accent)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <span>Figma Verify</span>
    <span class="brand-frame">report — ${escapeHtml(report.frameName)}</span>
  </h1>
  <div class="meta" id="fv-meta"></div>
  <button class="panel-toggle-btn" id="fv-toggle-layers" type="button" aria-expanded="false" aria-controls="fv-layers">Layers</button>
  <div class="tb-group seg" id="fv-mode" role="radiogroup" aria-label="Compare mode">
    <button type="button" data-mode="side" class="active" role="radio" aria-checked="true" tabindex="0">Side by side</button>
    <button type="button" data-mode="overlay" role="radio" aria-checked="false" tabindex="-1">Overlay</button>
    <button type="button" data-mode="swipe" role="radio" aria-checked="false" tabindex="-1">Swipe</button>
  </div>
  <div class="tb-group" id="fv-onion" hidden>
    <label for="fv-onion-slider">Design opacity</label>
    <input type="range" id="fv-onion-slider" min="0" max="100" value="50" aria-label="Design opacity" />
  </div>
  <div class="tb-group zoom">
    <button type="button" id="fv-zoom-out" title="Zoom out (- key)">&minus;</button>
    <span id="fv-zoom" aria-live="polite">100%</span>
    <button type="button" id="fv-zoom-in" title="Zoom in (+ key)">+</button>
    <button type="button" id="fv-zoom-fit" title="Fit to view (0 key)">Fit</button>
    <button type="button" id="fv-zoom-100" title="Actual size (1 key)">100%</button>
  </div>
  <button id="fv-overlay-toggle" type="button" aria-pressed="true"><span class="tog-dot"></span>Markers on</button>
  <button class="panel-toggle-btn" id="fv-toggle-inspect" type="button" aria-expanded="false" aria-controls="fv-inspect">Inspect</button>
</header>
<div id="fv-mobile-topbar">
  <span class="m-grade" id="fv-m-grade"></span>
  <span class="m-score" id="fv-m-score"></span>
  <span class="m-companion" id="fv-m-companion"></span>
</div>
<div id="fv-editor">
  <aside id="fv-layers">
    <div class="panel-head">Layers<button class="panel-close" id="fv-close-layers" type="button" aria-label="Close layers panel">&times;</button></div>
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
      <div id="fv-swipe-handle" role="slider" tabindex="0" aria-label="Swipe position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" hidden><div class="grip"></div></div>
    </div>
    <div id="fv-legend"></div>
  </div>
  <aside id="fv-inspect">
    <div class="panel-head" style="border-bottom:none;">Inspect<button class="panel-close" id="fv-close-inspect" type="button" aria-label="Close inspect panel">&times;</button></div>
    <div id="fv-inspect-score">
      <div class="gauge-wrap">
        <svg id="fv-gauge" viewBox="0 0 96 96" width="116" height="116" aria-hidden="true">
          <circle class="gauge-bg" cx="48" cy="48" r="40" />
          <circle class="gauge-fg" id="fv-gauge-arc" cx="48" cy="48" r="40" />
        </svg>
        <div class="gauge-center">
          <span class="grade" id="fv-grade"></span>
          <span class="gauge-score" id="fv-score"></span>
        </div>
      </div>
      <div class="score-title">Fidelity Score</div>
      <div class="companion-line" id="fv-companion"></div>
      <p class="summary-sentence" id="fv-summary"></p>
      <div class="pill-row" id="fv-sev-pills"></div>
      <div class="pill-hint" id="fv-pill-hint">Click a pill to filter markers</div>
      <label class="cascade-check"><input type="checkbox" id="fv-show-cascade" /> Show cascade markers</label>
      <div class="side-label">Score breakdown</div>
      <div id="fv-categories"></div>
      <div class="side-label">Scoring profile</div>
      <select id="fv-profile" aria-label="Scoring profile"></select>
      <p class="profile-desc" id="fv-profile-desc"></p>
      <details class="walkthrough">
        <summary>Score walkthrough (root causes first)</summary>
        <div id="fv-breakdown"></div>
      </details>
      <p class="agent-note">This report is <strong>agent-loop ready</strong>: feed the fix instructions below to the agent that built this page, then re-run <code>verify_implementation</code> until the score is 100.</p>
    </div>
    <div id="fv-inspect-el" hidden>
      <div id="fv-detail"></div>
    </div>
  </aside>
</div>
<div id="fv-drawer" class="${hasFixes ? "" : "collapsed"}">
  <div class="drawer-head">
    <button id="fv-drawer-toggle" type="button" aria-expanded="${hasFixes ? "true" : "false"}" aria-controls="fv-drawer-body">
      <span class="chev">&#9662;</span>
      Fix instructions (for the implementing agent)
      <span class="count-badge" id="fv-drawer-count"></span>
    </button>
    <button id="fv-copy-ins" type="button">Copy as agent prompt</button>
  </div>
  <div id="fv-drawer-body"><div id="fv-instructions"></div></div>
</div>
<div id="fv-tabbar">
  <button id="fv-tab-canvas" class="active" type="button">Canvas</button>
  <button id="fv-tab-fixes" type="button">Fix instructions <span class="tab-count" id="fv-tab-fixes-count"></span></button>
</div>
<div id="fv-toast" role="status" aria-live="polite"></div>
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
