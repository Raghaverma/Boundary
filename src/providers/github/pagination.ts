/**
 * GitHub-specific pagination strategy using Link headers (RFC 5988)
 */

import type { PaginationStrategy, RawResponse, RequestOptions } from "../../core/types.js";
import { parseLinkHeader, findLinkByRel } from "../../core/header-parser.js";

export class GitHubPaginationStrategy implements PaginationStrategy {
  extractCursor(response: RawResponse): string | null {
    const linkHeader = response.headers.get("Link");
    if (!linkHeader) {
      return null;
    }

    // Use hardened Link header parser
    const links = parseLinkHeader(linkHeader);
    const nextLink = findLinkByRel(links, "next");

    if (!nextLink) {
      return null;
    }

    // Extract page number from URL safely
    try {
      const url = new URL(nextLink.url);
      const page = url.searchParams.get("page");
      return page;
    } catch {
      // Invalid URL - return null
      return null;
    }
  }

  extractTotal(response: RawResponse): number | null {
    // GitHub doesn't always provide total count
    // Some endpoints use X-Total-Count header
    const totalHeader = response.headers.get("X-Total-Count");
    if (totalHeader) {
      const parsed = parseInt(totalHeader, 10);
      // Validate the parsed value
      if (!isNaN(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER) {
        return parsed;
      }
    }

    return null;
  }

  hasNext(response: RawResponse): boolean {
    const linkHeader = response.headers.get("Link");
    if (!linkHeader) {
      return false;
    }

    const links = parseLinkHeader(linkHeader);
    return findLinkByRel(links, "next") !== null;
  }

  buildNextRequest(
    endpoint: string,
    options: RequestOptions,
    cursor: string
  ): { endpoint: string; options: RequestOptions } {
    return {
      endpoint,
      options: {
        ...options,
        query: {
          ...options.query,
          page: cursor,
        },
      },
    };
  }
}

