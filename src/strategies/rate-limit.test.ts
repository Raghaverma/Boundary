/**
 * Rate limiter invariant tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  describe("invariants", () => {
    it("tokens should never go negative", async () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 0.01, // Very slow refill
        maxTokens: 5,
        queueSize: 1, // Small queue for testing
      });

      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }

      // Tokens should be exactly 0, not negative
      expect((limiter as any).tokens).toBe(0);

      // Queue up one request (should be queued, not executed)
      const pending = limiter.acquire();

      // Next acquire should throw (queue full)
      await expect(limiter.acquire()).rejects.toThrow("Rate limit queue is full");

      // Clean up
      limiter.reset();
      await expect(pending).rejects.toThrow("Rate limiter was reset");
    });

    it("elapsed time should be clamped to >= 0 after handle429", async () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 10,
        maxTokens: 10,
        adaptiveBackoff: true,
      });

      // Simulate 429 response with 5 second retry-after
      limiter.handle429(5);

      // Immediately try to acquire - should work because we have tokens
      // but tokens should NOT increase from negative elapsed time
      const initialTokens = (limiter as any).tokens;
      await limiter.acquire();

      // Tokens should have decreased by 1, not increased from negative refill
      expect((limiter as any).tokens).toBe(initialTokens - 1);
    });

    it("tokens should not exceed maxTokens after refill", async () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 1000, // Very high rate
        maxTokens: 10,
      });

      // Use some tokens
      await limiter.acquire();
      await limiter.acquire();

      // Wait for refill
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Acquire should succeed
      await limiter.acquire();

      // Tokens should never exceed maxTokens
      expect((limiter as any).tokens).toBeLessThanOrEqual(10);
    });

    it("reset should clear queue and restore tokens", () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 10,
        maxTokens: 10,
      });

      // Reset
      limiter.reset();

      expect((limiter as any).tokens).toBe(10);
      expect((limiter as any).queue.length).toBe(0);
    });

    it("queue should respect queueSize limit", async () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 0.01, // Very slow refill
        maxTokens: 1,
        queueSize: 2,
      });

      // Exhaust the only token
      await limiter.acquire();

      // Queue up to limit
      const pending1 = limiter.acquire();
      const pending2 = limiter.acquire();

      // Third should throw
      await expect(limiter.acquire()).rejects.toThrow("Rate limit queue is full");

      // Clean up - reset to resolve pending promises
      limiter.reset();
      await expect(pending1).rejects.toThrow("Rate limiter was reset");
      await expect(pending2).rejects.toThrow("Rate limiter was reset");
    });

    it("handle429 should pause token refill for specified duration", async () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 100,
        maxTokens: 10,
        adaptiveBackoff: true,
      });

      // Use 5 tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }

      const tokensAfterAcquire = (limiter as any).tokens;

      // Handle 429 with 1 second retry-after
      limiter.handle429(1);

      // Immediately check - tokens should not have increased
      // (elapsed would be 0 due to clamping)
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger refill by calling acquire
      await limiter.acquire();

      // Tokens should be less (we acquired one), not more from refill
      expect((limiter as any).tokens).toBeLessThan(tokensAfterAcquire);
    });
  });

  describe("adaptive backoff", () => {
    it("should reduce rate when utilization > 80%", () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 10,
        maxTokens: 100,
        adaptiveBackoff: true,
      });

      const initialRate = (limiter as any).config.tokensPerSecond;

      // Simulate high utilization (85% used, 15% remaining)
      limiter.updateFromHeaders(
        new Headers(),
        {
          limit: 100,
          remaining: 15,
          reset: new Date(Date.now() + 3600000),
        }
      );

      // Rate should have been reduced
      expect((limiter as any).config.tokensPerSecond).toBeLessThan(initialRate);
    });

    it("should not adjust rate when adaptiveBackoff is disabled", () => {
      const limiter = new RateLimiter({
        tokensPerSecond: 10,
        maxTokens: 100,
        adaptiveBackoff: false,
      });

      const initialRate = (limiter as any).config.tokensPerSecond;

      // Simulate high utilization
      limiter.updateFromHeaders(
        new Headers(),
        {
          limit: 100,
          remaining: 5,
          reset: new Date(Date.now() + 3600000),
        }
      );

      // Rate should be unchanged
      expect((limiter as any).config.tokensPerSecond).toBe(initialRate);
    });
  });
});
