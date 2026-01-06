/**
 * Pagination normalization utilities
 */

import type { PaginationStrategy, RawResponse, RequestOptions } from "../core/types.js";

export class CursorPaginationStrategy implements PaginationStrategy {
  private cursorHeader: string;
  private cursorQueryParam: string;
  private totalHeader?: string;

  constructor(
    cursorHeader: string = "X-Cursor",
    cursorQueryParam: string = "cursor",
    totalHeader?: string
  ) {
    this.cursorHeader = cursorHeader;
    this.cursorQueryParam = cursorQueryParam;
    if (totalHeader !== undefined) {
      this.totalHeader = totalHeader;
    }
  }

  extractCursor(response: RawResponse): string | null {
    const cursor = response.headers.get(this.cursorHeader);
    if (cursor) {
      return cursor;
    }

    // Try to extract from body if it's an object
    if (
      typeof response.body === "object" &&
      response.body !== null &&
      "cursor" in response.body
    ) {
      const body = response.body as { cursor?: string };
      const bodyCursor = body.cursor;
      return bodyCursor ?? null;
    }

    return null;
  }

  extractTotal(response: RawResponse): number | null {
    if (this.totalHeader) {
      const total = response.headers.get(this.totalHeader);
      if (total) {
        return parseInt(total, 10);
      }
    }

    // Try to extract from body
    if (
      typeof response.body === "object" &&
      response.body !== null &&
      "total" in response.body
    ) {
      const body = response.body as { total?: number };
      return body.total ?? null;
    }

    return null;
  }

  hasNext(response: RawResponse): boolean {
    const cursor = this.extractCursor(response);
    return cursor !== null && cursor !== "";
  }

  buildNextRequest(
    endpoint: string,
    options: RequestOptions,
    cursor: string
  ): { endpoint: string; options: RequestOptions } {
    const url = new URL(endpoint, "http://dummy");
    url.searchParams.set(this.cursorQueryParam, cursor);

    return {
      endpoint: url.pathname + url.search,
      options: {
        ...options,
        query: {
          ...options.query,
          [this.cursorQueryParam]: cursor,
        },
      },
    };
  }
}

export class OffsetPaginationStrategy implements PaginationStrategy {
  private offsetQueryParam: string;
  private limitQueryParam: string;
  private totalHeader?: string;
  private defaultLimit: number;

  constructor(
    offsetQueryParam: string = "offset",
    limitQueryParam: string = "limit",
    totalHeader?: string,
    defaultLimit: number = 100
  ) {
    this.offsetQueryParam = offsetQueryParam;
    this.limitQueryParam = limitQueryParam;
    if (totalHeader !== undefined) {
      this.totalHeader = totalHeader;
    }
    this.defaultLimit = defaultLimit;
  }

  extractCursor(response: RawResponse): string | null {
    // For offset-based, cursor is the next offset
    const currentOffset =
      typeof response.body === "object" &&
      response.body !== null &&
      "offset" in response.body
        ? (response.body as { offset?: number }).offset ?? 0
        : 0;

    const limit =
      typeof response.body === "object" &&
      response.body !== null &&
      "limit" in response.body
        ? (response.body as { limit?: number }).limit ?? this.defaultLimit
        : this.defaultLimit;

    const total = this.extractTotal(response);
    if (total !== null && currentOffset + limit >= total) {
      return null; // No more pages
    }

    return String(currentOffset + limit);
  }

  extractTotal(response: RawResponse): number | null {
    if (this.totalHeader) {
      const total = response.headers.get(this.totalHeader);
      if (total) {
        return parseInt(total, 10);
      }
    }

    if (
      typeof response.body === "object" &&
      response.body !== null &&
      "total" in response.body
    ) {
      const body = response.body as { total?: number };
      return body.total ?? null;
    }

    return null;
  }

  hasNext(response: RawResponse): boolean {
    const cursor = this.extractCursor(response);
    return cursor !== null;
  }

  buildNextRequest(
    endpoint: string,
    options: RequestOptions,
    cursor: string
  ): { endpoint: string; options: RequestOptions } {
    const offset = parseInt(cursor, 10);
    const limitValue = options.query?.[this.limitQueryParam];
    const limit =
      typeof limitValue === "number"
        ? limitValue
        : typeof limitValue === "string"
          ? parseInt(limitValue, 10)
          : this.defaultLimit;

    return {
      endpoint,
      options: {
        ...options,
        query: {
          ...options.query,
          [this.offsetQueryParam]: String(offset),
          [this.limitQueryParam]: String(limit),
        },
      },
    };
  }
}

