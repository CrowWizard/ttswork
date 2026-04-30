import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppConfig } from "./config";
import { errorResponse } from "./http";

function decodeBasicAuthorization(headerValue: string) {
  if (!headerValue.startsWith("Basic ")) {
    return null;
  }

  const encoded = headerValue.slice("Basic ".length).trim();

  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function setChallengeHeader(c: Parameters<MiddlewareHandler>[0]) {
  c.header("WWW-Authenticate", 'Basic realm="admin", charset="UTF-8"');
}

export function requireAdminBasicAuth(cfg: AppConfig): MiddlewareHandler {
  return async (c, next) => {
    if (!cfg.admin.username || !cfg.admin.password) {
      return errorResponse(c, "后台管理员凭证未配置", 503);
    }

    const authorization = c.req.header("authorization");
    const credentials = authorization ? decodeBasicAuthorization(authorization) : null;

    if (!credentials) {
      setChallengeHeader(c);
      return errorResponse(c, "后台接口需要管理员认证", 401);
    }

    if (!safeEqual(credentials.username, cfg.admin.username) || !safeEqual(credentials.password, cfg.admin.password)) {
      setChallengeHeader(c);
      return errorResponse(c, "管理员账号或密码错误", 401);
    }

    await next();
  };
}
