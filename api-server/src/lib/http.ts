import { Context } from "hono";

export function errorResponse(c: Context, message: string, status = 400) {
  return c.json({ error: message }, status as 400);
}
