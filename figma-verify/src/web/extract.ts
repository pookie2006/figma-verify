import { chromium } from "playwright";
import type { NormalizedElement } from "../types.js";

export interface ExtractionResult {
  elements: NormalizedElement[];
  /** PNG screenshot of the rendered viewport, base64-encoded. */
  screenshotBase64: string;
}

/**
 * Render a live URL in headless Chromium and reduce the visible DOM to
 * NormalizedElement[] (coordinates relative to the document's top-left,
 * which lines up with the Figma frame when viewport width matches the
 * frame width). Also captures a viewport screenshot for visual reports.
 */
export async function extractFromUrl(
  liveUrl: string,
  viewportWidth: number,
  viewportHeight = 1200
): Promise<ExtractionResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: viewportWidth, height: Math.max(200, Math.round(viewportHeight)) },
      deviceScaleFactor: 1,
    });
    await page.goto(liveUrl, { waitUntil: "networkidle", timeout: 30_000 });
    // Give web fonts a chance to settle so text metrics are final.
    await page.evaluate(() => (document as any).fonts?.ready);

    // tsx/esbuild's keep-names transform injects __name(...) helper calls into
    // extractInPage when it is serialized into the page; provide a no-op shim.
    await page.evaluate("globalThis.__name = (fn) => fn");
    const elements = (await page.evaluate(extractInPage)) as NormalizedElement[];
    const screenshot = await page.screenshot({ type: "png" });
    return { elements, screenshotBase64: screenshot.toString("base64") };
  } finally {
    await browser.close();
  }
}

/**
 * Runs inside the browser. Must be self-contained (no imports, no closures).
 * Kept as a plain function so Playwright can serialize it.
 */
function extractInPage(): unknown {
  const out: any[] = [];

  function rgbToHex(rgb: string): string | undefined {
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (!m || !m[1] || !m[2] || !m[3]) return undefined;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return undefined;
    const hex = (v: string) => parseInt(v, 10).toString(16).padStart(2, "0");
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }

  function px(value: string): number | undefined {
    const n = parseFloat(value);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined;
  }

  function normText(t: string): string {
    return t.replace(/\s+/g, " ").trim().toLowerCase();
  }

  function cssPath(el: Element): string {
    if (el.id) return `#${el.id}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`#${cur.id}`);
        break;
      }
      const cls = Array.from(cur.classList).slice(0, 2);
      if (cls.length) part += "." + cls.join(".");
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(" > ");
  }

  /** Direct text of an element (own text nodes only, not descendants). */
  function ownText(el: Element): string {
    let t = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) t += node.textContent ?? "";
    }
    return normText(t);
  }

  function isHidden(el: Element, style: CSSStyleDeclaration, rect: DOMRect): boolean {
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (parseFloat(style.opacity) === 0) return true;
    if (rect.width <= 0 || rect.height <= 0) return true;
    return false;
  }

  const skipTags = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "NOSCRIPT", "TEMPLATE", "BR"]);
  let counter = 0;

  function walk(el: Element, parentId: string | undefined): string | undefined {
    if (skipTags.has(el.tagName)) return undefined;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (isHidden(el, style, rect)) return undefined;

    const id = `dom-${counter++}`;
    const text = ownText(el);
    const hasElementChildren = Array.from(el.children).some((c) => !skipTags.has(c.tagName));

    let role: "text" | "container" | "image" = "container";
    if (el.tagName === "IMG" || el.tagName === "SVG" || el.tagName === "PICTURE") role = "image";
    else if (text && !hasElementChildren) role = "text";

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const styles: any = {};
    const bg = rgbToHex(style.backgroundColor);
    if (bg) styles.backgroundColor = bg;
    if (role === "text") {
      const color = rgbToHex(style.color);
      if (color) styles.textColor = color;
      styles.fontFamily = (style.fontFamily.split(",")[0] ?? "").trim().replace(/["']/g, "");
      styles.fontSize = px(style.fontSize);
      styles.fontWeight = parseInt(style.fontWeight, 10) || 400;
      const lh = px(style.lineHeight);
      if (lh !== undefined) styles.lineHeight = lh;
    }
    const radius = px(style.borderTopLeftRadius);
    if (radius) styles.borderRadius = radius;
    const bw = px(style.borderTopWidth);
    if (bw) {
      styles.borderWidth = bw;
      const bc = rgbToHex(style.borderTopColor);
      if (bc) styles.borderColor = bc;
    }
    const pt = px(style.paddingTop);
    const pr = px(style.paddingRight);
    const pb = px(style.paddingBottom);
    const pl = px(style.paddingLeft);
    if (pt || pr || pb || pl) {
      styles.paddingTop = pt ?? 0;
      styles.paddingRight = pr ?? 0;
      styles.paddingBottom = pb ?? 0;
      styles.paddingLeft = pl ?? 0;
    }
    if (style.display === "flex" || style.display === "grid") {
      const gap = px(style.rowGap === "normal" ? style.columnGap : style.rowGap);
      if (gap) styles.gap = gap;
    }
    const opacity = parseFloat(style.opacity);
    if (opacity < 1) styles.opacity = opacity;

    const element: any = {
      id,
      role,
      name: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.classList.length ? `.${el.classList[0]}` : ""),
      bounds: {
        x: Math.round((rect.left + scrollX) * 10) / 10,
        y: Math.round((rect.top + scrollY) * 10) / 10,
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
      },
      styles,
      childIds: [],
      parentId,
      selector: cssPath(el),
    };
    if (role === "text" && text) element.text = text;

    out.push(element);

    for (const child of Array.from(el.children)) {
      const childId = walk(child, id);
      if (childId) element.childIds.push(childId);
    }
    return id;
  }

  walk(document.body, undefined);
  return out;
}
