/**
 * Human-friendly helpers for explaining failed API requests.
 *
 * The raw status code and error message are preserved in the UI, but these
 * helpers translate them into an explanation and a suggested next step so a
 * failure is easy to understand at a glance.
 */

export type FailureRequest = {
  id: number;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  errorMessage: string | null;
  requestHeaders: Record<string, string> | null;
  responseSize: number | null;
  sourceIp: string | null;
  userAgent: string | null;
  createdAt: Date;
};

export interface FailureInfo {
  title: string;
  explanation: string;
  suggestion: string;
}

const STATUS_INFO: Record<number, FailureInfo> = {
  400: {
    title: "Bad Request",
    explanation:
      "The server couldn't understand the request, usually because a parameter was malformed or a required field was missing.",
    suggestion: "Check the request payload and required parameters, then retry.",
  },
  401: {
    title: "Unauthorized",
    explanation:
      "The request was missing valid credentials, or the credentials provided were rejected.",
    suggestion: "Verify the API key or token and sign in again.",
  },
  403: {
    title: "Forbidden",
    explanation:
      "The client is authenticated but does not have permission to access this resource.",
    suggestion: "Confirm the account has the required roles or scopes.",
  },
  404: {
    title: "Not Found",
    explanation: "The requested resource does not exist at this endpoint.",
    suggestion: "Check the resource id and the endpoint path.",
  },
  408: {
    title: "Request Timeout",
    explanation: "The server timed out waiting for the request to complete.",
    suggestion: "Retry with a smaller payload or check network conditions.",
  },
  409: {
    title: "Conflict",
    explanation:
      "The request conflicts with the current state of the resource.",
    suggestion: "Reconcile the conflicting state and retry.",
  },
  422: {
    title: "Unprocessable Entity",
    explanation:
      "The request was understood, but the submitted data failed validation.",
    suggestion: "Fix the invalid fields reported by the API and retry.",
  },
  429: {
    title: "Too Many Requests",
    explanation: "The request was rejected because a rate limit was reached.",
    suggestion: "Wait for the limit window to reset or raise the configured limit.",
  },
  500: {
    title: "Internal Server Error",
    explanation:
      "The server encountered an unexpected error while processing the request.",
    suggestion: "Inspect the server logs for the stack trace.",
  },
  502: {
    title: "Bad Gateway",
    explanation: "An upstream service returned an invalid response.",
    suggestion: "Check the health of the upstream service.",
  },
  503: {
    title: "Service Unavailable",
    explanation: "The service is temporarily overloaded or down.",
    suggestion: "Retry after a short delay.",
  },
  504: {
    title: "Gateway Timeout",
    explanation: "An upstream service took too long to respond.",
    suggestion: "Check the upstream service's performance and timeout settings.",
  },
};

export function failureInfo(statusCode: number): FailureInfo {
  return (
    STATUS_INFO[statusCode] ?? {
      title: `HTTP ${statusCode}`,
      explanation:
        "The request failed, but no specific guidance is available for this status code.",
      suggestion: "Review the error message and request details below.",
    }
  );
}

/** Short one-line reason shown in the failure list. */
export function shortFailureReason(req: FailureRequest): string {
  if (req.errorMessage) return req.errorMessage;
  return failureInfo(req.statusCode).title;
}

export function isFailure(statusCode: number): boolean {
  return statusCode >= 400;
}
