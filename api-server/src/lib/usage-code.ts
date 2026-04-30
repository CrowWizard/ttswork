import { randomInt } from "node:crypto";

const USAGE_CODE_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const USAGE_CODE_LENGTH = 6;
const USAGE_CODE_PATTERN = /^[0-9A-Za-z]{6}$/;

export function generateUsageCode() {
  let code = "";

  for (let index = 0; index < USAGE_CODE_LENGTH; index += 1) {
    code += USAGE_CODE_CHARSET[randomInt(USAGE_CODE_CHARSET.length)];
  }

  return code;
}

export function normalizeUsageCodeInput(code: string) {
  return code.trim();
}

export function isUsageCodeFormatValid(code: string) {
  return USAGE_CODE_PATTERN.test(normalizeUsageCodeInput(code));
}
