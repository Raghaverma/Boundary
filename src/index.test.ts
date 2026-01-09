/**
 * Regression test: Built-in adapters auto-registration
 */

import { describe, it, expect } from "vitest";
import { Boundary } from "./index.js";

describe("Boundary - Built-in Adapter Auto-Registration", () => {
  it("should auto-register GitHub adapter without explicit adapter parameter", async () => {
    // This should not throw - GitHub adapter should be auto-registered
    const boundary = await Boundary.create({
      github: {
        auth: { token: "test-token" },
      },
      localUnsafe: true,
    });

    // Constructor should succeed
    expect(boundary).toBeDefined();
    
    // GitHub provider should be available
    expect((boundary as any).github).toBeDefined();
  });

  it("should work with nested providers config", async () => {
    // Nested config should also work
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

