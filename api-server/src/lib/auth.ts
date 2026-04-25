import { createHash, randomBytes } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AnonymousUser, Session, User } from "@prisma/client";
import type { AppConfig } from "./config";
import { DEFAULT_ANONYMOUS_COOKIE_NAME, DEFAULT_SESSION_COOKIE_NAME } from "./constants";
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

function getAnonymousCookieName(cfg: AppConfig) {
  return `${cfg.auth.sessionCookieName || DEFAULT_SESSION_COOKIE_NAME}_${DEFAULT_ANONYMOUS_COOKIE_NAME}`;
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

function hashAnonymousToken(token: string) {
  return hashSessionToken(token);
}

export function clearAnonymousCookie(c: Context, cfg: AppConfig) {
  setCookie(c, getAnonymousCookieName(cfg), "", {
    ...buildCookieOptions(cfg),
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function resolveAnonymousUser(
  c: Context,
  cfg: AppConfig,
  options: { createIfMissing?: boolean } = {},
): Promise<AnonymousUser | null> {
  const cookieName = getAnonymousCookieName(cfg);
  const token = getCookie(c, cookieName);

  if (token) {
    const anonymousUser = await prisma.anonymousUser.findUnique({
      where: { tokenHash: hashAnonymousToken(token) },
    });

    if (anonymousUser && anonymousUser.expiresAt.getTime() > Date.now()) {
      const touchThreshold = cfg.auth.sessionTouchIntervalSeconds * 1000;
      if (Date.now() - anonymousUser.lastSeenAt.getTime() >= touchThreshold) {
        await prisma.anonymousUser.update({
          where: { id: anonymousUser.id },
          data: { lastSeenAt: new Date() },
        });
      }

      return anonymousUser;
    }

    if (anonymousUser) {
      await prisma.anonymousUser.deleteMany({ where: { id: anonymousUser.id } });
    }

    clearAnonymousCookie(c, cfg);
  }

  if (!options.createIfMissing) {
    return null;
  }

  const nextToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + cfg.auth.sessionTtlSeconds * 1000);
  const anonymousUser = await prisma.anonymousUser.create({
    data: {
      tokenHash: hashAnonymousToken(nextToken),
      expiresAt,
      lastSeenAt: new Date(),
    },
  });

  setCookie(c, cookieName, nextToken, buildCookieOptions(cfg));

  return anonymousUser;
}

export async function migrateAnonymousDataToUser(c: Context, cfg: AppConfig, userId: string) {
  const anonymousUser = await resolveAnonymousUser(c, cfg);

  if (!anonymousUser) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { activeVoiceEnrollmentId: true },
    });
    const anonymousActiveVoiceId = anonymousUser.activeVoiceEnrollmentId;

    await tx.voiceEnrollment.updateMany({
      where: { anonymousUserId: anonymousUser.id },
      data: {
        userId,
        anonymousUserId: null,
      },
    });

    await tx.ttsJob.updateMany({
      where: { anonymousUserId: anonymousUser.id },
      data: {
        userId,
        anonymousUserId: null,
      },
    });

    if (!user?.activeVoiceEnrollmentId && anonymousActiveVoiceId) {
      const anonymousActiveVoice = await tx.voiceEnrollment.findFirst({
        where: {
          id: anonymousActiveVoiceId,
          userId,
          status: "READY",
          isInvalidated: false,
        },
      });

      if (anonymousActiveVoice?.voiceId) {
        await tx.user.update({
          where: { id: userId },
          data: { activeVoiceEnrollmentId: anonymousActiveVoice.id },
        });
      }
    }

    await tx.anonymousUser.deleteMany({ where: { id: anonymousUser.id } });
  });

  clearAnonymousCookie(c, cfg);
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

  const user = await prisma.user.findUnique({ where: { id: session.userId } });

  if (!user) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    clearSessionCookie(c, cfg);
    return null;
  }

  return { ...session, user };
}

export async function requireCurrentUser(c: Context, cfg: AppConfig): Promise<User | null> {
  const session = await resolveCurrentSession(c, cfg);
  return session?.user ?? null;
}

export function unauthorizedResponse(c: Context) {
  return errorResponse(c, "请先登录", 401);
}
