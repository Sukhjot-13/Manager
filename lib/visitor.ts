import crypto from "node:crypto";

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dailyWindowStart(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function visitorId(
  ip: string,
  userAgent: string,
  pepper: string,
  now = new Date(),
): string {
  return crypto
    .createHmac("sha256", pepper)
    .update(`${utcDateKey(now)}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|bingpreview|headless|phantomjs|puppeteer|playwright|lighthouse|curl\/|wget\/|python-requests|axios\/|okhttp|go-http-client|monitor|uptime|pingdom/i;

export function isBot(userAgent: string): boolean {
  if (userAgent.trim() === "") {
    return true;
  }
  return BOT_PATTERN.test(userAgent);
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim() !== "") {
    return forwarded.split(",")[0].trim();
  }
  return headers.get("x-real-ip")?.trim() ?? "";
}

export function countryFromHeaders(headers: Headers): string {
  const candidates = [
    headers.get("x-vercel-ip-country"),
    headers.get("cf-ipcountry"),
    headers.get("x-country-code"),
  ];
  for (const candidate of candidates) {
    if (candidate !== null && /^[A-Za-z]{2}$/.test(candidate.trim())) {
      return candidate.trim().toUpperCase();
    }
  }
  return "";
}
