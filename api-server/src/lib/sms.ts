import { createHash, randomBytes, randomUUID } from "node:crypto";
import Dypnsapi, { CheckSmsVerifyCodeRequest, SendSmsVerifyCodeRequest } from "@alicloud/dypnsapi20170525";
import {
  SmsScene,
  SmsVerificationStatus,
  type SmsVerification,
} from "@prisma/client";
import * as OpenApi from "@alicloud/openapi-client";
import type { AppConfig } from "./config";
import { prisma } from "./prisma";

export type SmsSceneValue = "register" | "login" | "password_change";

export class SmsServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function maskPhoneNumber(phoneNumber: string) {
  if (phoneNumber.length < 7) {
    return phoneNumber;
  }

  return `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}`;
}

function getSceneEnum(scene: SmsSceneValue) {
  switch (scene) {
    case "register":
      return SmsScene.REGISTER;
    case "password_change":
      return SmsScene.PASSWORD_CHANGE;
    default:
      return SmsScene.LOGIN;
  }
}

function getSchemeName(cfg: AppConfig, scene: SmsSceneValue) {
  switch (scene) {
    case "register":
      return cfg.sms.registerSchemeName;
    case "password_change":
      return cfg.sms.passwordChangeSchemeName;
    default:
      return cfg.sms.loginSchemeName;
  }
}

function buildTemplateParam(cfg: AppConfig) {
  if (cfg.sms.templateParam.trim()) {
    return cfg.sms.templateParam;
  }

  return JSON.stringify({
    code: "##code##",
    min: String(Math.max(1, Math.ceil(cfg.sms.validTimeSeconds / 60))),
  });
}

function createSmsClient(cfg: AppConfig) {
  const openApiConfig = new OpenApi.Config({
    accessKeyId: cfg.sms.accessKeyId,
    accessKeySecret: cfg.sms.accessKeySecret,
    endpoint: cfg.sms.endpoint,
    protocol: "https",
  });

  return new Dypnsapi(openApiConfig);
}

function hashVerificationCode(phoneNumber: string, scene: SmsSceneValue, code: string) {
  return createHash("sha256").update(`${phoneNumber}:${scene}:${code}`).digest("hex");
}

function buildMockCharset(codeType: number) {
  switch (codeType) {
    case 2:
      return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    case 3:
      return "abcdefghijklmnopqrstuvwxyz";
    case 4:
      return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    case 5:
      return "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    case 6:
      return "0123456789abcdefghijklmnopqrstuvwxyz";
    case 7:
      return "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    default:
      return "0123456789";
  }
}

function generateMockCode(cfg: AppConfig) {
  const charset = buildMockCharset(cfg.sms.codeType);
  const bytes = randomBytes(cfg.sms.codeLength);

  return Array.from(bytes, (value) => charset[value % charset.length]).join("");
}

async function expirePreviousCodes(phoneNumber: string, scene: SmsSceneValue) {
  await prisma.smsVerification.updateMany({
    where: {
      phoneNumber,
      scene: getSceneEnum(scene),
      status: SmsVerificationStatus.SENT,
    },
    data: { status: SmsVerificationStatus.FAILED },
  });
}

function mapAliyunSendError(message: string) {
  if (message.includes("FREQUENCY_FAIL")) {
    return new SmsServiceError("验证码发送过于频繁，请稍后再试", 429);
  }

  if (message.includes("BUSINESS_LIMIT_CONTROL")) {
    return new SmsServiceError("当前手机号今日发送次数已达上限", 429);
  }

  if (message.includes("MOBILE_NUMBER_ILLEGAL")) {
    return new SmsServiceError("手机号格式不正确", 400);
  }

  return new SmsServiceError("短信发送失败，请稍后重试", 502);
}

async function createVerificationRecord(params: {
  phoneNumber: string;
  scene: SmsSceneValue;
  provider: string;
  providerBizId?: string;
  providerRequestId?: string;
  providerOutId: string;
  codeHash?: string;
  expiresAt: Date;
}) {
  await expirePreviousCodes(params.phoneNumber, params.scene);

  return prisma.smsVerification.create({
    data: {
      phoneNumber: params.phoneNumber,
      scene: getSceneEnum(params.scene),
      provider: params.provider,
      providerBizId: params.providerBizId,
      providerRequestId: params.providerRequestId,
      providerOutId: params.providerOutId,
      codeHash: params.codeHash,
      expiresAt: params.expiresAt,
    },
  });
}

export async function sendSmsVerification(cfg: AppConfig, phoneNumber: string, scene: SmsSceneValue) {
  console.info(`[sms] send.start scene=${scene} phone=${maskPhoneNumber(phoneNumber)} mockMode=${cfg.sms.mockMode}`);

  const latest = await prisma.smsVerification.findFirst({
    where: {
      phoneNumber,
      scene: getSceneEnum(scene),
    },
    orderBy: { createdAt: "desc" },
  });

  if (latest && Date.now() - latest.createdAt.getTime() < cfg.sms.intervalSeconds * 1000) {
    throw new SmsServiceError("验证码发送过于频繁，请稍后再试", 429);
  }

  const expiresAt = new Date(Date.now() + cfg.sms.validTimeSeconds * 1000);

  if (cfg.sms.mockMode) {
    const code = generateMockCode(cfg);
    const outId = randomUUID();

    await createVerificationRecord({
      phoneNumber,
      scene,
      provider: "mock",
      providerOutId: outId,
      codeHash: hashVerificationCode(phoneNumber, scene, code),
      expiresAt,
    });

    return {
      expiresAt,
      debugCode: code,
    };
  }

  if (!cfg.sms.accessKeyId || !cfg.sms.accessKeySecret || !cfg.sms.signName || !cfg.sms.templateCode) {
    console.error(
      `[sms] send.config_incomplete scene=${scene} phone=${maskPhoneNumber(phoneNumber)} ` +
      `accessKeyId=${Boolean(cfg.sms.accessKeyId)} accessKeySecret=${Boolean(cfg.sms.accessKeySecret)} ` +
      `signName=${Boolean(cfg.sms.signName)} templateCode=${Boolean(cfg.sms.templateCode)}`,
    );
    throw new SmsServiceError("短信服务配置不完整", 500);
  }

  const client = createSmsClient(cfg);
  const outId = randomUUID();

  try {
    const response = await client.sendSmsVerifyCode(
      new SendSmsVerifyCodeRequest({
        phoneNumber,
        countryCode: "86",
        schemeName: getSchemeName(cfg, scene),
        signName: cfg.sms.signName,
        templateCode: cfg.sms.templateCode,
        templateParam: buildTemplateParam(cfg),
        outId,
        codeLength: cfg.sms.codeLength,
        validTime: cfg.sms.validTimeSeconds,
        interval: cfg.sms.intervalSeconds,
        duplicatePolicy: 1,
        codeType: cfg.sms.codeType,
        autoRetry: 1,
        returnVerifyCode: cfg.sms.returnVerifyCode,
      }),
    );

    const body = response.body;

    console.info(
      `[sms] send.response scene=${scene} phone=${maskPhoneNumber(phoneNumber)} ` +
      `success=${body?.success} code=${body?.code ?? "UNKNOWN"} requestId=${body?.model?.requestId ?? ""}`,
    );

    if (!body?.success || body.code !== "OK") {
      console.error(
        `[sms] send.failed_response scene=${scene} phone=${maskPhoneNumber(phoneNumber)} ` +
        `code=${body?.code ?? "UNKNOWN"} message=${body?.message ?? "send failed"}`,
      );
      throw mapAliyunSendError(`${body?.code ?? "UNKNOWN"}:${body?.message ?? "send failed"}`);
    }

    await createVerificationRecord({
      phoneNumber,
      scene,
      provider: "aliyun",
      providerBizId: body.model?.bizId,
      providerRequestId: body.model?.requestId,
      providerOutId: body.model?.outId ?? outId,
      expiresAt,
    });
  } catch (error) {
    console.error(
      `[sms] send.exception scene=${scene} phone=${maskPhoneNumber(phoneNumber)} ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );

    if (error instanceof SmsServiceError) {
      throw error;
    }

    throw mapAliyunSendError(error instanceof Error ? error.message : "send failed");
  }

  return { expiresAt };
}

async function verifyWithMock(record: SmsVerification, phoneNumber: string, scene: SmsSceneValue, code: string) {
  return record.codeHash === hashVerificationCode(phoneNumber, scene, code);
}

async function verifyWithAliyun(cfg: AppConfig, phoneNumber: string, scene: SmsSceneValue, code: string) {
  const client = createSmsClient(cfg);
  const response = await client.checkSmsVerifyCode(
    new CheckSmsVerifyCodeRequest({
      phoneNumber,
      countryCode: "86",
      schemeName: getSchemeName(cfg, scene),
      verifyCode: code,
      caseAuthPolicy: 1,
    }),
  );

  const body = response.body;

  if (!body?.success || body.code !== "OK") {
    throw new SmsServiceError("验证码校验失败，请稍后重试", 502);
  }

  return body.model?.verifyResult === "PASS";
}

export async function verifySmsCode(cfg: AppConfig, phoneNumber: string, scene: SmsSceneValue, code: string) {
  const record = await prisma.smsVerification.findFirst({
    where: {
      phoneNumber,
      scene: getSceneEnum(scene),
      status: SmsVerificationStatus.SENT,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    throw new SmsServiceError("请先发送验证码", 400);
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.smsVerification.update({
      where: { id: record.id },
      data: {
        status: SmsVerificationStatus.FAILED,
        verifyAttempts: { increment: 1 },
      },
    });

    throw new SmsServiceError("验证码已过期，请重新发送", 400);
  }

  const passed = record.provider === "mock"
    ? await verifyWithMock(record, phoneNumber, scene, code)
    : await verifyWithAliyun(cfg, phoneNumber, scene, code);

  await prisma.smsVerification.update({
    where: { id: record.id },
    data: {
      verifyAttempts: { increment: 1 },
      ...(passed
        ? {
            status: SmsVerificationStatus.VERIFIED,
            verifiedAt: new Date(),
          }
        : {}),
    },
  });

  if (!passed) {
    throw new SmsServiceError("验证码错误", 400);
  }

  return record;
}
