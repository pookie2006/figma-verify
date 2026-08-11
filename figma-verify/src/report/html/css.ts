/**
 * Stylesheet for the self-contained HTML report viewer.
 *
 * Visual language: the Figma editor. Light chrome, Inter, an 8px grid,
 * Figma-blue (#0D99FF) selection, a dotted neutral canvas, and the Figma
 * brand palette for severity accents.
 */
export const CSS = `
:root {
  --blue: #0D99FF;
  --critical: #F24822; --high: #FFA629; --medium: #FFCD29; --low: #9747FF; --clean: #14AE5C;
  --critical-ink: #D2361E; --high-ink: #B96A00; --medium-ink: #8F6C00; --low-ink: #7B3FE4; --clean-ink: #0E8A4C;
  --chrome: #FFFFFF; --chrome-2: #F5F5F5; --border: #E6E6E6; --canvas: #F0F0F0;
  --ink: #1E1E1E; --muted: #7A7A7A;
}
* { box-sizing: border-box; margin: 0; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--chrome); color: var(--ink);
  font: 12px/1.5 Inter, "SF Pro Text", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-variant-numeric: tabular-nums;
}
button, select, input { font: inherit; color: inherit; }

/* ---- toolbar ---- */
#fv-toolbar { display: flex; align-items: center; gap: 16px; height: 48px; padding: 0 16px; background: var(--chrome); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
.brand-mark { width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0;
  background: conic-gradient(from 0deg, #F24E1E 0 25%, #A259FF 0 50%, #1ABCFE 0 75%, #0ACF83 0 100%); }
.meta { flex: 1; min-width: 0; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-group { display: flex; align-items: center; gap: 2px; }
.seg { background: var(--chrome-2); border-radius: 8px; padding: 2px; }
.seg button { border: none; background: none; border-radius: 6px; padding: 4px 12px; font-size: 11.5px; font-weight: 500; color: var(--muted); cursor: pointer; }
.seg button.active { background: #fff; color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,0.12); font-weight: 600; }
#fv-onion { gap: 6px; color: var(--muted); font-size: 11px; }
#fv-onion input[type=range] { width: 96px; accent-color: var(--blue); }
.zoom { background: var(--chrome-2); border-radius: 8px; padding: 2px; }
.zoom button { border: none; background: none; border-radius: 6px; padding: 4px 8px; font-size: 11.5px; color: var(--ink); cursor: pointer; }
.zoom button:hover { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.10); }
#fv-zoom { min-width: 44px; text-align: center; font-size: 11.5px; color: var(--muted); }
#fv-overlay-toggle { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500; background: var(--chrome-2); border: 1px solid transparent; border-radius: 999px; padding: 5px 12px; cursor: pointer; }
#fv-overlay-toggle .tog-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); }
#fv-overlay-toggle[aria-pressed="false"] { color: var(--muted); }
#fv-overlay-toggle[aria-pressed="false"] .tog-dot { background: #C9C9C9; }

/* ---- editor body ---- */
#fv-editor { flex: 1; display: flex; min-height: 0; }

/* ---- layers panel ---- */
#fv-layers { width: 248px; flex-shrink: 0; background: var(--chrome); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.panel-head { padding: 10px 16px 8px; font-size: 11px; font-weight: 600; color: var(--ink); border-bottom: 1px solid var(--border); }
#fv-tree { flex: 1; overflow-y: auto; padding: 4px 4px 12px; }
.tree-row { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px 0 4px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
.tree-row:hover { background: var(--chrome-2); }
.tree-row.selected { background: #E5F4FF; }
.tree-row.selected .tree-name { color: #007BE5; font-weight: 600; }
.tree-row .chev { width: 12px; flex-shrink: 0; color: var(--muted); font-size: 9px; text-align: center; cursor: pointer; }
.tree-row .layer-ic { width: 14px; flex-shrink: 0; text-align: center; color: var(--muted); font-size: 10px; font-weight: 600; }
.tree-row .layer-ic.ic-frame { position: relative; }
.tree-row .layer-ic.ic-frame::before { content: ''; display: inline-block; width: 8px; height: 8px; border: 1.2px solid var(--muted); border-radius: 1px; }
.tree-row .tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; }
.tree-row .tree-name .missing-tag { color: var(--critical-ink); font-style: italic; }
.tree-row .mk { min-width: 15px; height: 15px; padding: 0 3px; border-radius: 4px; font-size: 9.5px; font-weight: 700; line-height: 15px; text-align: center; color: #fff; flex-shrink: 0; }
.tree-row .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tree-kids.hidden { display: none; }

/* ---- canvas ---- */
#fv-canvas { flex: 1; min-width: 0; position: relative; overflow: hidden; background-color: var(--canvas);
  background-image: radial-gradient(#D9D9D9 1px, transparent 1.5px); background-size: 24px 24px; cursor: grab; }
#fv-canvas.panning { cursor: grabbing; }
#fv-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.frame-block { position: absolute; top: 0; }
.frame-label { position: absolute; top: -24px; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 11px; color: var(--blue); font-weight: 500; white-space: nowrap; }
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
.fv-sev-critical { border-color: var(--critical); background: rgba(242,72,34,0.07); }
.fv-sev-high { border-color: var(--high); background: rgba(255,166,41,0.07); }
.fv-sev-medium { border-color: var(--medium); background: rgba(255,205,41,0.08); }
.fv-sev-low { border-color: var(--low); background: rgba(151,71,255,0.06); }
.fv-sev-clean { border-color: transparent; }
.fv-sev-clean:hover { border-color: rgba(20,174,92,0.55); }
.fv-missing { border-style: dashed; }
.fv-ov.hovered { border-color: var(--blue); background: rgba(13,153,255,0.08); }
.fv-ov.hovered::after { content: attr(data-name); position: absolute; left: -1.5px; top: -19px; background: var(--blue); color: #fff; font-size: 10px; font-weight: 500; line-height: 15px; padding: 0 5px; border-radius: 2px; white-space: nowrap; }
.fv-ov.selected { border-color: var(--blue); background: rgba(13,153,255,0.05); }
.fv-ov .h { display: none; position: absolute; width: 7px; height: 7px; background: #fff; border: 1.2px solid var(--blue); }
.fv-ov.selected .h { display: block; }
.fv-ov .h.tl { left: -4px; top: -4px; } .fv-ov .h.tr { right: -4px; top: -4px; }
.fv-ov .h.bl { left: -4px; bottom: -4px; } .fv-ov .h.br { right: -4px; bottom: -4px; }
.fv-chip { position: absolute; z-index: 5; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
.fv-chip.chip-dark { color: #1E1E1E; }
#fv-ghost { position: absolute; border: 1.5px dashed var(--critical); pointer-events: none; z-index: 6; }
#fv-ghost .ghost-label { position: absolute; top: -19px; left: 0; background: var(--critical); color: #fff; font-size: 10px; font-weight: 600; line-height: 15px; padding: 0 5px; border-radius: 2px; white-space: nowrap; }
#fv-swipe-handle { position: absolute; z-index: 10; width: 2px; background: var(--blue); cursor: ew-resize; }
#fv-swipe-handle .grip { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 22px; height: 22px; border-radius: 50%; background: var(--blue); box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
#fv-swipe-handle .grip::before { content: '\\2194'; display: block; color: #fff; text-align: center; line-height: 22px; font-size: 11px; }
#fv-legend { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 12px; align-items: center; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 11px; color: var(--muted); box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
#fv-legend .lg { display: flex; align-items: center; gap: 5px; }
#fv-legend .sw { width: 10px; height: 10px; border-radius: 3px; border: 1.5px solid; }

/* ---- inspect panel ---- */
#fv-inspect { width: 280px; flex-shrink: 0; background: var(--chrome); border-left: 1px solid var(--border); overflow-y: auto; }
#fv-inspect-score, #fv-inspect-el { padding: 16px; }
.gauge-wrap { position: relative; width: 120px; margin: 4px auto 2px; }
#fv-gauge { display: block; transform: rotate(-90deg); }
.gauge-bg { fill: none; stroke: #ECECEC; stroke-width: 7; }
.gauge-fg { fill: none; stroke-width: 7; stroke-linecap: round; transition: stroke-dasharray 0.4s ease, stroke 0.4s ease; }
.gauge-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.grade { font-size: 11px; font-weight: 700; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; width: 20px; height: 20px; line-height: 18px; text-align: center; margin-bottom: 2px; background: var(--chrome-2); }
.gauge-score { font-size: 28px; font-weight: 700; line-height: 1; }
.score-title { text-align: center; font-weight: 600; font-size: 13px; margin-top: 6px; }
.score-sub { text-align: center; color: var(--muted); font-size: 11px; margin-bottom: 10px; }
.pill-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 6px; }
.sev-count { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--chrome-2); cursor: pointer; user-select: none; }
.sev-count.off { opacity: 0.35; text-decoration: line-through; }
.pill-hint { text-align: center; color: var(--muted); font-size: 10px; margin-bottom: 8px; }
.cascade-check { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: var(--muted); margin-bottom: 4px; cursor: pointer; }
.cascade-check input { accent-color: var(--blue); }
.side-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 8px; }
.cat-row { margin-bottom: 10px; }
.cat-top { display: flex; justify-content: space-between; font-size: 11.5px; margin-bottom: 4px; }
.cat-top .cat-val { font-weight: 600; }
.cat-bar { height: 4px; border-radius: 999px; background: #EFEFEF; overflow: hidden; }
.cat-bar span { display: block; height: 100%; border-radius: 999px; }
#fv-profile { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 11.5px; background: var(--chrome-2); }
.profile-desc { font-size: 11px; color: var(--muted); margin-top: 6px; }
.walkthrough { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px; }
.walkthrough summary { font-size: 10px; font-weight: 600; color: var(--muted); cursor: pointer; text-transform: uppercase; letter-spacing: 0.06em; }
#fv-breakdown { font-size: 11px; margin-top: 8px; }
.bd-row { display: flex; justify-content: space-between; gap: 8px; padding: 2.5px 0; border-bottom: 1px dashed #F0F0F0; }
.bd-row .bd-what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.bd-row .bd-val { flex-shrink: 0; }
.bd-total { font-weight: 700; border-bottom: none; margin-top: 4px; }
.bd-total .bd-what { color: var(--ink); }
.bd-note { color: var(--muted); font-style: italic; padding: 4px 0; }
.cascade-tag { color: var(--muted); font-style: italic; }

/* inspect (element) view */
#fv-back { display: flex; align-items: center; gap: 4px; border: none; background: none; color: var(--blue); font-size: 11.5px; font-weight: 500; padding: 0; margin-bottom: 12px; cursor: pointer; }
.insp-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.insp-meta { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
.insp-selector { margin-bottom: 12px; }
code, .copy { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: var(--chrome-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.copy { cursor: pointer; }
.copy:hover { border-color: var(--blue); }
.copy.copied { background: #DCF5E8; border-color: var(--clean); }
.insp-row { padding: 8px 0; border-bottom: 1px solid #F0F0F0; }
.insp-prop { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; }
.insp-prop .dot { width: 8px; height: 8px; border-radius: 50%; }
.insp-vals { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.insp-vals .arrow { color: var(--muted); }
.insp-delta { color: var(--muted); font-size: 10.5px; margin-top: 3px; }
.insp-clean { color: var(--clean-ink); font-weight: 600; }
.hint { color: var(--muted); font-style: italic; }

/* ---- fix instructions drawer ---- */
#fv-drawer { flex-shrink: 0; border-top: 1px solid var(--border); background: var(--chrome); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; }
#fv-drawer-toggle { display: flex; align-items: center; gap: 8px; border: none; background: none; font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }
#fv-drawer-toggle .chev { color: var(--muted); font-size: 10px; transition: transform 0.15s; }
#fv-drawer.collapsed #fv-drawer-toggle .chev { transform: rotate(180deg); }
#fv-drawer-toggle .count-badge { background: var(--chrome-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; font-size: 10.5px; color: var(--muted); }
#fv-copy-ins { font-size: 11.5px; font-weight: 600; padding: 5px 14px; border: none; border-radius: 6px; background: var(--blue); color: #fff; cursor: pointer; }
#fv-copy-ins:hover { background: #007BE5; }
#fv-drawer-body { max-height: 30vh; overflow-y: auto; padding: 0 16px 14px; }
#fv-drawer.collapsed #fv-drawer-body { display: none; }
#fv-instructions ol { margin: 0; padding-left: 22px; }
#fv-instructions li { margin-bottom: 10px; }
#fv-instructions .ins-details { margin: 4px 0 0; padding-left: 16px; }
#fv-instructions .ins-details li { margin-bottom: 1px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #555; list-style: none; }
#fv-instructions .ins-note { color: var(--muted); font-style: italic; font-size: 11.5px; margin-top: 3px; }
.kind-pill { display: inline-block; margin-right: 6px; padding: 0 7px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; background: var(--chrome-2); border: 1px solid var(--border); color: var(--muted); }
`;
