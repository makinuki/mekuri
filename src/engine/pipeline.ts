// Host-owned image pipeline primitives. The engine never fetches: it counts
// attempts, schedules retries, and keeps a serializable record of what failed,
// while the host resolves sources and the view reports load outcomes.

import type { MekuriFailureRecord, MekuriPage } from "./types";

/** Failure code for a resolver that rejected or threw. */
export const RESOLVE_FAILED = "RESOLVE_FAILED";

/** Failure code for an image element that reported a load error. */
export const IMAGE_LOAD_FAILED = "IMAGE_LOAD_FAILED";

/** Auto-retries performed after a failure before escalation to the registry. */
export const DEFAULT_MAX_AUTO_RETRIES = 2;

/** Base delay of the exponential retry backoff. */
export const DEFAULT_RETRY_DELAY_MS = 400;

/** Decode constraints a host uses to request a smaller image variant. */
export interface MekuriDecodeConstraints {
  maxWidth: number;
  maxHeight: number;
}

/** Pipeline state for one page. The record is internal to the engine and is
 * reported field by field; hosts read it, never write it. */
export interface MekuriPageRequest {
  /** One-based attempt counter; zero before the first resolve. */
  attempt: number;
  /** Display source of the current attempt, absent until a resolve succeeds. */
  src?: string;
  /** Most recent failure, absent while the pipeline has no failure to report. */
  failure?: MekuriFailureRecord;
  /** True while an automatic retry is scheduled for the page. */
  retryScheduled: boolean;
}

/** Delay before the retry that follows an attempt. Doubles per attempt so a
 * failing host is not hammered while the reader stays usable. */
export function retryDelayMs(attempt: number, baseMs: number = DEFAULT_RETRY_DELAY_MS): number {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

/** Message for a thrown value. The thrown value itself is never retained, so
 * the failure registry stays serializable. */
export function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

/** Default resolver, used when the host configures no resolver: the source the
 * host attached to the page metadata. Hosts that serve images themselves
 * replace it through the resolveSrc option. */
export function defaultSrcResolver(page: MekuriPage): string {
  const metadata = page.metadata ?? {};
  const src = metadata["src"];
  return typeof src === "string" ? src : "";
}
