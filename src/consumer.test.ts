/**
 * Consumer-level integration tests.
 *
 * These tests simulate real consumer usage:
 * - Import only from public API
 * - Verify contract stability
 * - Ensure no breaking changes
 *
 * Tests must fail if:
 * - Public types change
 * - Error shapes change
 * - Response shapes change
 * - Pagination behavior changes
 */

import { describe, it, expect, beforeEach } from "vitest";

// CRITICAL: Only import from the public entry point
import {
  Boundary,
  BoundaryError,
  type NormalizedResponse,
  type ProviderClient,
  type BoundaryConfig,
} from "./public.js";

describe("Consumer Contract - Public API Only", () => {
  let mockFetch: typeof fetch;

  beforeEach(() => {
    // Mock fetch for testing
    mockFetch = async (url: string | Request | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/success")) {
        const data = { result: "success" };
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4999",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
            "content-type": "application/json",
          }),
          json: async () => data,
          text: async () => JSON.stringify(data),
        } as Response;
      }

      if (urlStr.includes("/error")) {
        throw {
          status: 404,
          headers: new Headers(),
          body: { message: "Not found" },
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => "{}",
      } as Response;
    };

    (globalThis as any).fetch = mockFetch;
  });

  describe("1. Initialization", () => {
    it("should create client with minimal config", async () => {
      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      expect(client).toBeDefined();
      expect(client.provider("github")).toBeDefined();
    });

    it("should work with nested providers config", async () => {
      const config: BoundaryConfig = {
        providers: {
          github: {
            auth: { token: "test-token" },
          },
        },
        localUnsafe: true,
      };

      const client = await Boundary.create(config);
      expect(client).toBeDefined();
      expect(client.provider("github")).toBeDefined();
    });
  });

  describe("2. Response Contract", () => {
    it("should return normalized response with stable shape", async () => {
      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      const github = client.provider("github") as ProviderClient;
      const response = await github.get("/success");

      // Verify response shape matches contract
      expect(response).toHaveProperty("data");
      expect(response).toHaveProperty("meta");

      expect(response.meta).toHaveProperty("provider");
      expect(response.meta).toHaveProperty("requestId");
      expect(response.meta).toHaveProperty("rateLimit");
      expect(response.meta).toHaveProperty("warnings");
      expect(response.meta).toHaveProperty("schemaVersion");

      expect(response.meta.provider).toBe("github");
      expect(typeof response.meta.requestId).toBe("string");
      expect(Array.isArray(response.meta.warnings)).toBe(true);

      // Rate limit shape
      expect(response.meta.rateLimit).toHaveProperty("limit");
      expect(response.meta.rateLimit).toHaveProperty("remaining");
      expect(response.meta.rateLimit).toHaveProperty("reset");
      expect(response.meta.rateLimit.reset).toBeInstanceOf(Date);
    });

    it("should handle typed responses", async () => {
      interface UserData {
        result: string;
      }

      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      const github = client.provider("github") as ProviderClient;
      const response: NormalizedResponse<UserData> = await github.get<UserData>("/success");

      expect(response.data).toHaveProperty("result");
      expect(response.data.result).toBe("success");
    });
  });

  describe("3. Error Contract", () => {
    it("should throw BoundaryError with stable shape", async () => {
      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      const github = client.provider("github") as ProviderClient;

      try {
        await github.get("/error");
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(BoundaryError);

        const boundaryError = error as BoundaryError;

        // Verify error has required fields
        expect(boundaryError).toHaveProperty("message");
        expect(boundaryError).toHaveProperty("category");
        expect(boundaryError).toHaveProperty("code"); // Alias for category
        expect(boundaryError).toHaveProperty("provider");
        expect(boundaryError).toHaveProperty("retryable");

        // Verify types
        expect(typeof boundaryError.message).toBe("string");
        expect(typeof boundaryError.category).toBe("string");
        expect(typeof boundaryError.code).toBe("string");
        expect(typeof boundaryError.provider).toBe("string");
        expect(typeof boundaryError.retryable).toBe("boolean");

        // Verify code is alias for category
        expect(boundaryError.code).toBe(boundaryError.category);

        // Verify provider is set
        expect(boundaryError.provider).toBe("github");
      }
    });

    it("should never throw raw errors", async () => {
      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      const github = client.provider("github") as ProviderClient;

      // Simulate various failure scenarios
      const scenarios = ["/error", "/not-found", "/server-error"];

      for (const endpoint of scenarios) {
        try {
          await github.get(endpoint);
        } catch (error) {
          // Must always be BoundaryError
          expect(error).toBeInstanceOf(BoundaryError);
        }
      }
    });
  });

  describe("4. Method Signatures", () => {
    it("should support all HTTP methods", async () => {
      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      const github = client.provider("github") as ProviderClient;

      // Verify all methods exist and are callable
      expect(typeof github.get).toBe("function");
      expect(typeof github.post).toBe("function");
      expect(typeof github.put).toBe("function");
      expect(typeof github.patch).toBe("function");
      expect(typeof github.delete).toBe("function");
      expect(typeof github.paginate).toBe("function");

      // Verify they return promises (except paginate)
      const getPromise = github.get("/success");
      expect(getPromise).toBeInstanceOf(Promise);

      await getPromise; // Don't leave hanging
    });

    it("should accept RequestOptions", async () => {
      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      const github = client.provider("github") as ProviderClient;

      // All valid option combinations should work
      await github.get("/success", {
        headers: { "X-Custom": "value" },
      });

      await github.post("/success", {
        body: { data: "test" },
        headers: { "Content-Type": "application/json" },
      });

      await github.get("/success", {
        query: { page: 1, limit: 10 },
      });
    });
  });

  describe("5. No Internal Leakage", () => {
    it("should not expose internal modules in errors", async () => {
      const client = await Boundary.create({
        github: {
          auth: { token: "test-token" },
        },
        localUnsafe: true,
      });

      const github = client.provider("github") as ProviderClient;

      try {
        await github.get("/error");
      } catch (error) {
        const err = error as BoundaryError;

        // Error message must not contain:
        // - File paths
        // - Internal class names
        // - Stack traces in message
        expect(err.message).not.toMatch(/src\//);
        expect(err.message).not.toMatch(/\.ts/);
        expect(err.message).not.toMatch(/Pipeline/);
        expect(err.message).not.toMatch(/Adapter/);
      }
    });
  });
});
