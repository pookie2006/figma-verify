import type {
  DriftReport,
  ElementReport,
  FixInstruction,
  NormalizedElement,
  PropertyDiff,
} from "../types.js";

/**
 * Turn a drift report into an ordered list of imperative, agent-executable
 * fix instructions.
 *
 * Ordering strategy (root causes first):
 *   1. create   — missing elements, with the full spec to build them
 *                 (children of a missing parent are folded into its step)
 *   2. text     — wrong text content (critical)
 *   3. style    — color/typography drift (high)
 *   4. layout   — padding/gap/radius/border drift (medium, non-cascade)
 *   5. geometry — residual position/size drift (non-cascade); often resolves
 *                 after the steps above, so it is listed last with a caveat
 *
 * Diffs tagged `cascade` never become instructions: they are side effects of
 * a parent's drift and disappear when the parent is fixed.
 */
export function generateFixInstructions(
  elements: ElementReport[],
  missing: DriftReport["missing"],
  design: NormalizedElement[]
): FixInstruction[] {
  const designById = new Map(design.map((e) => [e.id, e]));
  const reportById = new Map(elements.map((e) => [e.designId, e]));
  const items: Omit<FixInstruction, "step">[] = [];

  // --- 1. create missing elements (top-most missing ancestors only) --------
  const missingIds = new Set(missing.map((m) => m.designId));
  for (const m of missing) {
    const el = designById.get(m.designId);
    if (!el) continue;
    if (el.parentId && missingIds.has(el.parentId)) continue; // folded into parent's step
    items.push(createStep(el, designById, reportById));
  }

  // --- 2. text corrections --------------------------------------------------
  for (const er of elements) {
    if (!er.matched) continue;
    const t = er.diffs.find((d) => d.property === "text");
    if (!t) continue;
    items.push({
      kind: "text",
      selector: er.selector,
      designName: er.designName,
      summary: `In ${target(er)}, change the text content to exactly "${t.expected}" (currently "${t.actual ?? ""}").`,
      details: [],
    });
  }

  // --- 3. style fixes (high severity: colors, typography) -------------------
  const STYLE_PROPS = new Set([
    "backgroundColor",
    "textColor",
    "borderColor",
    "fontFamily",
    "fontWeight",
    "fontSize",
  ]);
  for (const er of elements) {
    if (!er.matched) continue;
    const styleDiffs = er.diffs.filter((d) => STYLE_PROPS.has(d.property) && !d.cascade);
    if (styleDiffs.length === 0) continue;
    items.push({
      kind: "style",
      selector: er.selector,
      designName: er.designName,
      summary: `In ${target(er)}, fix ${styleDiffs.length > 1 ? "these style properties" : "this style property"}:`,
      details: styleDiffs.map(cssLine),
    });
  }

  // --- 4. layout fixes (padding/gap/radius/border, non-cascade) -------------
  const LAYOUT_PROPS = new Set([
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "gap",
    "borderRadius",
    "borderWidth",
  ]);
  for (const er of elements) {
    if (!er.matched) continue;
    const layoutDiffs = er.diffs.filter((d) => LAYOUT_PROPS.has(d.property) && !d.cascade);
    if (layoutDiffs.length === 0) continue;

    const cascadesResolved = countDescendantCascades(er.designId, designById, reportById);
    items.push({
      kind: "layout",
      selector: er.selector,
      designName: er.designName,
      summary: `In ${target(er)}, fix the layout:`,
      details: groupPadding(layoutDiffs).map(cssLine),
      note:
        cascadesResolved > 0
          ? `This also resolves ${cascadesResolved} cascade position/size diff${cascadesResolved > 1 ? "s" : ""} on descendant elements — no separate action needed for those.`
          : undefined,
    });
  }

  // --- 5. residual geometry (position/size, non-cascade) --------------------
  const GEOMETRY_PROPS = new Set(["x", "y", "width", "height"]);
  for (const er of elements) {
    if (!er.matched) continue;
    const geo = er.diffs.filter((d) => GEOMETRY_PROPS.has(d.property) && !d.cascade);
    if (geo.length === 0) continue;
    items.push({
      kind: "geometry",
      selector: er.selector,
      designName: er.designName,
      summary: `In ${target(er)}, the rendered box drifts from the design:`,
      details: geo.map(
        (d) => `${d.property}: expected ${d.expected}px, got ${d.actual}px (${d.delta ?? ""})`
      ),
      note: "Re-verify before hand-tuning: box drift like this usually disappears once the earlier steps are applied.",
    });
  }

  return items.map((item, i) => ({ step: i + 1, ...item }));
}

/** Render the instruction list as markdown (used by reports and the CLI). */
export function renderInstructionsMarkdown(instructions: FixInstruction[]): string {
  if (instructions.length === 0) {
    return "No fixes needed — the implementation matches the design within tolerances.";
  }
  const lines: string[] = [];
  for (const ins of instructions) {
    lines.push(`${ins.step}. ${ins.summary}`);
    for (const d of ins.details) lines.push(`   - \`${d}\``);
    if (ins.note) lines.push(`   _${ins.note}_`);
  }
  lines.push("");
  lines.push(
    "After applying these steps, re-run `verify_implementation` and repeat until the fidelity score is 100."
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

const CSS_NAME: Record<string, string> = {
  backgroundColor: "background-color",
  textColor: "color",
  borderColor: "border-color",
  fontFamily: "font-family",
  fontWeight: "font-weight",
  fontSize: "font-size",
  lineHeight: "line-height",
  borderRadius: "border-radius",
  borderWidth: "border-width",
  paddingTop: "padding-top",
  paddingRight: "padding-right",
  paddingBottom: "padding-bottom",
  paddingLeft: "padding-left",
  padding: "padding",
  gap: "gap",
  opacity: "opacity",
};

const PX_PROPS = new Set([
  "fontSize",
  "lineHeight",
  "borderRadius",
  "borderWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "padding",
  "gap",
]);

function cssValue(property: string, value: string | number): string {
  return PX_PROPS.has(property) ? `${value}px` : String(value);
}

function cssLine(diff: PropertyDiff): string {
  const name = CSS_NAME[diff.property] ?? diff.property;
  const current =
    diff.actual == null ? "currently unset" : `currently ${cssValue(diff.property, diff.actual)}`;
  return `${name}: ${cssValue(diff.property, diff.expected)}  (${current})`;
}

function target(er: ElementReport): string {
  return er.selector ? `\`${er.selector}\`` : `the "${er.designName}" element`;
}

/** Collapse four equal padding-side diffs into a single shorthand line. */
function groupPadding(diffs: PropertyDiff[]): PropertyDiff[] {
  const sides = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
  const padDiffs = sides
    .map((s) => diffs.find((d) => d.property === s))
    .filter((d): d is PropertyDiff => !!d);
  const rest = diffs.filter((d) => !sides.includes(d.property));

  if (
    padDiffs.length === 4 &&
    padDiffs.every((d) => d.expected === padDiffs[0]!.expected && d.actual === padDiffs[0]!.actual)
  ) {
    return [{ ...padDiffs[0]!, property: "padding" }, ...rest];
  }
  return [...padDiffs, ...rest];
}

/**
 * Build a "create this element" step carrying the complete spec, including
 * any missing children, so an agent can implement it without the Figma file.
 */
function createStep(
  el: NormalizedElement,
  designById: Map<string, NormalizedElement>,
  reportById: Map<string, ElementReport>
): Omit<FixInstruction, "step"> {
  const parent = el.parentId ? designById.get(el.parentId) : undefined;
  const parentReport = el.parentId ? reportById.get(el.parentId) : undefined;
  const parentRef = parentReport?.selector
    ? `\`${parentReport.selector}\``
    : parent
      ? `the "${parent.name}" element`
      : "the page root";

  const position = parent ? describePosition(el, parent) : "";
  const details = describeSpec(el, designById, "");

  return {
    kind: "create",
    selector: parentReport?.selector,
    designName: el.name,
    summary: `Create the missing ${el.role} "${el.name}" inside ${parentRef}${position}:`,
    details,
  };
}

function describePosition(el: NormalizedElement, parent: NormalizedElement): string {
  const idx = parent.childIds.indexOf(el.id);
  if (idx < 0) return "";
  if (idx === parent.childIds.length - 1) return " as its last child";
  return ` as child ${idx + 1} of ${parent.childIds.length}`;
}

/** CSS-like spec lines for an element and (recursively) its children. */
function describeSpec(
  el: NormalizedElement,
  designById: Map<string, NormalizedElement>,
  indent: string
): string[] {
  const lines: string[] = [];
  const st = el.styles;

  lines.push(`${indent}size: ${el.bounds.w}x${el.bounds.h}px at x=${el.bounds.x} y=${el.bounds.y} (frame-relative)`);
  if (el.text) lines.push(`${indent}text: "${el.text}"`);
  for (const [prop, value] of Object.entries(st) as [string, string | number][]) {
    // Zero spacing values are defaults, not spec — keep the instruction terse.
    if (value === 0 && PX_PROPS.has(prop)) continue;
    const name = CSS_NAME[prop] ?? prop;
    lines.push(`${indent}${name}: ${cssValue(prop, value)}`);
  }

  for (const childId of el.childIds) {
    const child = designById.get(childId);
    if (!child) continue;
    lines.push(`${indent}contains ${child.role} "${child.name}":`);
    lines.push(...describeSpec(child, designById, indent + "  "));
  }
  return lines;
}

/** Count cascade diffs across all design-tree descendants of an element. */
function countDescendantCascades(
  designId: string,
  designById: Map<string, NormalizedElement>,
  reportById: Map<string, ElementReport>
): number {
  let count = 0;
  const stack = [...(designById.get(designId)?.childIds ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    const report = reportById.get(id);
    if (report) count += report.diffs.filter((d) => d.cascade).length;
    stack.push(...(designById.get(id)?.childIds ?? []));
  }
  return count;
}
