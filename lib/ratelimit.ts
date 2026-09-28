import { connectToDatabase } from "@/lib/db/connect";
import { RateLimitModel } from "@/lib/db/ops";

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export type RateVerdict = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  scope: "memory" | "mongo";
};

function currentWindow(windowSeconds: number): Date {
  const now = Date.now();
  return new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
}

export function consumeMemory(
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): RateVerdict {
  const capacity = limit;
  const refillPerMs = capacity / (windowSeconds * 1000);
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
      scope: "memory",
    };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return {
    allowed: true,
    remaining: Math.floor(tokens - 1),
    retryAfterSeconds: 0,
    scope: "memory",
  };
}

export function resetMemoryBuckets(): void {
  buckets.clear();
}

export function bucketSnapshot(): { key: string; tokens: number }[] {
  return [...buckets.entries()].map(([key, bucket]) => ({
    key,
    tokens: Math.floor(bucket.tokens),
  }));
}

export async function consumeDurable(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateVerdict> {
  await connectToDatabase();
  const windowStart = currentWindow(windowSeconds);
  const result = await RateLimitModel.findOneAndUpdate(
    { key, windowStart },
    { $inc: { count: 1 }, $setOnInsert: { key, windowStart } },
    { upsert: true, new: true },
  ).lean();
  const count = result?.count ?? 1;
  if (count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000),
      ),
      scope: "mongo",
    };
  }
  return {
    allowed: true,
    remaining: limit - count,
    retryAfterSeconds: 0,
    scope: "mongo",
  };
}

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: { durable: boolean },
): Promise<RateVerdict> {
  const memory = consumeMemory(key, limit, windowSeconds);
  if (!memory.allowed) {
    return memory;
  }
  if (!options.durable) {
    return memory;
  }
  try {
    return await consumeDurable(key, limit, windowSeconds);
  } catch {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
      scope: "mongo",
    };
  }
}
