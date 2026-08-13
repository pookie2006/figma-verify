import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFigmaNodeCache, fetchFigmaNode, type FigmaNode, type FigmaNodesResponse } from "../src/figma/client.js";
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
