import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeFigmaTree, colorToHex, normalizeText } from "../src/figma/normalize.js";
import type { FigmaNodesResponse } from "../src/figma/client.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "../demo/design-fixture.json"), "utf-8")
) as FigmaNodesResponse;
const root = fixture.nodes["1:2"]!.document;

describe("normalizeFigmaTree", () => {
  const elements = normalizeFigmaTree(root);
  const byName = new Map(elements.map((e) => [e.name, e]));

  it("flattens the tree and keeps all visible nodes", () => {
    expect(elements).toHaveLength(9);
    expect(elements[0]!.name).toBe("Signup Card");
  });

  it("converts absolute coordinates to frame-relative", () => {
    const frame = byName.get("Signup Card")!;
    expect(frame.bounds).toEqual({ x: 0, y: 0, w: 800, h: 536 });

    // Card is at absolute (300, 320); frame origin is (100, 200).
    const card = byName.get("Card")!;
    expect(card.bounds).toEqual({ x: 200, y: 120, w: 400, h: 296 });
  });

  it("assigns roles from node types and fills", () => {
    expect(byName.get("Card")!.role).toBe("container");
    expect(byName.get("Title")!.role).toBe("text");
    expect(byName.get("Primary Button")!.role).toBe("container");
  });

  it("extracts text styles and normalized text content", () => {
    const title = byName.get("Title")!;
    expect(title.text).toBe("create your account");
    expect(title.styles.fontSize).toBe(24);
    expect(title.styles.fontWeight).toBe(700);
    expect(title.styles.fontFamily).toBe("Arial");
    expect(title.styles.lineHeight).toBe(32);
    expect(title.styles.textColor).toBe("#0f172a");
  });

  it("extracts auto-layout padding, gap, radius, and border", () => {
    const card = byName.get("Card")!;
    expect(card.styles.paddingTop).toBe(32);
    expect(card.styles.paddingLeft).toBe(32);
    expect(card.styles.gap).toBe(20);
    expect(card.styles.borderRadius).toBe(16);
    expect(card.styles.borderWidth).toBe(1);
    expect(card.styles.borderColor).toBe("#e2e8f0");
    expect(card.styles.backgroundColor).toBe("#ffffff");
  });

  it("records parent/child relationships", () => {
    const card = byName.get("Card")!;
    const title = byName.get("Title")!;
    expect(title.parentId).toBe(card.id);
    expect(card.childIds).toContain(title.id);
  });

  it("drops invisible and zero-size nodes", () => {
    const withHidden = structuredClone(root);
    withHidden.children!.push({
      id: "9:9",
      name: "Hidden",
      type: "RECTANGLE",
      visible: false,
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    });
    withHidden.children!.push({
      id: "9:10",
      name: "ZeroSize",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 10 },
    });
    expect(normalizeFigmaTree(withHidden)).toHaveLength(9);
  });
});

describe("colorToHex", () => {
  it("converts 0-1 rgba to hex", () => {
    expect(colorToHex({ r: 1, g: 1, b: 1, a: 1 })).toBe("#ffffff");
    expect(colorToHex({ r: 0.3098039216, g: 0.2745098039, b: 0.8980392157, a: 1 })).toBe("#4f46e5");
  });
});

describe("normalizeText", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeText("  Create \n Your   Account ")).toBe("create your account");
  });
});
