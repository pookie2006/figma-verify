import type { Bounds, MatchResult, NormalizedElement } from "../types.js";

/**
 * Match design elements to DOM elements in three passes:
 *   1. Text anchors: unique normalized text strings pair directly.
 *   2. Containers: a design container maps to the lowest common ancestor of
 *      its matched text descendants (ties broken by bounding-box IoU).
 *   3. Geometry: leftovers matched greedily by IoU + role above a floor;
 *      below the floor a design element is reported unmatched (missing).
 */
export function matchElements(
  design: NormalizedElement[],
  dom: NormalizedElement[],
  iouFloor = 0.4
): MatchResult[] {
  const results = new Map<string, MatchResult>();
  const usedDomIds = new Set<string>();
  const domById = new Map(dom.map((e) => [e.id, e]));
  const designById = new Map(design.map((e) => [e.id, e]));

  // --- Pass 1: text anchors -------------------------------------------------
  const designTextIndex = groupByText(design);
  const domTextIndex = groupByText(dom);

  for (const [text, designNodes] of designTextIndex) {
    const domNodes = domTextIndex.get(text);
    if (!domNodes) continue;

    if (designNodes.length === 1 && domNodes.length === 1) {
      claim(designNodes[0]!, domNodes[0]!, "text", results, usedDomIds);
    } else {
      // Duplicate strings: disambiguate by best IoU, greedily.
      const pool = [...domNodes];
      for (const d of [...designNodes].sort((a, b) => a.bounds.y - b.bounds.y)) {
        let best: NormalizedElement | undefined;
        let bestIou = -1;
        for (const cand of pool) {
          if (usedDomIds.has(cand.id)) continue;
          const i = iou(d.bounds, cand.bounds);
          if (i > bestIou) {
            bestIou = i;
            best = cand;
          }
        }
        if (best) claim(d, best, "text", results, usedDomIds, bestIou);
      }
    }
  }

  // --- Pass 2: containers via matched text descendants ----------------------
  const domParentOf = (id: string) => domById.get(id)?.parentId;

  // Process deepest containers first so nested cards resolve before wrappers.
  const containers = design
    .filter((e) => e.role === "container" && !results.has(e.id))
    .sort((a, b) => depthOf(b, designById) - depthOf(a, designById));

  for (const container of containers) {
    const matchedDescendants = collectDescendants(container, designById)
      .map((id) => results.get(id))
      .filter((r): r is MatchResult => !!r && !!r.domId);

    if (matchedDescendants.length === 0) continue;

    const anchorDomIds = matchedDescendants.map((r) => r.domId!) as string[];
    const lcaId = lowestCommonAncestor(anchorDomIds, domParentOf);
    if (!lcaId) continue;

    // Consider the LCA and its ancestor chain; pick the best IoU with the
    // design container's bounds (the LCA may be a tight text wrapper while
    // the design container includes padding).
    let best: { id: string; iou: number } | undefined;
    let cur: string | undefined = lcaId;
    while (cur) {
      const el = domById.get(cur);
      if (el && !usedDomIds.has(cur)) {
        const i = iou(container.bounds, el.bounds);
        if (!best || i > best.iou) best = { id: cur, iou: i };
      }
      cur = domParentOf(cur);
    }

    if (best && best.iou > 0) {
      claim(container, domById.get(best.id)!, "container", results, usedDomIds, best.iou);
    }
  }

  // --- Pass 3: geometry for leftovers ---------------------------------------
  const leftovers = design.filter((e) => !results.has(e.id));
  for (const d of leftovers) {
    let best: NormalizedElement | undefined;
    let bestIou = -1;
    for (const cand of dom) {
      if (usedDomIds.has(cand.id)) continue;
      if (cand.role !== d.role) continue;
      const i = iou(d.bounds, cand.bounds);
      if (i > bestIou) {
        bestIou = i;
        best = cand;
      }
    }
    if (best && bestIou >= iouFloor) {
      claim(d, best, "geometry", results, usedDomIds, bestIou);
    } else {
      results.set(d.id, { designId: d.id, method: "unmatched" });
    }
  }

  return design.map((d) => results.get(d.id)!).filter(Boolean);
}

function claim(
  design: NormalizedElement,
  dom: NormalizedElement,
  method: MatchResult["method"],
  results: Map<string, MatchResult>,
  usedDomIds: Set<string>,
  iouValue?: number
): void {
  results.set(design.id, {
    designId: design.id,
    domId: dom.id,
    selector: dom.selector,
    method,
    iou: iouValue,
  });
  usedDomIds.add(dom.id);
}

function groupByText(elements: NormalizedElement[]): Map<string, NormalizedElement[]> {
  const map = new Map<string, NormalizedElement[]>();
  for (const e of elements) {
    if (e.role !== "text" || !e.text) continue;
    const list = map.get(e.text) ?? [];
    list.push(e);
    map.set(e.text, list);
  }
  return map;
}

function depthOf(el: NormalizedElement, byId: Map<string, NormalizedElement>): number {
  let depth = 0;
  let cur = el.parentId;
  while (cur) {
    depth++;
    cur = byId.get(cur)?.parentId;
  }
  return depth;
}

function collectDescendants(el: NormalizedElement, byId: Map<string, NormalizedElement>): string[] {
  const out: string[] = [];
  const stack = [...el.childIds];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const child = byId.get(id);
    if (child) stack.push(...child.childIds);
  }
  return out;
}

function lowestCommonAncestor(
  ids: string[],
  parentOf: (id: string) => string | undefined
): string | undefined {
  if (ids.length === 0) return undefined;

  const chainOf = (id: string): string[] => {
    const chain: string[] = [];
    let cur: string | undefined = id;
    while (cur) {
      chain.unshift(cur);
      cur = parentOf(cur);
    }
    return chain;
  };

  let common = chainOf(ids[0]!);
  for (const id of ids.slice(1)) {
    const chain = chainOf(id);
    let i = 0;
    while (i < common.length && i < chain.length && common[i] === chain[i]) i++;
    common = common.slice(0, i);
    if (common.length === 0) return undefined;
  }
  // For a single anchor, the LCA of {node} is its parent (the wrapper),
  // otherwise it's the shared prefix tail.
  if (ids.length === 1) {
    return parentOf(ids[0]!) ?? ids[0];
  }
  return common[common.length - 1];
}

export function iou(a: Bounds, b: Bounds): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
