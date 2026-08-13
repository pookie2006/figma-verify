import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  coerceScoringProfile,
  exceedsUploadLimits,
  isExcludedUploadPath,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  pickEntry,
  resolveDesignSource,
  safeRelPath,
  stripSharedRoot,
  validateLiveUrl,
  writeUploadTree,
} from "../src/studio/upload.js";

describe("studio upload helpers", () => {
  it("strips a shared webkitdirectory root folder", () => {
    const map = stripSharedRoot(["demo/index.html", "demo/styles.css"]);
    expect(map.get("demo/index.html")).toBe("index.html");
    expect(map.get("demo/styles.css")).toBe("styles.css");
  });

  it("keeps paths when there is no shared root folder", () => {
    const map = stripSharedRoot(["index.html", "app.js"]);
    expect(map.get("index.html")).toBe("index.html");
    expect(map.get("app.js")).toBe("app.js");
  });

  it("rejects path traversal segments", () => {
    expect(safeRelPath("../secret.txt")).toBeNull();
    expect(safeRelPath("ok/../nope.html")).toBe("nope.html");
    expect(safeRelPath("cards/index.html")).toBe("cards/index.html");
  });

  it("picks index.html, then any html, then preferred entry", () => {
    expect(pickEntry(["a.css", "index.html", "b.js"])).toBe("index.html");
    expect(pickEntry(["a.css", "page.html"])).toBe("page.html");
    expect(pickEntry(["a.html", "b.html"], "b.html")).toBe("b.html");
    expect(() => pickEntry(["a.css"])).toThrow(/HTML entry/);
  });

  it("coerces valid scoring profile strings and rejects invalid ones", () => {
    expect(coerceScoringProfile("strict")).toBe("strict");
    expect(coerceScoringProfile("rootCause")).toBe("rootCause");
    expect(coerceScoringProfile("nonsense")).toBeUndefined();
    expect(coerceScoringProfile(undefined)).toBeUndefined();
    expect(coerceScoringProfile(null)).toBeUndefined();
  });

  it("resolveDesignSource prefers a pasted Figma link over a fixture file", async () => {
    const result = await resolveDesignSource({
      figmaUrl: "https://www.figma.com/proto/Ptm7BvMduyqaGEcYBKzSZG/Trainee-Project?node-id=1601-3",
      fixtureName: "design-fixture.json",
      fixtureText: async () => "{}",
    });
    expect(result).toEqual({
      kind: "figmaUrl",
      figmaUrl: "https://www.figma.com/proto/Ptm7BvMduyqaGEcYBKzSZG/Trainee-Project?node-id=1601-3",
    });
  });

  it("resolveDesignSource rejects a non-figma.com URL that is not fixture JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      resolveDesignSource({ figmaUrl: "https://example.com/not-a-fixture" })
    ).rejects.toThrow(/not a Figma fixture JSON/i);
    vi.unstubAllGlobals();
  });

  it("resolveDesignSource accepts a public http(s) fixture JSON URL", async () => {
    const body = { name: "Signup Card", nodes: { "1:2": { document: { id: "1:2", name: "Signup Card" } } } };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolveDesignSource({
      figmaUrl: "https://pookie2006.github.io/figma-verify/design-fixture.json",
    });
    expect(result.kind).toBe("fixture");
    if (result.kind === "fixture") expect(result.fixture.name).toBe("Signup Card");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("resolveDesignSource falls back to a valid fixture file", async () => {
    const result = await resolveDesignSource({
      fixtureName: "design-fixture.json",
      fixtureType: "application/json",
      fixtureText: async () => JSON.stringify({ name: "x", nodes: { "1:2": { document: {} } } }),
    });
    expect(result.kind).toBe("fixture");
  });

  it("resolveDesignSource rejects .fig files and images", async () => {
    await expect(
      resolveDesignSource({ fixtureName: "mock.fig" })
    ).rejects.toThrow(/\.fig/);
    await expect(
      resolveDesignSource({ fixtureName: "mock.png", fixtureType: "image/png" })
    ).rejects.toThrow(/preview-only/);
  });

  it("resolveDesignSource rejects malformed fixture JSON", async () => {
    await expect(
      resolveDesignSource({ fixtureName: "x.json", fixtureText: async () => "not json" })
    ).rejects.toThrow(/valid JSON/);
    await expect(
      resolveDesignSource({ fixtureName: "x.json", fixtureText: async () => "{}" })
    ).rejects.toThrow(/nodes-API response/);
  });

  it("resolveDesignSource requires some design source", async () => {
    await expect(resolveDesignSource({})).rejects.toThrow(/design source/);
  });

  it("excludes node_modules, VCS dirs, and OS junk files from uploads", () => {
    expect(isExcludedUploadPath("my-app/node_modules/react/index.js")).toBe(true);
    expect(isExcludedUploadPath(".git/HEAD")).toBe(true);
    expect(isExcludedUploadPath("build/.DS_Store")).toBe(true);
    expect(isExcludedUploadPath("coverage/lcov.info")).toBe(true);
    expect(isExcludedUploadPath("build/index.html")).toBe(false);
    expect(isExcludedUploadPath("src/App.jsx")).toBe(false);
  });

  it("rejects uploads that exceed size or file-count limits", () => {
    expect(exceedsUploadLimits(1024, 5)).toBeNull();
    expect(exceedsUploadLimits(MAX_UPLOAD_BYTES + 1, 5)).toMatch(/too large/i);
    expect(exceedsUploadLimits(1024, MAX_UPLOAD_FILES + 1)).toMatch(/too many files/i);
  });

  it("validates a live URL for http/https/file schemes", () => {
    expect(validateLiveUrl("http://localhost:3000/search-page?firstName=&email=")).toBe(
      "http://localhost:3000/search-page?firstName=&email="
    );
    expect(validateLiveUrl("https://example.com/app")).toBe("https://example.com/app");
    expect(validateLiveUrl("  http://localhost:5173/  ")).toBe("http://localhost:5173/");
  });

  it("rejects invalid or unsupported live URLs", () => {
    expect(() => validateLiveUrl("not a url")).toThrow(/valid URL/);
    expect(() => validateLiveUrl("ftp://example.com/x")).toThrow(/Unsupported URL scheme/);
  });

  it("writes a nested upload tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fv-upload-"));
    try {
      const paths = await writeUploadTree(dir, [
        { relPath: "nested/index.html", data: Buffer.from("<html>ok</html>") },
      ]);
      expect(paths).toEqual(["nested/index.html"]);
      expect(await readFile(join(dir, "nested/index.html"), "utf-8")).toBe("<html>ok</html>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
