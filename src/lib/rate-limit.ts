import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "1 m"), prefix: "rl:quoth" });

export function getIP(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "anonymous";
}

export async function checkRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.match(/\.(ico|svg|png|jpg|css|js|woff2?)$/)) return null;
  const ip = getIP(request);
  const { success, reset } = await limiter.limit(ip);
  if (!success) {
    const r = Math.ceil((reset - Date.now()) / 1000);
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(r) } })
      : new NextResponse("Too many requests.", { status: 429, headers: { "Retry-After": String(r) } });
  }
  return null;
}
