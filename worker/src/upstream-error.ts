export type UpstreamErrorCategory =
  | "auth"
  | "network"
  | "rate_limit"
  | "upstream"
  | "bad_request"
  | "unknown";

export interface ClassifiedUpstreamError {
  category: UpstreamErrorCategory;
  message: string;
  retryable: boolean;
  status: number;
}

export class UpstreamError extends Error {
  category: UpstreamErrorCategory;
  retryable: boolean;
  status: number;

  constructor(message: string, opts: { category: UpstreamErrorCategory; retryable: boolean; status: number }) {
    super(message);
    this.name = "UpstreamError";
    this.category = opts.category;
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

const statusFromError = (err: unknown): number | undefined => {
  const candidate = err as { status?: unknown; code?: unknown };
  const status = typeof candidate?.status === "number" ? candidate.status : candidate?.code;
  if (typeof status === "number" && Number.isInteger(status)) return status;
  if (typeof status === "string" && /^\d+$/.test(status)) return Number(status);
  return undefined;
};

const messageFromError = (err: unknown, fallback = "upstream error") => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
};

// Auth signals are intentionally narrow: a generic error message containing the
// word "expired" or "unauthorized" must not be classified as an auth failure
// because that would trigger markAuthFailure on unrelated upstream incidents.
// Match either an HTTP 401/403 status, or anchored phrases the worker raises
// itself, or TradingView's specific session-rejection wording.
const AUTH_PHRASES = [
  /\bwrong or expired sessionid\b/i,
  /\bsessionid not returned\b/i,
  /\bsessionid expired\b/i,
  /\bsession expired\b/i,
  /\bexpired sessionid\b/i,
  /\binvalid sessionid\b/i,
  /\bauthorization required\b/i,
  /\bauth_token required\b/i,
  /\bunauthorized_user_token\b/i,
  /\bauth token request failed: 40[13]\b/i,
  /:\s*40[13]\b/,
  /\bhttp\/?\s*1\.[01]\s+40[13]\b/i,
];

const NETWORK_PHRASES = [
  /\bfetch failed\b/i,
  /\bconnection (timeout|closed|reset|refused)\b/i,
  /\bhandshake (timeout|failed)\b/i,
  /\bsocket (closed|hang up)\b/i,
  /\bnetwork (error|unreachable)\b/i,
  /\beconnreset\b/i,
  /\beconnrefused\b/i,
  /\benotfound\b/i,
  /\betimedout\b/i,
  /\beai_again\b/i,
];

const RATE_LIMIT_PHRASES = [/\brate limit(ed)?\b/i, /\btoo many requests\b/i];

const matchesAny = (input: string, patterns: RegExp[]) => patterns.some((p) => p.test(input));

export const classifyUpstreamError = (
  err: unknown,
  fallback = "upstream error",
): ClassifiedUpstreamError => {
  if (err instanceof UpstreamError) {
    return {
      category: err.category,
      message: err.message,
      retryable: err.retryable,
      status: err.status,
    };
  }

  const message = messageFromError(err, fallback);
  const status = statusFromError(err);

  if (status === 401 || status === 403 || matchesAny(message, AUTH_PHRASES)) {
    return { category: "auth", message, retryable: false, status: 401 };
  }

  if (status === 429 || matchesAny(message, RATE_LIMIT_PHRASES)) {
    return { category: "rate_limit", message, retryable: true, status: 429 };
  }

  if (matchesAny(message, NETWORK_PHRASES)) {
    return { category: "network", message, retryable: true, status: 503 };
  }

  if (status && status >= 500) {
    return { category: "upstream", message, retryable: true, status };
  }

  if (status && status >= 400) {
    return { category: "bad_request", message, retryable: false, status };
  }

  return { category: "unknown", message, retryable: false, status: 500 };
};

export const toUpstreamError = (err: unknown, fallback?: string) => {
  const classified = classifyUpstreamError(err, fallback);
  return new UpstreamError(classified.message, classified);
};
