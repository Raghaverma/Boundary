

import { describe, it, expect } from "vitest";
import { Boundary } from "./index.js";
import { SDK_VERSION } from "./core/types.js";
import packageJson from "../package.json";

describe("Boundary - Built-in Adapter Auto-Registration", () => {
  it("should auto-register GitHub adapter without explicit adapter parameter", async () => {
    
    const boundary = await Boundary.create({
      github: {
        auth: { token: "test-token" },
      },
      localUnsafe: true,
    });

    
    expect(boundary).toBeDefined();
    
    
    expect((boundary as any).github).toBeDefined();
  });

  it("should work with nested providers config", async () => {
    
    const boundary = await Boundary.create({
      providers: {
        github: {
          auth: { token: "test-token" },
        },
      },
      localUnsafe: true,
    });

    expect(boundary).toBeDefined();
    expect((boundary as any).github).toBeDefined();
  });
});

describe("Boundary - Version Consistency", () => {
  it("should expose SDK_VERSION that matches package.json.version", () => {
    
    expect(SDK_VERSION).toBe(packageJson.version);
  });
});