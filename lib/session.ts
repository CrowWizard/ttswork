import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/constants";

export async function ensureAnonymousUserCookie() {
  const cookieStore = await cookies();
  let userId = cookieStore.get(COOKIE_NAME)?.value;

  if (!userId) {
    userId = randomUUID();
    cookieStore.set(COOKIE_NAME, userId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return userId;
}
