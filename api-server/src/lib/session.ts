import { randomUUID } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import { COOKIE_NAME } from "./constants";
import type { AppConfig } from "./config";
import type { Context } from "hono";

export async function ensureAnonymousUserCookie(c: Context, cookieCfg: AppConfig["cookie"]): Promise<string> {
  let userId = getCookie(c, COOKIE_NAME);

  if (!userId) {
    userId = randomUUID();
    setCookie(c, COOKIE_NAME, userId, {
      httpOnly: true,
      sameSite: "Lax",
      secure: cookieCfg.secure,
      path: "/",
      maxAge: cookieCfg.maxAge,
    });
  }

  return userId;
}
