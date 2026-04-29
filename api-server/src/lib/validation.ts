import { z } from "zod";

export const phoneNumberSchema = z.string().trim().regex(/^1\d{10}$/, "请输入 11 位中国大陆手机号");

export const smsCodeSchema = z.string().trim().min(4, "验证码至少 4 位").max(8, "验证码最多 8 位");

export const passwordSchema = z.string().min(8, "密码至少 8 位").max(72, "密码长度不能超过 72 位");

export const smsSceneSchema = z.enum(["register", "login", "password_change"]);

export const smsSendSchema = z.object({
  phoneNumber: phoneNumberSchema,
  scene: smsSceneSchema,
});

export const registerRequestSchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: smsCodeSchema,
  password: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    passwordSchema.optional(),
  ),
});

export const passwordLoginSchema = z.object({
  phoneNumber: phoneNumberSchema,
  password: passwordSchema,
});

export const smsLoginSchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: smsCodeSchema,
});

export const passwordSetSchema = z.object({
  newPassword: passwordSchema,
});

export const passwordChangeSchema = z.object({
  code: smsCodeSchema,
  newPassword: passwordSchema,
});

export const usageCodeSchema = z.string().trim().regex(/^[0-9A-Za-z]{6}$/, "请输入 6 位使用码");

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1, "文本不能为空").max(500, "文本长度不能超过 500 字"),
  profileKind: z.enum(["PURE", "SCENE"]).default("PURE"),
  sceneKey: z.string().trim().min(1).max(50).optional(),
  instruction: z.string().trim().max(100, "场景提示词不能超过 100 个字符").optional(),
  usageCode: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    usageCodeSchema.optional(),
  ),
});

export const voiceEnrollmentCreateSchema = z.object({
  recordingId: z.string().trim().min(1, "请选择已上传录音"),
  profileKind: z.enum(["PURE", "SCENE"]),
});
