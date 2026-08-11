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

  it("includes the Figma-editor chrome: toolbar, layers tree, canvas, inspect panel, drawer", () => {
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
    expect(html).toContain('id="fv-hide-cascade"');
    expect(html).toContain('id="fv-legend"');
    expect(html).toContain('id="fv-overlay-toggle"');
    expect(html).toContain('id="fv-drawer"');
  });

  it("renders without a screenshot too", () => {
    const noShot = renderHtmlReport({ report, design });
    expect(noShot).toContain('"screenshot":null');
  });
});
