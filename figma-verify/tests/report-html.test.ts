import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "../src/report/render-html.js";
import { diffMatches } from "../src/diff/diff.js";
import { DEFAULT_TOLERANCES } from "../src/config.js";
import type { MatchResult, NormalizedElement } from "../src/types.js";

function el(partial: Partial<NormalizedElement> & { id: string }): NormalizedElement {
  return {
    role: "container",
    name: partial.id,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    styles: {},
    childIds: [],
    ...partial,
  };
}

function buildInput() {
  const frame = el({ id: "frame", name: "Test Frame", bounds: { x: 0, y: 0, w: 800, h: 600 } });
  const design = [
    el({
      id: "d1",
      name: "Title </script> sneaky",
      role: "text",
      text: "hello world",
      bounds: { x: 10, y: 10, w: 200, h: 30 },
      styles: { textColor: "#111111", fontSize: 24 },
      parentId: "frame",
    }),
    el({ id: "d2", name: "Ghost", bounds: { x: 10, y: 60, w: 100, h: 40 }, parentId: "frame" }),
  ];
  const dom = [
    el({
      id: "w1",
      role: "text",
      text: "hello world",
      bounds: { x: 10, y: 10, w: 200, h: 30 },
      styles: { textColor: "#111111", fontSize: 20 },
      selector: ".title",
    }),
  ];
  const matches: MatchResult[] = [
    { designId: "d1", domId: "w1", method: "text", selector: ".title" },
    { designId: "d2", method: "unmatched" },
  ];
  const report = diffMatches(design, dom, matches, DEFAULT_TOLERANCES, {
    frameName: "Test Frame",
    viewportWidth: 800,
  });
  return { report, design: [frame, ...design] };
}

describe("renderHtmlReport", () => {
  const { report, design } = buildInput();
  const html = renderHtmlReport({ report, design, screenshotBase64: "iVBORw0KGgo=" });

  it("embeds the full report JSON in a data block", () => {
    expect(html).toContain('id="fv-data"');
    expect(html).toContain('"fidelityScore"');
    expect(html).toContain('"scores"');
    expect(html).toContain('"designBounds"');
  });

  it("escapes </script> inside embedded data so the document stays intact", () => {
    // The sneaky element name must not appear as a raw closing script tag.
    const dataBlock = html.split('id="fv-data">')[1]!.split("</script>")[0]!;
    expect(dataBlock).toContain("sneaky");
    expect(dataBlock).not.toContain("</script>");
  });

  it("embeds the screenshot as a data URI (no external resources)", () => {
    expect(html).toContain("iVBORw0KGgo=");
    expect(/(src|href)=["']https?:/i.test(html)).toBe(false);
    expect(html).not.toContain("@import");
  });

  it("includes the viewer scaffolding: panes, score panel, profile switcher", () => {
    expect(html).toContain('id="fv-design-stage"');
    expect(html).toContain('id="fv-impl-stage"');
    expect(html).toContain('id="fv-profile"');
    expect(html).toContain('id="fv-breakdown"');
  });

  it("includes the editor chrome: toolbar, layers tree, canvas, inspect panel, drawer", () => {
    expect(html).toContain('id="fv-mode"');
    expect(html).toContain('id="fv-zoom"');
    expect(html).toContain('id="fv-onion-slider"');
    expect(html).toContain('id="fv-tree"');
    expect(html).toContain('id="fv-inspect"');
    expect(html).toContain('id="fv-swipe-handle"');
    expect(html).toContain('id="fv-gauge"');
    expect(html).toContain('id="fv-grade"');
    expect(html).toContain('id="fv-categories"');
    expect(html).toContain('id="fv-sev-pills"');
    expect(html).toContain('id="fv-show-cascade"');
    expect(html).toContain('id="fv-legend"');
    expect(html).toContain('id="fv-overlay-toggle"');
    expect(html).toContain('id="fv-drawer"');
  });

  it("renders without a screenshot too", () => {
    const noShot = renderHtmlReport({ report, design });
    expect(noShot).toContain('"screenshot":null');
  });

  it("has a single accessible h1 naming the report and frame", () => {
    const h1Matches = html.match(/<h1[\s>]/g) ?? [];
    expect(h1Matches).toHaveLength(1);
    expect(html).toContain("Figma Verify");
    expect(html).toContain("report — Test Frame");
  });

  it("does not clone Figma's rainbow brand mark", () => {
    expect(html).not.toContain("conic-gradient");
    expect(html).not.toMatch(/#F24E1E|#A259FF|#1ABCFE|#0ACF83/);
  });

  it("uses a distinct accent (not Figma blue #0D99FF) for interactive elements", () => {
    expect(html).not.toContain("#0D99FF");
  });

  it("sets a meaningful alt text on the implementation screenshot", () => {
    expect(html).toContain("Screenshot of the live implementation");
  });

  it("opens the fix-instructions drawer by default when there is work to do, and it is agent-loop ready", () => {
    // This fixture has a missing element (d2), so fixInstructions is non-empty.
    expect(report.fixInstructions.length).toBeGreaterThan(0);
    const drawerTag = html.match(/<div id="fv-drawer"[^>]*>/)?.[0] ?? "";
    expect(drawerTag).not.toContain("collapsed");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Agent-loop ready");
  });

  it("collapses the drawer by default for a perfect report", () => {
    const cleanDom: NormalizedElement[] = [
      el({
        id: "w1",
        role: "text",
        text: "hello world",
        bounds: { x: 10, y: 10, w: 200, h: 30 },
        styles: { textColor: "#111111", fontSize: 24 },
        selector: ".title",
      }),
      el({
        id: "w2",
        bounds: { x: 10, y: 60, w: 100, h: 40 },
      }),
    ];
    const perfectMatches: MatchResult[] = [
      { designId: "d1", domId: "w1", method: "text", selector: ".title" },
      { designId: "d2", domId: "w2", method: "geometry", selector: ".ghost" },
    ];
    const perfectReport = diffMatches(design.slice(1), cleanDom, perfectMatches, DEFAULT_TOLERANCES, {
      frameName: "Test Frame",
      viewportWidth: 800,
    });
    expect(perfectReport.fixInstructions).toHaveLength(0);
    const perfectHtml = renderHtmlReport({ report: perfectReport, design });
    const drawerTag = perfectHtml.match(/<div id="fv-drawer"[^>]*>/)?.[0] ?? "";
    expect(drawerTag).toContain("collapsed");
    expect(perfectHtml).toContain('aria-expanded="false"');
  });

  it("exposes the compare-mode toggle as an accessible radiogroup", () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/role="radio"/);
    expect(html).toContain('aria-checked="true"');
  });

  it("gives the swipe handle a slider role with value bounds", () => {
    expect(html).toMatch(/id="fv-swipe-handle"[^>]*role="slider"/);
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
  });

  it("computes a plain-English summary and root-cause companion line client-side", () => {
    expect(html).toContain("buildSummarySentence");
    expect(html).toContain("missing element");
    expect(html).toContain("Root cause");
  });

  it("never colors a nonzero category deduction as clean/green", () => {
    expect(html).toContain("catColor");
    expect(html).toContain("catDed <= 0");
  });

  it("respects prefers-reduced-motion", () => {
    expect(html).toContain("prefers-reduced-motion: reduce");
  });

  it("includes responsive breakpoints and never lets the canvas collapse to 0 width", () => {
    expect(html).toContain("max-width: 1199.98px");
    expect(html).toContain("max-width: 799.98px");
    expect(html).toContain("#fv-mobile-topbar");
    expect(html).toContain("#fv-tabbar");
  });

  it("includes a copy toast region for confirmation feedback", () => {
    expect(html).toContain('id="fv-toast"');
    expect(html).toContain('role="status"');
  });
});
