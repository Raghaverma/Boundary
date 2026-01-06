/**
 * Circuit breaker implementation with state machine
 */

import {
  CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStatus,
  NormalizedError,
} from "../core/types.js";

export class CircuitOpenError extends Error implements NormalizedError {
  type = "CIRCUIT_OPEN" as const;
  provider: string;
  actionable: string;
  retryable = false;
  retryAfter?: Date;

  constructor(provider: string, retryAfter?: Date) {
    super(`Circuit breaker is OPEN for provider: ${provider}`);
    this.name = "CircuitOpenError";
    this.provider = provider;
    this.actionable = `Circuit breaker is open. Retry after ${retryAfter?.toISOString() ?? "unknown"}`;
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter;
    }
  }
}

interface CircuitResult {
  success: boolean;
  timestamp: number;
}

export class ProviderCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private nextAttempt: Date | null = null;
  private recentResults: CircuitResult[] = [];
  private config: Required<CircuitBreakerConfig>;
  private provider: string;

  constructor(provider: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.provider = provider;
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 2,
      timeout: config.timeout ?? 60000,
      volumeThreshold: config.volumeThreshold ?? 10,
      rollingWindowMs: config.rollingWindowMs ?? 60000,
      errorThresholdPercentage: config.errorThresholdPercentage ?? 50,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is OPEN and we should reject immediately
    if (this.state === CircuitState.OPEN) {
      if (this.nextAttempt && Date.now() < this.nextAttempt.getTime()) {
        throw new CircuitOpenError(this.provider, this.nextAttempt);
      }
      // Timeout expired, transition to HALF_OPEN
      this.state = CircuitState.HALF_OPEN;
      this.successes = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.addResult({ success: true, timestamp: Date.now() });

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        // Transition to CLOSED
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.nextAttempt = null;
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.addResult({ success: false, timestamp: Date.now() });

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in HALF_OPEN immediately opens the circuit
      this.state = CircuitState.OPEN;
      this.failures = 0;
      this.nextAttempt = new Date(Date.now() + this.config.timeout);
    } else if (this.state === CircuitState.CLOSED) {
      this.failures++;

      // Check if we should open the circuit
      if (this.shouldOpenCircuit()) {
        this.state = CircuitState.OPEN;
        this.nextAttempt = new Date(Date.now() + this.config.timeout);
      }
    }
  }

  private shouldOpenCircuit(): boolean {
    // Need minimum volume before we can open
    if (this.recentResults.length < this.config.volumeThreshold) {
      return false;
    }

    // Check failure threshold
    if (this.failures >= this.config.failureThreshold) {
      return true;
    }

    // Check error rate in rolling window
    const windowStart = Date.now() - this.config.rollingWindowMs;
    const recentInWindow = this.recentResults.filter(
      (r) => r.timestamp >= windowStart
    );

    if (recentInWindow.length < this.config.volumeThreshold) {
      return false;
    }

    const failuresInWindow = recentInWindow.filter((r) => !r.success).length;
    const errorRate = (failuresInWindow / recentInWindow.length) * 100;

    return errorRate >= this.config.errorThresholdPercentage;
  }

  private addResult(result: CircuitResult): void {
    this.recentResults.push(result);

    // Clean up old results outside the rolling window
    const windowStart = Date.now() - this.config.rollingWindowMs;
    this.recentResults = this.recentResults.filter(
      (r) => r.timestamp >= windowStart
    );
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure:
        this.recentResults
          .filter((r) => !r.success)
          .sort((a, b) => b.timestamp - a.timestamp)[0]?.timestamp
          ? new Date(
              this.recentResults
                .filter((r) => !r.success)
                .sort((a, b) => b.timestamp - a.timestamp)[0]!.timestamp
            )
          : null,
      nextAttempt: this.nextAttempt,
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = null;
    this.recentResults = [];
  }
}

