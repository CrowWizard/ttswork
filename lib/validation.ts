import { z } from "zod";

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1, "文本不能为空").max(500, "文本长度不能超过 500"),
});
