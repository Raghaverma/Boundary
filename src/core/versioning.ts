/**
 * SDK versioning management
 */

import { SDK_VERSION } from "./types.js";

export function getSDKVersion(): string {
  return SDK_VERSION;
}

export function getProviderVersion(_provider: string): string {
  // In a real implementation, this would read from provider configs
  // For now, default to v1
  return "v1";
}

