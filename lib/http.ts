import { NextResponse } from "next/server";

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
