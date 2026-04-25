import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import {
  createUserSession,
  destroyCurrentSession,
  migrateAnonymousDataToUser,
  requireCurrentUser,
  unauthorizedResponse,
} from "../lib/auth";
import { errorResponse } from "../lib/http";
import { hashPassword, verifyPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import { SmsServiceError, sendSmsVerification, verifySmsCode } from "../lib/sms";
import {
  passwordChangeSchema,
  passwordLoginSchema,
  passwordSetSchema,
  registerRequestSchema,
  smsLoginSchema,
  smsSendSchema,
} from "../lib/validation";

function buildAuthUser(user: {
  id: string;
  phoneNumber: string;
  passwordHash: string | null;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    hasPassword: Boolean(user.passwordHash),
    phoneVerifiedAt: user.phoneVerifiedAt,
    createdAt: user.createdAt,
  };
}

export function createAuthRoutes(cfg: AppConfig) {
  const auth = new Hono();

  auth.post("/sms/send", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedBody = smsSendSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    const { phoneNumber, scene } = parsedBody.data;

    if (scene === "password_change") {
      const currentUser = await requireCurrentUser(c, cfg);

      if (!currentUser) {
        return unauthorizedResponse(c);
      }

      if (currentUser.phoneNumber !== phoneNumber) {
        return errorResponse(c, "验证手机号与当前登录账号不一致", 400);
      }
    }

    const user = await prisma.user.findUnique({ where: { phoneNumber } });

    if (scene === "register" && user) {
      return errorResponse(c, "该手机号已注册，请直接登录", 409);
    }

    try {
      const result = await sendSmsVerification(cfg, phoneNumber, scene);

      return c.json({
        sent: true,
        retryAfterSeconds: cfg.sms.intervalSeconds,
        expiresInSeconds: cfg.sms.validTimeSeconds,
        ...(result.debugCode ? { debugCode: result.debugCode } : {}),
      });
    } catch (error) {
      if (error instanceof SmsServiceError) {
        return errorResponse(c, error.message, error.status);
      }

      return errorResponse(c, "短信发送失败，请稍后重试", 502);
    }
  });

  auth.post("/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedBody = registerRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    const { phoneNumber, code, password } = parsedBody.data;

    try {
      await verifySmsCode(cfg, phoneNumber, "register", code);
    } catch (error) {
      if (error instanceof SmsServiceError) {
        return errorResponse(c, error.message, error.status);
      }

      return errorResponse(c, "验证码校验失败，请稍后重试", 502);
    }

    try {
      const user = await prisma.user.create({
        data: {
          phoneNumber,
          passwordHash: password ? await hashPassword(password) : null,
          phoneVerifiedAt: new Date(),
        },
      });

      await migrateAnonymousDataToUser(c, cfg, user.id);
      await createUserSession(c, cfg, user.id);

      return c.json({ user: buildAuthUser(user) }, 201);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return errorResponse(c, "该手机号已注册，请直接登录", 409);
      }

      return errorResponse(c, "注册失败，请稍后重试", 500);
    }
  });

  auth.post("/login/password", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedBody = passwordLoginSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    const user = await prisma.user.findUnique({ where: { phoneNumber: parsedBody.data.phoneNumber } });

    if (!user) {
      return errorResponse(c, "手机号或密码错误", 401);
    }

    if (!user.passwordHash) {
      return errorResponse(c, "该账号尚未设置密码，请使用短信登录", 400);
    }

    const passwordMatched = await verifyPassword(parsedBody.data.password, user.passwordHash);

    if (!passwordMatched) {
      return errorResponse(c, "手机号或密码错误", 401);
    }

    await migrateAnonymousDataToUser(c, cfg, user.id);
    await createUserSession(c, cfg, user.id);

    return c.json({ user: buildAuthUser(user) });
  });

  auth.post("/login/sms", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedBody = smsLoginSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    try {
      await verifySmsCode(cfg, parsedBody.data.phoneNumber, "login", parsedBody.data.code);
    } catch (error) {
      if (error instanceof SmsServiceError) {
        return errorResponse(c, error.message, error.status);
      }

      return errorResponse(c, "验证码校验失败，请稍后重试", 502);
    }

    const user = await prisma.user.upsert({
      where: { phoneNumber: parsedBody.data.phoneNumber },
      update: {
        phoneVerifiedAt: new Date(),
      },
      create: {
        phoneNumber: parsedBody.data.phoneNumber,
        phoneVerifiedAt: new Date(),
      },
    });

    await migrateAnonymousDataToUser(c, cfg, user.id);
    await createUserSession(c, cfg, user.id);

    return c.json({ user: buildAuthUser(user) });
  });

  auth.get("/me", async (c) => {
    const user = await requireCurrentUser(c, cfg);

    if (!user) {
      return unauthorizedResponse(c);
    }

    return c.json({ user: buildAuthUser(user) });
  });

  auth.post("/password/set", async (c) => {
    const user = await requireCurrentUser(c, cfg);

    if (!user) {
      return unauthorizedResponse(c);
    }

    if (user.passwordHash) {
      return errorResponse(c, "密码已设置，如需修改请使用修改密码功能", 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsedBody = passwordSetSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsedBody.data.newPassword) },
    });

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    return c.json({ user: buildAuthUser(updatedUser) });
  });

  auth.post("/password/change", async (c) => {
    const user = await requireCurrentUser(c, cfg);

    if (!user) {
      return unauthorizedResponse(c);
    }

    const body = await c.req.json().catch(() => null);
    const parsedBody = passwordChangeSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    try {
      await verifySmsCode(cfg, user.phoneNumber, "password_change", parsedBody.data.code);
    } catch (error) {
      if (error instanceof SmsServiceError) {
        return errorResponse(c, error.message, error.status);
      }

      return errorResponse(c, "验证码校验失败，请稍后重试", 502);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsedBody.data.newPassword) },
    });

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    return c.json({ user: buildAuthUser(updatedUser) });
  });

  auth.post("/logout", async (c) => {
    await destroyCurrentSession(c, cfg);
    return c.json({ success: true });
  });

  return auth;
}
