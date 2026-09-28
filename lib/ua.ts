import { UAParser } from "ua-parser-js";

export type ParsedUserAgent = {
  browser: string;
  os: string;
  device: string;
};

export function parseUserAgent(userAgent: string): ParsedUserAgent {
  if (userAgent.trim() === "") {
    return { browser: "", os: "", device: "" };
  }
  const parsed = new UAParser(userAgent).getResult();
  return {
    browser: parsed.browser.name ?? "",
    os: parsed.os.name ?? "",
    device: parsed.device.type ?? "",
  };
}
