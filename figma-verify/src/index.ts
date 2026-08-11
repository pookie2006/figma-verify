#!/usr/bin/env node
/**
 * Figma Verify — MCP server entry.
 *
 * Exposes two tools over stdio:
 *   verify_implementation  — full design-vs-live-URL drift report
 *   get_design_spec        — normalized design spec only (no browser)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDesignSpec, verifyImplementation } from "./verify.js";

const tolerancesSchema = z
  .object({
    position: z.number().positive().optional().describe("Position/size tolerance in px (default 2)"),
    spacing: z.number().positive().optional().describe("Padding/gap tolerance in px (default 1)"),
    fontSize: z.number().positive().optional().describe("Font size tolerance in px (default 0.5)"),
    colorDistance: z
      .number()
      .positive()
      .optional()
      .describe("Max RGB-space distance treated as equal (default 8)"),
    iouFloor: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Minimum bounding-box IoU for geometry matches (default 0.4)"),
  })
  .optional();

const server = new McpServer({
  name: "figma-verify",
  version: "0.1.0",
});

server.registerTool(
  "verify_implementation",
  {
    title: "Verify implementation against Figma design",
    description:
      "Compare a live URL against a Figma frame and return a severity-scored drift report. " +
      "Pulls the design spec from the Figma REST API, renders the URL in headless Chromium, " +
      "matches design nodes to DOM elements, and diffs colors, typography, spacing, size, and text. " +
      "Returns markdown plus full JSON (per-element diffs with CSS selector hints). " +
      "Fix the reported issues in your code and re-run until the fidelity score is 100.",
    inputSchema: {
      figma_url: z
        .string()
        .url()
        .describe("Figma share link with a node-id (in Figma: select the frame, Copy link to selection)"),
      live_url: z.string().url().describe("URL of the running implementation, e.g. http://localhost:5173"),
      viewport_width: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Browser viewport width in px; defaults to the Figma frame width"),
      tolerances: tolerancesSchema,
    },
  },
  async ({ figma_url, live_url, viewport_width, tolerances }) => {
    try {
      const { markdown, report } = await verifyImplementation({
        figmaUrl: figma_url,
        liveUrl: live_url,
        viewportWidth: viewport_width,
        tolerances,
      });
      return {
        content: [
          { type: "text" as const, text: markdown },
          { type: "text" as const, text: "```json\n" + JSON.stringify(report, null, 2) + "\n```" },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `verify_implementation failed: ${(err as Error).message}` }],
      };
    }
  }
);

server.registerTool(
  "get_design_spec",
  {
    title: "Get normalized Figma design spec",
    description:
      "Fetch a Figma frame and return its normalized spec: every visible element with " +
      "frame-relative bounds, role (text/container/image), text content, colors, typography, " +
      "padding, gap, and radii. Use this to inspect the target design before implementing or diffing.",
    inputSchema: {
      figma_url: z
        .string()
        .url()
        .describe("Figma share link with a node-id (in Figma: select the frame, Copy link to selection)"),
    },
  },
  async ({ figma_url }) => {
    try {
      const spec = await getDesignSpec(figma_url);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(spec, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `get_design_spec failed: ${(err as Error).message}` }],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("figma-verify MCP server running on stdio");
