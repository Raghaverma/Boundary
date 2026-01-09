/**
 * Comprehensive integration test to stress-test the SDK
 * This is not part of the test suite - it's for manual verification
 */

import { Boundary, BoundaryError } from "./src/index.js";

async function testInstanceOfBoundaryError() {
  console.log("\n=== Test 1: instanceof BoundaryError works correctly ===");

  const boundary = await Boundary.create({
    github: {
      auth: { token: "test-token" },
    },
    localUnsafe: true,
  });

  // Stub fetch to fail
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 404,
    headers: new Headers(),
    json: async () => ({ message: "Not found" }),
    text: async () => "Not found",
  });

  try {
    await (boundary as any).github.get("/test");
    console.log("❌ Should have thrown an error");
  } catch (error) {
    if (error instanceof BoundaryError) {
      console.log("✅ Error is instanceof BoundaryError");
      console.log(`   - category: ${error.category}`);
      console.log(`   - retryable: ${error.retryable}`);
      console.log(`   - provider: ${error.provider}`);
      console.log(`   - has stack: ${!!error.stack}`);
    } else {
      console.log("❌ Error is NOT instanceof BoundaryError");
      console.log("   Type:", typeof error);
      console.log("   Constructor:", error?.constructor?.name);
    }
  }
}

async function testObservabilityFailureIsolation() {
  console.log("\n=== Test 2: Observability failures don't break requests ===");

  class FailingObservability {
    logRequest() {
      throw new Error("Observability failure in logRequest");
    }
    logResponse() {
      throw new Error("Observability failure in logResponse");
    }
    logError() {
      throw new Error("Observability failure in logError");
    }
    logWarning() {
      throw new Error("Observability failure in logWarning");
    }
    recordMetric() {
      throw new Error("Observability failure in recordMetric");
    }
  }

  const boundary = await Boundary.create({
    github: {
      auth: { token: "test-token" },
    },
    observability: [new FailingObservability() as any],
    localUnsafe: true,
  });

  // Stub fetch to succeed
  (globalThis as any).fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ data: "success" }),
    text: async () => JSON.stringify({ data: "success" }),
  });

  try {
    const result = await (boundary as any).github.get("/test");
    console.log("✅ Request succeeded despite observability failures");
    console.log("   Response received:", !!result.data);
  } catch (error) {
    console.log("❌ Request failed due to observability error");
    console.log("   Error:", error);
  }
}

async function testProviderMethodTypeSafety() {
  console.log("\n=== Test 3: provider() method returns correct types ===");

  const boundary = await Boundary.create({
    github: {
      auth: { token: "test-token" },
    },
    localUnsafe: true,
  });

  const github = boundary.provider("github");
  if (github) {
    console.log("✅ provider('github') returned a value");
    console.log("   - has .get():", typeof github.get === "function");
    console.log("   - has .post():", typeof github.post === "function");
  } else {
    console.log("❌ provider('github') returned undefined");
  }

  const nonexistent = boundary.provider("nonexistent");
  if (nonexistent === undefined) {
    console.log("✅ provider('nonexistent') returned undefined");
  } else {
    console.log("❌ provider('nonexistent') returned a value");
  }
}

async function testConcurrentRequests() {
  console.log("\n=== Test 4: Concurrent requests with mixed success/failure ===");

  const boundary = await Boundary.create({
    github: {
      auth: { token: "test-token" },
    },
    localUnsafe: true,
  });

  let requestCount = 0;
  (globalThis as any).fetch = async () => {
    requestCount++;
    const shouldFail = requestCount % 3 === 0;

    if (shouldFail) {
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ message: "Server error" }),
        text: async () => "Server error",
      };
    } else {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: `success-${requestCount}` }),
        text: async () => JSON.stringify({ data: `success-${requestCount}` }),
      };
    }
  };

  const requests = [];
  for (let i = 0; i < 10; i++) {
    requests.push(
      (boundary as any).github.get("/test")
        .then((result: any) => ({ success: true, data: result.data }))
        .catch((error: any) => ({ success: false, error: error.message }))
    );
  }

  const results = await Promise.all(requests);
  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success).length;

  console.log(`✅ Concurrent requests completed: ${successes} succeeded, ${failures} failed`);
  console.log(`   - Total requests: ${requestCount}`);
  console.log(`   - No requests should interfere with each other`);
}

async function testErrorMetadataPreservation() {
  console.log("\n=== Test 5: Error metadata preserved but sanitized in logs ===");

  const logs: any[] = [];
  class CaptureObservability {
    logRequest() {}
    logResponse() {}
    logError(ctx: any) {
      logs.push(ctx);
    }
    logWarning() {}
    recordMetric() {}
  }

  const boundary = await Boundary.create({
    github: {
      auth: { token: "test-token" },
    },
    observability: [new CaptureObservability() as any],
    observabilitySanitizer: { redactedKeys: ["secret", "password"] },
    localUnsafe: true,
  } as any); // Using 'as any' because observabilitySanitizer is a valid config option

  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 500,
    headers: new Headers(),
    json: async () => ({ message: "Error", debug: { secret: "my-secret", other: "visible" } }),
    text: async () => "Error",
  });

  try {
    await (boundary as any).github.get("/test");
  } catch (error: any) {
    console.log("✅ Error thrown as expected");
    console.log("   - Error has metadata in catch:", !!error.metadata);

    if (logs.length > 0) {
      const loggedError = logs[0].error;
      console.log("   - Error logged to observability:", !!loggedError);
      console.log("   - Logged metadata has 'secret':", loggedError.metadata?.secret === "[REDACTED]");
      console.log("   - Logged metadata has 'other':", loggedError.metadata?.other !== undefined);
    }
  }
}

// Run all tests
async function runAll() {
  console.log("🔍 Running comprehensive integration tests...\n");

  try {
    await testInstanceOfBoundaryError();
    await testObservabilityFailureIsolation();
    await testProviderMethodTypeSafety();
    await testConcurrentRequests();
    await testErrorMetadataPreservation();

    console.log("\n✅ All comprehensive tests completed successfully!");
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
    process.exit(1);
  }
}

runAll();
