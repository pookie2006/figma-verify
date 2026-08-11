import { describe, expect, it } from "vitest";
import { iou, matchElements } from "../src/match/matcher.js";
import type { NormalizedElement } from "../src/types.js";

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

describe("iou", () => {
  it("is 1 for identical boxes", () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
  });
  it("is 0 for disjoint boxes", () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 10, h: 10 })).toBe(0);
  });
  it("computes partial overlap", () => {
    // 10x10 boxes offset by 5: intersection 25, union 175.
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBeCloseTo(25 / 175);
  });
});

describe("matchElements", () => {
  it("pairs unique text anchors directly", () => {
    const design = [el({ id: "d1", role: "text", text: "hello world" })];
    const dom = [el({ id: "w1", role: "text", text: "hello world", selector: ".greeting" })];
    const results = matchElements(design, dom);
    expect(results[0]).toMatchObject({ designId: "d1", domId: "w1", method: "text", selector: ".greeting" });
  });

  it("disambiguates duplicate text by IoU", () => {
    const design = [
      el({ id: "d1", role: "text", text: "buy", bounds: { x: 0, y: 0, w: 50, h: 20 } }),
      el({ id: "d2", role: "text", text: "buy", bounds: { x: 0, y: 500, w: 50, h: 20 } }),
    ];
    const dom = [
      el({ id: "w-bottom", role: "text", text: "buy", bounds: { x: 0, y: 498, w: 50, h: 20 } }),
      el({ id: "w-top", role: "text", text: "buy", bounds: { x: 1, y: 1, w: 50, h: 20 } }),
    ];
    const results = matchElements(design, dom);
    const byDesign = new Map(results.map((r) => [r.designId, r]));
    expect(byDesign.get("d1")!.domId).toBe("w-top");
    expect(byDesign.get("d2")!.domId).toBe("w-bottom");
  });

  it("matches containers via the LCA of matched text children", () => {
    const design = [
      el({ id: "card", bounds: { x: 0, y: 0, w: 200, h: 100 }, childIds: ["t1", "t2"] }),
      el({ id: "t1", role: "text", text: "alpha", bounds: { x: 10, y: 10, w: 80, h: 20 }, parentId: "card" }),
      el({ id: "t2", role: "text", text: "beta", bounds: { x: 10, y: 40, w: 80, h: 20 }, parentId: "card" }),
    ];
    const dom = [
      el({ id: "body", bounds: { x: 0, y: 0, w: 1000, h: 1000 }, childIds: ["div-card"] }),
      el({
        id: "div-card",
        bounds: { x: 0, y: 0, w: 198, h: 102 },
        childIds: ["s1", "s2"],
        parentId: "body",
        selector: ".card",
      }),
      el({ id: "s1", role: "text", text: "alpha", bounds: { x: 11, y: 11, w: 80, h: 20 }, parentId: "div-card" }),
      el({ id: "s2", role: "text", text: "beta", bounds: { x: 11, y: 41, w: 80, h: 20 }, parentId: "div-card" }),
    ];
    const results = matchElements(design, dom);
    const card = results.find((r) => r.designId === "card")!;
    expect(card.domId).toBe("div-card");
    expect(card.method).toBe("container");
  });

  it("matches leftovers by geometry above the IoU floor", () => {
    const design = [el({ id: "hero-img", role: "image", bounds: { x: 0, y: 0, w: 100, h: 100 } })];
    const dom = [el({ id: "img1", role: "image", bounds: { x: 2, y: 2, w: 100, h: 100 }, selector: "img.hero" })];
    const results = matchElements(design, dom);
    expect(results[0]).toMatchObject({ designId: "hero-img", domId: "img1", method: "geometry" });
  });

  it("reports design elements below the IoU floor as unmatched", () => {
    const design = [el({ id: "badge", bounds: { x: 0, y: 500, w: 100, h: 30 } })];
    const dom = [el({ id: "far", bounds: { x: 800, y: 0, w: 50, h: 50 } })];
    const results = matchElements(design, dom);
    expect(results[0]).toMatchObject({ designId: "badge", method: "unmatched" });
    expect(results[0]!.domId).toBeUndefined();
  });

  it("does not match elements of different roles by geometry", () => {
    const design = [el({ id: "d-img", role: "image", bounds: { x: 0, y: 0, w: 100, h: 100 } })];
    const dom = [el({ id: "w-div", role: "container", bounds: { x: 0, y: 0, w: 100, h: 100 } })];
    const results = matchElements(design, dom);
    expect(results[0]!.method).toBe("unmatched");
  });
});
