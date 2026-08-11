import type { DriftReport, Severity } from "../types.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

/**
 * Render the drift report as markdown that is useful to both humans and
 * agents: every issue names the property, expected vs actual, and a CSS
 * selector hint so the agent can locate the element to fix.
 */
export function renderMarkdown(report: DriftReport): string {
  const lines: string[] = [];
  const issueCount =
    report.totals.critical + report.totals.high + report.totals.medium + report.totals.low;

  lines.push(`# Figma Verify — Drift Report`);
  lines.push("");
  lines.push(`**Frame:** ${report.frameName}  `);
  if (report.liveUrl) lines.push(`**Live URL:** ${report.liveUrl}  `);
  lines.push(`**Viewport width:** ${report.viewportWidth}px  `);
  lines.push(`**Fidelity score:** ${report.fidelityScore}/100`);
  lines.push("");

  if (issueCount === 0) {
    lines.push(`✅ **Pixel-perfect within tolerances.** No drift detected.`);
    return lines.join("\n");
  }

  lines.push(
    `**Issues:** ${report.totals.critical} critical, ${report.totals.high} high, ` +
      `${report.totals.medium} medium, ${report.totals.low} low`
  );
  lines.push("");

  if (report.missing.length > 0) {
    lines.push(`## Missing elements (critical)`);
    lines.push("");
    for (const m of report.missing) {
      lines.push(`- **${m.designName}** (${m.role}, design node \`${m.designId}\`) — no matching DOM element found`);
    }
    lines.push("");
  }

  const withDiffs = report.elements.filter((e) => e.matched && e.diffs.length > 0);
  if (withDiffs.length > 0) {
    lines.push(`## Element drift`);
    lines.push("");
    for (const el of withDiffs) {
      const selector = el.selector ? ` — \`${el.selector}\`` : "";
      lines.push(`### ${el.designName} (${el.role})${selector}`);
      lines.push("");
      lines.push(`| Severity | Property | Expected (design) | Actual (implementation) | Delta |`);
      lines.push(`|---|---|---|---|---|`);
      const sorted = [...el.diffs].sort(
        (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
      );
      for (const d of sorted) {
        lines.push(
          `| ${SEVERITY_LABEL[d.severity]} | ${d.property} | \`${d.expected}\` | \`${d.actual ?? "—"}\` | ${d.delta ?? ""} |`
        );
      }
      lines.push("");
    }
  }

  const clean = report.elements.filter((e) => e.matched && e.diffs.length === 0);
  if (clean.length > 0) {
    lines.push(`## Clean elements (${clean.length})`);
    lines.push("");
    lines.push(clean.map((e) => `\`${e.designName}\``).join(", "));
    lines.push("");
  }

  lines.push(`---`);
  lines.push(
    `_Fix the criticals first (missing elements, wrong text), then highs (colors, typography), ` +
      `then mediums (spacing, size). Re-run \`verify_implementation\` after each fix until the score is 100._`
  );

  return lines.join("\n");
}
