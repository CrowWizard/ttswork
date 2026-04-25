import { createHash, randomBytes } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Session, User } from "@prisma/client";
import type { AppConfig } from "./config";
import { DEFAULT_SESSION_COOKIE_NAME } from "./constants";
import { errorResponse } from "./http";
import { prisma } from "./prisma";

type SessionWithUser = Session & { user: User };

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildCookieOptions(cfg: AppConfig) {
  return {
    httpOnly: true as const,
    sameSite: cfg.cookie.sameSite,
    secure: cfg.cookie.secure,
    path: "/",
    maxAge: cfg.auth.sessionTtlSeconds,
  };
}

function getSessionCookieName(cfg: AppConfig) {
  return cfg.auth.sessionCookieName || DEFAULT_SESSION_COOKIE_NAME;
}

export function clearSessionCookie(c: Context, cfg: AppConfig) {
  setCookie(c, getSessionCookieName(cfg), "", {
    ...buildCookieOptions(cfg),
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function createUserSession(c: Context, cfg: AppConfig, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + cfg.auth.sessionTtlSeconds * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      lastSeenAt: new Date(),
    },
  });

  setCookie(c, getSessionCookieName(cfg), token, buildCookieOptions(cfg));
}

export async function destroyCurrentSession(c: Context, cfg: AppConfig) {
  const token = getCookie(c, getSessionCookieName(cfg));
  clearSessionCookie(c, cfg);

  if (!token) {
    return;
  }

  await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

export async function resolveCurrentSession(c: Context, cfg: AppConfig): Promise<SessionWithUser | null> {
  const token = getCookie(c, getSessionCookieName(cfg));

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session) {
    clearSessionCookie(c, cfg);
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    clearSessionCookie(c, cfg);
    return null;
  }

  const touchThreshold = cfg.auth.sessionTouchIntervalSeconds * 1000;
  if (Date.now() - session.lastSeenAt.getTime() >= touchThreshold) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }

  return session;
}

export async function requireCurrentUser(c: Context, cfg: AppConfig): Promise<User | null> {
  const session = await resolveCurrentSession(c, cfg);
  return session?.user ?? null;
}

export function unauthorizedResponse(c: Context) {
  return errorResponse(c, "请先登录", 401);
}
