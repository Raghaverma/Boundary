import { describe, it, expect, beforeEach } from "vitest";
import { Boundary } from "../index.js";
import { BoundaryError, type ObservabilityAdapter, type Metric } from "../core/types.js";

class MockObservability implements ObservabilityAdapter {
  public requests: any[] = [];
  public responses: any[] = [];
  public errors: any[] = [];
  public metrics: Metric[] = [];
  logRequest(context: any) { this.requests.push(context); }
  logResponse(context: any) { this.responses.push(context); }
  logError(context: any) { this.errors.push(context); }
  logWarning(message: string, metadata?: Record<string, unknown>) {}
  recordMetric(metric: Metric) { this.metrics.push(metric); }
}

// Minimal test adapter to avoid network calls
class TestAdapter {
  provider = "test";
  async authStrategy(config: any) {
    return { token: "tok" };
  }
  buildRequest(input: any) {
    return {
      url: "https://example.test/ok",
      method: input.options.method ?? "GET",
      headers: input.options.headers ?? {},
      body: typeof input.options.body === "string" ? input.options.body : JSON.stringify(input.options.body ?? {}),
    };
  }
  parseResponse(raw: any) {
    return {
      data: raw.body,
      meta: {
        provider: "test",
        requestId: "r1",
        rateLimit: { limit: 100, remaining: 99, reset: new Date() },
        warnings: [],
        schemaVersion: "1.0.0",
      }
    };
  }
  parseError(raw: any) {
    return new BoundaryError(
      "Provider error",
      "provider" as const,
      "test",
      false,
      { secret: "should-not-be-logged", inner: { apiKey: "topsecret" } }
    );
  }
  rateLimitPolicy(headers: Headers) {
    return { limit: 100, remaining: 99, reset: new Date() };
  }
  paginationStrategy() {
    return {
      extractCursor: () => null,
      extractTotal: () => null,
      hasNext: () => false,
      buildNextRequest: () => ({ endpoint: "", options: {} }),
    };
  }
  getIdempotencyConfig() {
    return { defaultSafeOperations: new Set(), operationOverrides: new Map() };
  }
}

describe("Observability sanitizer", () => {
  let mock: MockObservability;

  beforeEach(() => {
    mock = new MockObservability();
  });

  it("redacts secrets from request logs and metrics", async () => {
    // stub global fetch to avoid network
    (globalThis as any).fetch = async () => {
      const headers = new Headers({ "content-type": "application/json" });
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      };
    };

    const adapters = new Map();
    adapters.set("test", new (TestAdapter as any)());

    const boundary = await Boundary.create({
      providers: { test: { auth: { token: "t" } } },
      observability: [mock as any],
      observabilitySanitizer: { redactedKeys: ["authorization", "apikey", "body"] },
      localUnsafe: true,
    }, adapters as any);

    await (boundary as any).test.get("/endpoint", { headers: { Authorization: "Bearer secret", "X-Api-Key": "abc" }, body: { password: "p" } });

    // Request should be sanitized
    expect(mock.requests.length).toBeGreaterThan(0);
    const req = mock.requests[0];
    expect(req.options.headers.Authorization).toBe("[REDACTED]");
    expect(req.options.headers["X-Api-Key"]).toBe("[REDACTED]");
    expect(req.options.body).toBe("[REDACTED]");

    // Metrics should have sanitized tags
    expect(mock.metrics.length).toBeGreaterThan(0);
    const m = mock.metrics.find(mm => mm.name === "boundary.request.count");
    expect(m).toBeDefined();
    expect(m!.tags.provider).toBe("test");
  });

  it("redacts secrets from error metadata when adapters return sensitive info", async () => {
    // stub fetch to return non-ok to trigger parseError
    (globalThis as any).fetch = async () => {
      const headers = new Headers({});
      return {
        ok: false,
        status: 500,
        headers,
        json: async () => ({ message: "error" }),
        text: async () => "error",
      };
    };

    const adapters = new Map();
    adapters.set("test", new (TestAdapter as any)());

    const boundary = await Boundary.create({
      providers: { test: { auth: { token: "t" } } },
      observability: [mock as any],
      observabilitySanitizer: { redactedKeys: ["secret", "apikey"] },
      localUnsafe: true,
    }, adapters as any);

    await expect((boundary as any).test.get("/endpoint")).rejects.toBeDefined();

    // Error should be logged with sanitized metadata
    expect(mock.errors.length).toBeGreaterThan(0);
    const err = mock.errors[0];
    expect(err.error.metadata).toBeDefined();
    // secret key should be redacted
    expect(err.error.metadata.secret).toBe("[REDACTED]");
    // nested apiKey should be redacted
    expect(err.error.metadata.inner.apiKey).toBe("[REDACTED]");
  });
});
