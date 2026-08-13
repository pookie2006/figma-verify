import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFigmaNodeCache,
  fetchFigmaNode,
  fetchFigmaNodesResponse,
  type FigmaNode,
  type FigmaNodesResponse,
} from "../src/figma/client.js";
import type { FigmaRef } from "../src/figma/url.js";

const ref: FigmaRef = { fileKey: "ABC123", nodeId: "1:2" };

function nodesResponse(node: FigmaNode): FigmaNodesResponse {
  return { name: "Test file", nodes: { "1:2": { document: node } } };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("fetchFigmaNode", () => {
  beforeEach(() => {
    clearFigmaNodeCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and returns the requested node", async () => {
    const node: FigmaNode = { id: "1:2", name: "Frame", type: "FRAME" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFigmaNode(ref, "tok");
    expect(result).toEqual(node);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches successful responses so a repeat compare doesn't re-hit the API", async () => {
    const node: FigmaNode = { id: "1:2", name: "Frame", type: "FRAME" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    await fetchFigmaNode(ref, "tok");
    await fetchFigmaNode(ref, "tok");
    await fetchFigmaNode(ref, "tok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when skipCache is set", async () => {
    const node: FigmaNode = { id: "1:2", name: "Frame", type: "FRAME" };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    await fetchFigmaNode(ref, "tok");
    await fetchFigmaNode(ref, "tok", { skipCache: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by file + node, so different refs don't collide", async () => {
    const nodeA: FigmaNode = { id: "1:2", name: "A", type: "FRAME" };
    const nodeB: FigmaNode = { id: "9:9", name: "B", type: "FRAME" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, nodesResponse(nodeA)))
      .mockResolvedValueOnce(jsonResponse(200, { name: "f", nodes: { "9:9": { document: nodeB } } }));
    vi.stubGlobal("fetch", fetchMock);

    const a = await fetchFigmaNode(ref, "tok");
    const b = await fetchFigmaNode({ fileKey: "ABC123", nodeId: "9:9" }, "tok");

    expect(a.name).toBe("A");
    expect(b.name).toBe("B");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 (honoring a short Retry-After) and succeeds once the limit clears", async () => {
    const node: FigmaNode = { id: "1:2", name: "Frame", type: "FRAME" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFigmaNode(ref, "tok");
    expect(result).toEqual(node);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear, actionable error after exhausting 429 retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/rate limit exceeded/i);
    // Initial attempt + MAX_RATE_LIMIT_RETRIES retries.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("tells the caller a new token won't help and surfaces Figma's diagnostic headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(429, { err: "rate limited" }, {
        "retry-after": "0",
        "x-figma-plan-tier": "starter",
        "x-figma-rate-limit-type": "file-nodes",
        "x-figma-upgrade-link": "https://figma.com/upgrade",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/same account/i);
    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/starter/i);
    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/figma\.com\/upgrade/i);
  });

  it("does not retry blindly when Figma sends no Retry-After hint, to avoid burning a scarce monthly quota", async () => {
    // No retry-after header at all (as opposed to "0") — some plan/seat
    // combinations cap at 6 requests/MONTH, where guessing a backoff and
    // retrying a few times just spends 4x the budget on one failed click.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { err: "rate limited" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/rate limit exceeded/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearFigmaNodeCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { err: "rate limited" })));
    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/didn't send a retry-after hint/i);
  });

  it("stops retrying as soon as a retry succeeds, without extra requests", async () => {
    const node: FigmaNode = { id: "1:2", name: "Frame", type: "FRAME" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFigmaNode(ref, "tok");
    expect(result).toEqual(node);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed (429) fetch", async () => {
    const node: FigmaNode = { id: "1:2", name: "Frame", type: "FRAME" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(429, { err: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/rate limit exceeded/i);
    // A later, successful call should still hit the network (nothing bad was cached).
    const result = await fetchFigmaNode(ref, "tok");
    expect(result).toEqual(node);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("surfaces a clear error for 403", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { err: "forbidden" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/403/);
  });

  it("surfaces a clear error for 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { err: "not found" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/404/);
  });

  it("errors when the requested node id isn't in the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { name: "f", nodes: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFigmaNode(ref, "tok")).rejects.toThrow(/not present in the API response/);
  });
});

describe("fetchFigmaNodesResponse", () => {
  beforeEach(() => {
    clearFigmaNodeCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shapes the result as a saveable nodes-API fixture", async () => {
    const node: FigmaNode = { id: "1:2", name: "Signup Card", type: "FRAME" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    const fixture = await fetchFigmaNodesResponse(ref, "tok");
    expect(fixture).toEqual({ name: "Signup Card", nodes: { "1:2": { document: node } } });
    // Same shape verifyFromFixture / --fixture expect (see design-fixture.json).
    expect(fixture.nodes[ref.nodeId]?.document).toEqual(node);
  });

  it("shares fetchFigmaNode's cache, so it's free right after a compare already fetched the same ref", async () => {
    const node: FigmaNode = { id: "1:2", name: "Frame", type: "FRAME" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, nodesResponse(node)));
    vi.stubGlobal("fetch", fetchMock);

    await fetchFigmaNode(ref, "tok"); // e.g. what a Compare already did
    await fetchFigmaNodesResponse(ref, "tok"); // saving a fixture afterwards

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
