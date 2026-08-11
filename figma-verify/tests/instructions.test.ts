import { describe, expect, it } from "vitest";
import { generateFixInstructions, renderInstructionsMarkdown } from "../src/report/instructions.js";
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

/**
 * Miniature version of the demo scenario: a card with wrong padding and
 * button color, a text typo, a residual width drift, and a missing badge
 * (with a text child) — enough to exercise every instruction kind.
 */
function buildScenario() {
  const design = [
    el({
      id: "card",
      name: "Card",
      styles: { paddingTop: 32, paddingRight: 32, paddingBottom: 32, paddingLeft: 32 },
      childIds: ["title", "button", "badge"],
      bounds: { x: 0, y: 0, w: 400, h: 300 },
    }),
    el({
      id: "title",
      name: "Title",
      role: "text",
      text: "create your account",
      parentId: "card",
      bounds: { x: 32, y: 32, w: 336, h: 32 },
    }),
    el({
      id: "button",
      name: "Button",
      styles: { backgroundColor: "#4f46e5", borderRadius: 8 },
      parentId: "card",
      bounds: { x: 32, y: 84, w: 336, h: 48 },
    }),
    el({
      id: "badge",
      name: "Badge",
      styles: { backgroundColor: "#ecfdf5", borderRadius: 14 },
      parentId: "card",
      childIds: ["badge-label"],
      bounds: { x: 32, y: 152, w: 336, h: 28 },
    }),
    el({
      id: "badge-label",
      name: "Badge Label",
      role: "text",
      text: "14-day money-back guarantee",
      styles: { textColor: "#047857", fontSize: 13, fontWeight: 600 },
      parentId: "badge",
      bounds: { x: 32, y: 152, w: 336, h: 28 },
    }),
  ];
  const dom = [
    el({
      id: "w-card",
      styles: { paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 },
      bounds: { x: 0, y: 0, w: 400, h: 300 },
      selector: ".card",
    }),
    el({
      id: "w-title",
      role: "text",
      text: "create your acount", // typo
      bounds: { x: 24, y: 24, w: 352, h: 32 },
      selector: ".card > .title",
    }),
    el({
      id: "w-button",
      styles: { backgroundColor: "#7c3aed", borderRadius: 8 },
      bounds: { x: 24, y: 76, w: 300, h: 48 }, // width off beyond cascade explanation? still cascade-tagged
      selector: ".card > .button",
    }),
  ];
  const matches: MatchResult[] = [
    { designId: "card", domId: "w-card", method: "container", selector: ".card" },
    { designId: "title", domId: "w-title", method: "text", selector: ".card > .title" },
    { designId: "button", domId: "w-button", method: "geometry", selector: ".card > .button" },
    { designId: "badge", method: "unmatched" },
    { designId: "badge-label", method: "unmatched" },
  ];
  const report = diffMatches(design, dom, matches, DEFAULT_TOLERANCES, {
    frameName: "F",
    viewportWidth: 400,
  });
  return { report, design };
}

describe("generateFixInstructions", () => {
  const { report } = buildScenario();
  const instructions = report.fixInstructions;

  it("orders steps root-cause first: create, text, style, layout", () => {
    const kinds = instructions.map((i) => i.kind);
    const firstOf = (k: string) => kinds.indexOf(k as never);
    expect(firstOf("create")).toBe(0);
    expect(firstOf("create")).toBeLessThan(firstOf("text"));
    expect(firstOf("text")).toBeLessThan(firstOf("style"));
    expect(firstOf("style")).toBeLessThan(firstOf("layout"));
    expect(instructions.map((i, idx) => i.step === idx + 1).every(Boolean)).toBe(true);
  });

  it("emits one create step for the missing badge with its child folded in", () => {
    const creates = instructions.filter((i) => i.kind === "create");
    expect(creates).toHaveLength(1);
    const badge = creates[0]!;
    expect(badge.summary).toContain('Create the missing container "Badge"');
    expect(badge.summary).toContain("`.card`"); // parent selector
    expect(badge.details.join("\n")).toContain("background-color: #ecfdf5");
    expect(badge.details.join("\n")).toContain("border-radius: 14px");
    // Child spec folded into the same step:
    expect(badge.details.join("\n")).toContain('contains text "Badge Label"');
    expect(badge.details.join("\n")).toContain('"14-day money-back guarantee"');
    expect(badge.details.join("\n")).toContain("font-size: 13px");
  });

  it("emits a text correction with exact expected content", () => {
    const text = instructions.find((i) => i.kind === "text")!;
    expect(text.summary).toContain('"create your account"');
    expect(text.summary).toContain('"create your acount"');
    expect(text.summary).toContain("`.card > .title`");
  });

  it("emits a style fix with CSS property names and values", () => {
    const style = instructions.find((i) => i.kind === "style")!;
    expect(style.selector).toBe(".card > .button");
    expect(style.details).toContainEqual(expect.stringContaining("background-color: #4f46e5"));
    expect(style.details).toContainEqual(expect.stringContaining("currently #7c3aed"));
  });

  it("collapses four equal padding sides into shorthand and notes cascades", () => {
    const layout = instructions.find((i) => i.kind === "layout")!;
    expect(layout.selector).toBe(".card");
    expect(layout.details).toContainEqual(expect.stringContaining("padding: 32px"));
    expect(layout.details.filter((d) => d.includes("padding"))).toHaveLength(1);
    expect(layout.note).toMatch(/resolves \d+ cascade/);
  });

  it("never turns cascade diffs into instructions", () => {
    // Title/button x/y/width drifts are cascades of the card padding fix.
    const targets = instructions.filter((i) => i.kind === "geometry");
    expect(targets).toHaveLength(0);
  });
});

describe("generateFixInstructions: geometry residuals", () => {
  it("emits a last-resort geometry step with a re-verify caveat", () => {
    const design = [el({ id: "hero", name: "Hero", bounds: { x: 0, y: 0, w: 300, h: 100 } })];
    const dom = [el({ id: "w-hero", bounds: { x: 0, y: 0, w: 260, h: 100 }, selector: ".hero" })];
    const matches: MatchResult[] = [{ designId: "hero", domId: "w-hero", method: "geometry", selector: ".hero" }];
    const report = diffMatches(design, dom, matches, DEFAULT_TOLERANCES, { frameName: "F", viewportWidth: 300 });
    const geo = report.fixInstructions.find((i) => i.kind === "geometry")!;
    expect(geo.details).toContainEqual(expect.stringContaining("expected 300px, got 260px"));
    expect(geo.note).toContain("Re-verify");
  });
});

describe("renderInstructionsMarkdown", () => {
  it("renders numbered steps with detail bullets", () => {
    const { report } = buildScenario();
    const md = renderInstructionsMarkdown(report.fixInstructions);
    expect(md).toMatch(/^1\. Create the missing container "Badge"/m);
    expect(md).toContain("- `background-color: #ecfdf5`");
    expect(md).toContain("re-run `verify_implementation`");
  });

  it("says no fixes needed when clean", () => {
    expect(renderInstructionsMarkdown([])).toContain("No fixes needed");
  });
});
