import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_ADAPTER_LOADERS,
  BUILTIN_ADAPTER_NAMES,
  getBuiltinAdapter,
} from "./builtin-adapters.js";
import type { ProviderAdapter } from "./core/types.js";
import { ALL_ADAPTER_CLASSES } from "./providers/all-adapters.js";

describe("builtin-adapters registry", () => {
  it("BUILTIN_ADAPTER_NAMES mirrors the loader table keys", () => {
    expect([...BUILTIN_ADAPTER_NAMES].sort()).toEqual(Object.keys(BUILTIN_ADAPTER_LOADERS).sort());
    expect(BUILTIN_ADAPTER_NAMES.length).toBeGreaterThan(0);
  });

  // The lazy runtime table (BUILTIN_ADAPTER_LOADERS) and the eager, test-only
  // map (ALL_ADAPTER_CLASSES) list the same providers by two different means.
  // If they drift, a provider is either silently unroutable at runtime or
  // silently dropped from the contract-test matrix — this guards both.
  it("loader table and eager ALL_ADAPTER_CLASSES cover the same providers", () => {
    expect([...BUILTIN_ADAPTER_NAMES].sort()).toEqual(Object.keys(ALL_ADAPTER_CLASSES).sort());
  });

  it("getBuiltinAdapter resolves, instantiates, and memoizes a known provider", async () => {
    const cache = new Map<string, ProviderAdapter>();
    const first = await getBuiltinAdapter("stripe", cache);
    expect(first).not.toBeNull();
    expect(cache.get("stripe")).toBe(first);
    // A second resolution returns the same memoized instance, no re-import.
    const second = await getBuiltinAdapter("stripe", cache);
    expect(second).toBe(first);
  });

  it("getBuiltinAdapter returns null for an unknown provider", async () => {
    expect(await getBuiltinAdapter("not-a-provider", new Map())).toBeNull();
  });
});

// Regression guard for the bundle tree-shaking property (see CHANGELOG 0.5.x /
// docs/adapters.md): the 46-entry loader table must be reachable from the
// Meridian class ONLY through a dynamic import(), never a static import — that
// isolation is what keeps every unused provider adapter out of the entry chunk
// a bundler traces from `import { Meridian }`.
describe("builtin-adapters stays dynamically-imported from the Meridian core", () => {
  const indexSrc = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

  it("src/index.ts references the loader module via a dynamic import()", () => {
    expect(indexSrc).toMatch(/import\(["']\.\/builtin-adapters\.js["']\)/);
  });

  it("src/index.ts does NOT statically import from ./builtin-adapters", () => {
    // A static `import ... from "./builtin-adapters..."` (or re-export) would
    // fuse the table back into the entry chunk and re-break tree-shaking.
    expect(indexSrc).not.toMatch(/^\s*(import|export)\b[^\n]*from\s+["']\.\/builtin-adapters/m);
  });
});
