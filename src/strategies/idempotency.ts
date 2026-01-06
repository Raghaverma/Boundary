/**
 * Idempotency level resolver
 */

import {
  IdempotencyLevel,
  type IdempotencyConfig,
  type RequestOptions,
} from "../core/types.js";

export class IdempotencyResolver {
  private config: IdempotencyConfig;
  private defaultLevel: IdempotencyLevel;

  constructor(
    config: Partial<IdempotencyConfig>,
    defaultLevel: IdempotencyLevel = IdempotencyLevel.SAFE
  ) {
    this.config = {
      defaultSafeOperations:
        config.defaultSafeOperations ??
        new Set(["GET", "HEAD", "OPTIONS"]),
      operationOverrides: config.operationOverrides ?? new Map(),
    };
    this.defaultLevel = defaultLevel;
  }

  getIdempotencyLevel(
    method: string,
    endpoint: string,
    _options: RequestOptions
  ): IdempotencyLevel {
    // Check for operation-specific override
    const operationKey = `${method} ${endpoint}`;
    const override = this.findOverride(operationKey);
    if (override !== null) {
      return override;
    }

    // Check if method is in default safe operations
    if (this.config.defaultSafeOperations.has(method.toUpperCase())) {
      return IdempotencyLevel.SAFE;
    }

    // Default to configured default level
    return this.defaultLevel;
  }

  private findOverride(operationKey: string): IdempotencyLevel | null {
    // Exact match
    if (this.config.operationOverrides.has(operationKey)) {
      return this.config.operationOverrides.get(operationKey)!;
    }

    // Pattern matching (e.g., "POST /repos/:owner/:repo/pulls")
    for (const [pattern, level] of this.config.operationOverrides.entries()) {
      if (this.matchesPattern(pattern, operationKey)) {
        return level;
      }
    }

    return null;
  }

  private matchesPattern(pattern: string, operationKey: string): boolean {
    // Simple pattern matching: replace :param with regex
    const regexPattern = pattern.replace(
      /:[\w-]+/g,
      "[^/]+"
    );
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(operationKey);
  }

  shouldRetry(
    idempotencyLevel: IdempotencyLevel,
    _error: Error,
    attempt: number,
    maxRetries: number,
    hasIdempotencyKey: boolean
  ): boolean {
    if (idempotencyLevel === IdempotencyLevel.UNSAFE) {
      return false;
    }

    if (idempotencyLevel === IdempotencyLevel.CONDITIONAL) {
      if (!hasIdempotencyKey) {
        return false;
      }
    }

    if (attempt >= maxRetries) {
      return false;
    }

    // SAFE and IDEMPOTENT can retry
    return true;
  }
}

