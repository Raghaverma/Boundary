/**
 * Regression test: Built-in adapters auto-registration
 */

import { describe, it, expect } from "vitest";
import { Boundary } from "./index.js";

describe("Boundary - Built-in Adapter Auto-Registration", () => {
  it("should auto-register GitHub adapter without explicit adapter parameter", () => {
    // This should not throw - GitHub adapter should be auto-registered
    const boundary = new Boundary({
      github: {
        auth: { token: "test-token" },
      },
    });

    // Constructor should succeed
    expect(boundary).toBeDefined();
    
    // GitHub provider should be available
    expect((boundary as any).github).toBeDefined();
  });

  it("should work with nested providers config", () => {
    // Nested config should also work
    const boundary = new Boundary({
      providers: {
        github: {
          auth: { token: "test-token" },
        },
      },
    });

    expect(boundary).toBeDefined();
    expect((boundary as any).github).toBeDefined();
  });
});

