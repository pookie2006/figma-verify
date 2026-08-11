/**
 * Stylesheet for the self-contained HTML report viewer.
 *
 * Original visual identity for Figma Verify: a light, precision-tool UI
 * built entirely from system fonts (no CDN/embedded fonts). A monospace
 * stack is used for scores and measurements (the "verification" register),
 * paired with a plain system sans for UI chrome. One accent (teal) — not
 * Figma blue — drives selection and interactive affordances. Severity
 * colors stay functional; category deduction bars never render "healthy
 * green" for a nonzero deduction.
 */
export const CSS = `
:root {
  --critical: #F0472A; --high: #E8890C; --medium: #C99A02; --low: #8B5CF6; --clean: #12966B;
  --critical-ink: #C3341C; --high-ink: #A8620A; --medium-ink: #8A6C00; --low-ink: #6D3FD6; --clean-ink: #0B7A56;
  --accent: #0E7C7B; --accent-dark: #0A5F5E; --accent-tint: #E4F4F3;
  --chrome: #FFFFFF; --chrome-2: #F6F6F5; --chrome-3: #ECECEA; --border: #E1E1DE; --canvas: #F1F1EE;
  --ink: #1A1B1E; --muted: #6B6E76;
  --font-ui: -apple-system, "Segoe UI", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", "Roboto Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--chrome); color: var(--ink);
  font: 13px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}
button, select, input { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

/* ---- toolbar ---- */
#fv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; min-height: 50px; padding: 6px 16px; background: var(--chrome); border-bottom: 1px solid var(--border); flex-shrink: 0; }
h1.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; font-family: var(--font-ui); }
.brand-mark { flex-shrink: 0; color: var(--ink); }
.brand-frame { font-weight: 500; color: var(--muted); }
.brand-frame::before { content: '\\2014'; margin: 0 6px; color: var(--border); }
.meta { flex: 1 1 auto; min-width: 120px; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta strong { color: var(--ink); font-family: var(--font-mono); font-weight: 600; }
.meta .meta-sep { margin: 0 7px; color: var(--border); }
.agent-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-tint); color: var(--accent-dark); font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; }
.agent-chip::before { content: '\\21bb'; font-size: 11px; }
.tb-group { display: flex; align-items: center; gap: 2px; }
.seg { background: var(--chrome-2); border-radius: 8px; padding: 2px; }
.seg button { border: none; background: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 500; color: var(--muted); cursor: pointer; }
.seg button.active { background: #fff; color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,0.12); font-weight: 600; }
#fv-onion { gap: 6px; color: var(--muted); font-size: 12px; }
#fv-onion input[type=range] { width: 96px; accent-color: var(--accent); }
.zoom { background: var(--chrome-2); border-radius: 8px; padding: 2px; }
.zoom button { border: none; background: none; border-radius: 6px; padding: 4px 8px; font-size: 12px; color: var(--ink); cursor: pointer; }
.zoom button:hover { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.10); }
#fv-zoom { min-width: 44px; text-align: center; font-size: 12px; font-family: var(--font-mono); color: var(--muted); }
#fv-overlay-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; background: var(--chrome-2); border: 1px solid transparent; border-radius: 999px; padding: 5px 12px; cursor: pointer; }
#fv-overlay-toggle .tog-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
#fv-overlay-toggle[aria-pressed="false"] { color: var(--muted); }
#fv-overlay-toggle[aria-pressed="false"] .tog-dot { background: #C9C9C9; }
.panel-toggle-btn { display: none; border: 1px solid var(--border); background: var(--chrome-2); border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 500; cursor: pointer; }
.panel-toggle-btn[aria-expanded="true"] { background: var(--accent-tint); border-color: var(--accent); color: var(--accent-dark); }

/* ---- editor body ---- */
#fv-editor { flex: 1; display: flex; min-height: 0; min-width: 0; }
#fv-scrim { display: none; position: fixed; inset: 0; background: rgba(20,20,20,0.28); z-index: 25; }
#fv-scrim.show { display: block; }

/* ---- layers panel ---- */
#fv-layers { width: 248px; flex-shrink: 0; background: var(--chrome); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px 8px; font-size: 11px; font-weight: 700; color: var(--ink); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
.panel-close { display: none; border: none; background: none; color: var(--muted); font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 4px; }
#fv-tree { flex: 1; overflow-y: auto; padding: 4px 4px 12px; }
.tree-row { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px 0 4px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
.tree-row:hover { background: var(--chrome-2); }
.tree-row.selected { background: var(--accent-tint); }
.tree-row.selected .tree-name { color: var(--accent-dark); font-weight: 600; }
.tree-row .chev { width: 12px; flex-shrink: 0; color: var(--muted); font-size: 9px; text-align: center; cursor: pointer; }
.tree-row .layer-ic { width: 14px; flex-shrink: 0; text-align: center; color: var(--muted); font-size: 10px; font-weight: 600; font-family: var(--font-mono); }
.tree-row .layer-ic.ic-frame { position: relative; }
.tree-row .layer-ic.ic-frame::before { content: ''; display: inline-block; width: 8px; height: 8px; border: 1.2px solid var(--muted); border-radius: 1px; }
.tree-row .tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.tree-row .tree-name .missing-tag { color: var(--critical-ink); font-style: italic; font-weight: 600; }
.tree-row .mk { min-width: 15px; height: 15px; padding: 0 3px; border-radius: 4px; font-size: 9.5px; font-weight: 700; font-family: var(--font-mono); line-height: 15px; text-align: center; color: #fff; flex-shrink: 0; }
.tree-row .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tree-kids.hidden { display: none; }

/* ---- canvas ---- */
#fv-canvas { flex: 1; min-width: 0; position: relative; overflow: hidden; background-color: var(--canvas);
  background-image: radial-gradient(#D7D7D3 1px, transparent 1.5px); background-size: 24px 24px; cursor: grab; }
#fv-canvas.panning { cursor: grabbing; }
#fv-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.frame-block { position: absolute; top: 0; }
.frame-label { position: absolute; top: -24px; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 11px; font-family: var(--font-mono); color: var(--accent-dark); font-weight: 500; white-space: nowrap; }
.frame-label .impl-tag { color: var(--clean-ink); }
.stage { position: relative; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.10); color: #17202b; }
.stage img { display: block; }
.fv-el { position: absolute; overflow: hidden; }
body.mode-overlay #fv-impl-block .fv-ov, body.mode-overlay #fv-impl-block .fv-chip { display: none; }
.mode-swipe .frame-label, .mode-overlay #fv-impl-block .frame-label { display: none; }

/* markers */
body.overlays-off .fv-ov, body.overlays-off .fv-chip, body.overlays-off #fv-ghost { display: none !important; }
.fv-ov { position: absolute; border: 1.5px solid transparent; cursor: pointer; }
.fv-ov.flt-hidden, .fv-chip.flt-hidden { display: none; }
.fv-sev-critical { border-color: var(--critical); background: rgba(240,71,42,0.07); }
.fv-sev-high { border-color: var(--high); background: rgba(232,137,12,0.07); }
.fv-sev-medium { border-color: var(--medium); background: rgba(201,154,2,0.08); }
.fv-sev-low { border-color: var(--low); background: rgba(139,92,246,0.06); }
.fv-sev-clean { border-color: transparent; }
.fv-sev-clean:hover { border-color: rgba(18,150,107,0.55); }
.fv-missing { border-style: dashed; }
.fv-ov.hovered { border-color: var(--accent); background: rgba(14,124,123,0.10); }
.fv-ov.hovered::after { content: attr(data-name); position: absolute; left: -1.5px; top: -19px; background: var(--accent); color: #fff; font-size: 10px; font-weight: 500; line-height: 15px; padding: 0 5px; border-radius: 2px; white-space: nowrap; }
.fv-ov.selected { border-color: var(--accent); background: rgba(14,124,123,0.06); }
.fv-ov .h { display: none; position: absolute; width: 7px; height: 7px; background: #fff; border: 1.2px solid var(--accent); }
.fv-ov.selected .h { display: block; }
.fv-ov .h.tl { left: -4px; top: -4px; } .fv-ov .h.tr { right: -4px; top: -4px; }
.fv-ov .h.bl { left: -4px; bottom: -4px; } .fv-ov .h.br { right: -4px; bottom: -4px; }
.fv-chip { position: absolute; z-index: 5; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; color: #fff; font-size: 10px; font-weight: 700; font-family: var(--font-mono); line-height: 16px; text-align: center; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
.fv-chip.chip-dark { color: #1A1B1E; }
#fv-ghost { position: absolute; border: 1.5px dashed var(--critical); pointer-events: none; z-index: 6; }
#fv-ghost .ghost-label { position: absolute; top: -19px; left: 0; background: var(--critical); color: #fff; font-size: 10px; font-family: var(--font-mono); font-weight: 600; line-height: 15px; padding: 0 5px; border-radius: 2px; white-space: nowrap; }
#fv-swipe-handle { position: absolute; z-index: 10; width: 2px; background: var(--accent); cursor: ew-resize; }
#fv-swipe-handle .grip { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 22px; height: 22px; border-radius: 50%; background: var(--accent); box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
#fv-swipe-handle .grip::before { content: '\\2194'; display: block; color: #fff; text-align: center; line-height: 22px; font-size: 11px; }
#fv-legend { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 12px; align-items: center; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 11px; color: var(--muted); box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
#fv-legend .lg { display: flex; align-items: center; gap: 5px; }
#fv-legend .sw { width: 10px; height: 10px; border-radius: 3px; border: 1.5px solid; }

/* ---- mobile score header (hidden ≥800px) ---- */
#fv-mobile-topbar { display: none; align-items: center; gap: 10px; padding: 8px 14px; background: var(--chrome-2); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; }
#fv-mobile-topbar .m-grade { font-family: var(--font-mono); font-weight: 700; font-size: 12px; border: 1px solid var(--border); border-radius: 999px; width: 20px; height: 20px; line-height: 18px; text-align: center; background: #fff; flex-shrink: 0; }
#fv-mobile-topbar .m-score { font-family: var(--font-mono); font-weight: 700; font-size: 18px; flex-shrink: 0; }
#fv-mobile-topbar .m-score::after { content: '/100'; font-size: 11px; font-weight: 500; color: var(--muted); }
#fv-mobile-topbar .m-companion { flex: 1; min-width: 0; font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- inspect panel ---- */
#fv-inspect { width: 288px; flex-shrink: 0; background: var(--chrome); border-left: 1px solid var(--border); overflow-y: auto; }
#fv-inspect-score, #fv-inspect-el { padding: 16px; }
.gauge-wrap { position: relative; width: 116px; margin: 4px auto 2px; }
#fv-gauge { display: block; transform: rotate(-90deg); }
.gauge-bg { fill: none; stroke: #ECECEA; stroke-width: 7; }
.gauge-fg { fill: none; stroke-width: 7; stroke-linecap: round; transition: stroke-dasharray 0.4s ease, stroke 0.4s ease; }
.gauge-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.grade { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; width: 20px; height: 20px; line-height: 18px; text-align: center; margin-bottom: 2px; background: var(--chrome-2); }
.gauge-score { font-family: var(--font-mono); font-size: 30px; font-weight: 700; line-height: 1; }
.score-title { text-align: center; font-weight: 700; font-size: 13px; margin-top: 6px; }
.companion-line { text-align: center; font-family: var(--font-mono); font-size: 11.5px; color: var(--accent-dark); font-weight: 600; margin-top: 4px; }
.summary-sentence { text-align: center; color: var(--muted); font-size: 12px; line-height: 1.45; margin: 6px 0 10px; padding: 0 2px; }
.pill-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 4px; }
.sev-count { font-size: 11px; font-weight: 600; font-family: var(--font-mono); padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--chrome-2); cursor: pointer; user-select: none; }
.sev-count.off { opacity: 0.35; text-decoration: line-through; }
.pill-hint { text-align: center; color: var(--muted); font-size: 10px; margin-bottom: 8px; }
.cascade-check { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11.5px; color: var(--muted); margin-bottom: 4px; cursor: pointer; }
.cascade-check input { accent-color: var(--accent); }
.side-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 8px; }
.cat-row { margin-bottom: 10px; }
.cat-top { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
.cat-top .cat-val { font-weight: 700; font-family: var(--font-mono); }
.cat-bar { height: 5px; border-radius: 999px; background: #EFEFEC; overflow: hidden; }
.cat-bar span { display: block; height: 100%; border-radius: 999px; }
#fv-profile { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; background: var(--chrome-2); }
.profile-desc { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
.walkthrough { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px; }
.walkthrough summary { font-size: 10.5px; font-weight: 700; color: var(--muted); cursor: pointer; text-transform: uppercase; letter-spacing: 0.06em; }
#fv-breakdown { font-size: 11.5px; margin-top: 8px; }
.bd-row { display: flex; justify-content: space-between; gap: 8px; padding: 2.5px 0; border-bottom: 1px dashed var(--chrome-3); }
.bd-row .bd-what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.bd-row .bd-val { flex-shrink: 0; font-family: var(--font-mono); }
.bd-total { font-weight: 700; border-bottom: none; margin-top: 4px; }
.bd-total .bd-what { color: var(--ink); }
.bd-note { color: var(--muted); font-style: italic; padding: 4px 0; }
.cascade-tag { color: var(--muted); font-style: italic; }
.bd-group { border-bottom: 1px dashed var(--chrome-3); padding: 2.5px 0; }
.bd-group summary { display: flex; justify-content: space-between; gap: 8px; cursor: pointer; list-style: none; color: var(--muted); }
.bd-group summary::-webkit-details-marker { display: none; }
.bd-group summary .bd-val { font-family: var(--font-mono); flex-shrink: 0; }
.bd-group-inner { margin: 4px 0 2px 10px; padding-left: 8px; border-left: 2px solid var(--chrome-3); }
.agent-note { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--muted); line-height: 1.5; }
.agent-note strong { color: var(--ink); }

/* inspect (element) view */
#fv-back { display: flex; align-items: center; gap: 8px; border: none; background: none; color: var(--accent-dark); font-size: 12px; font-weight: 600; padding: 0; margin-bottom: 12px; cursor: pointer; }
#fv-back .mini-score { font-family: var(--font-mono); font-weight: 700; color: var(--muted); background: var(--chrome-2); border-radius: 999px; padding: 1px 8px; }
.insp-title { font-size: 13.5px; font-weight: 700; margin-bottom: 2px; }
.insp-meta { color: var(--muted); font-size: 11.5px; margin-bottom: 4px; }
.insp-selector { margin-bottom: 12px; }
code, .copy { font-family: var(--font-mono); font-size: 11px; background: var(--chrome-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.copy { cursor: pointer; }
.copy:hover { border-color: var(--accent); }
.copy.copied { background: var(--accent-tint); border-color: var(--accent); }
.insp-row { padding: 8px 0; border-bottom: 1px solid var(--chrome-3); }
.insp-prop { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.insp-prop .dot { width: 8px; height: 8px; border-radius: 50%; }
.insp-vals { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.insp-vals .arrow { color: var(--muted); }
.insp-delta { color: var(--muted); font-size: 10.5px; margin-top: 3px; }
.insp-clean { color: var(--clean-ink); font-weight: 700; }
.hint { color: var(--muted); font-style: italic; }

/* ---- fix instructions drawer ---- */
#fv-drawer { flex-shrink: 0; border-top: 1px solid var(--border); background: var(--chrome); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; }
#fv-drawer-toggle { display: flex; align-items: center; gap: 8px; border: none; background: none; font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 0; }
#fv-drawer-toggle .chev { color: var(--muted); font-size: 10px; transition: transform 0.15s; }
#fv-drawer.collapsed #fv-drawer-toggle .chev { transform: rotate(180deg); }
#fv-drawer-toggle .count-badge { background: var(--chrome-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; font-size: 10.5px; font-family: var(--font-mono); color: var(--muted); }
#fv-copy-ins { font-size: 12px; font-weight: 700; padding: 6px 14px; border: none; border-radius: 6px; background: var(--accent); color: #fff; cursor: pointer; }
#fv-copy-ins:hover { background: var(--accent-dark); }
#fv-drawer-body { max-height: 32vh; overflow-y: auto; padding: 0 16px 14px; }
#fv-drawer.collapsed #fv-drawer-body { display: none; }
#fv-instructions ol { margin: 0; padding-left: 22px; }
#fv-instructions li { margin-bottom: 10px; }
#fv-instructions .ins-details { margin: 4px 0 0; padding-left: 16px; }
#fv-instructions .ins-details li { margin-bottom: 1px; font-family: var(--font-mono); font-size: 11px; color: #444; list-style: none; }
#fv-instructions .ins-note { color: var(--muted); font-style: italic; font-size: 11.5px; margin-top: 3px; }
.kind-pill { display: inline-block; margin-right: 6px; padding: 0 7px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; background: var(--chrome-2); border: 1px solid var(--border); color: var(--muted); }

/* ---- toast ---- */
#fv-toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 12px); z-index: 60; background: var(--ink); color: #fff; font-size: 12.5px; font-weight: 600; padding: 9px 16px; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); opacity: 0; pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease; }
#fv-toast.show { opacity: 1; transform: translate(-50%, 0); }

/* ---- mobile tab bar (hidden ≥800px) ---- */
#fv-tabbar { display: none; flex-shrink: 0; border-top: 1px solid var(--border); background: var(--chrome); }
#fv-tabbar button { flex: 1; border: none; background: none; padding: 10px 0; font-size: 12.5px; font-weight: 600; color: var(--muted); cursor: pointer; border-top: 2px solid transparent; }
#fv-tabbar button.active { color: var(--accent-dark); border-top-color: var(--accent); }
#fv-tabbar .tab-count { font-family: var(--font-mono); color: inherit; margin-left: 4px; }

/* =========================================================
   Responsive: ≥1200px is the full 3-pane workspace (default).
   ========================================================= */

/* 800–1199px: canvas is primary; layers/inspect become overlay drawers. */
@media (max-width: 1199.98px) {
  #fv-layers, #fv-inspect {
    position: fixed; top: 50px; bottom: 0; width: min(84vw, 300px);
    z-index: 30; box-shadow: 0 8px 28px rgba(0,0,0,0.18);
    transition: transform 0.2s ease;
  }
  #fv-layers { left: 0; transform: translateX(-100%); }
  #fv-inspect { right: 0; transform: translateX(100%); }
  #fv-layers.open, #fv-inspect.open { transform: translateX(0); }
  .panel-toggle-btn { display: inline-flex; }
  .panel-close { display: inline-flex; }
}
@media (min-width: 1200px) {
  .panel-toggle-btn, .panel-close { display: none !important; }
  #fv-scrim { display: none !important; }
}

/* <800px: single column — mobile score header, full-width canvas, sheets, tab bar. */
@media (max-width: 799.98px) {
  #fv-toolbar { padding: 6px 10px; gap: 8px; }
  #fv-toolbar .meta { display: none; }
  #fv-mobile-topbar { display: flex; }
  #fv-layers, #fv-inspect { top: 88px; }
  #fv-drawer { position: fixed; left: 0; right: 0; bottom: 44px; z-index: 20; box-shadow: 0 -6px 20px rgba(0,0,0,0.10); }
  #fv-tabbar { display: flex; }
  body.mobile-fixes #fv-canvas, body.mobile-fixes #fv-legend { display: none; }
  /* Neutralize #fv-editor's flex-grow (its fixed-position children still render) so the drawer can claim the freed space. */
  body.mobile-fixes #fv-editor { flex: 0 0 auto; height: 0; overflow: hidden; }
  body.mobile-fixes #fv-drawer { position: static; box-shadow: none; flex: 1; display: flex; flex-direction: column; min-height: 0; }
  body.mobile-fixes #fv-drawer-body { flex: 1; max-height: none; }
  body.mobile-fixes #fv-drawer.collapsed #fv-drawer-body { display: block; }
}
@media (min-width: 800px) {
  #fv-mobile-topbar, #fv-tabbar { display: none !important; }
}
`;
