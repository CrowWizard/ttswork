import { Context } from "hono";
import { isDebugEnabled } from "./logger";

function getRequestId(c: Context) {
  return (c as Context & { get: (key: string) => unknown }).get("requestId") as string | undefined;
}

type ErrorResponseOptions = {
  details?: Record<string, unknown>;
};

export function errorResponse(c: Context, message: string, status = 400, options: ErrorResponseOptions = {}) {
  const requestId = getRequestId(c);
  const payload: Record<string, unknown> = {
    error: message,
  };

  if (requestId) {
    payload.requestId = requestId;
  }

  if (isDebugEnabled() && options.details) {
    payload.debug = options.details;
  }

  return c.json(payload, status as 400);
}
