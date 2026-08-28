import { env } from "../config/env.js";
import { profilePath } from "./url.js";
import { randomBytes } from "crypto";

export interface HeaderContext {
  initialUrl: string;
  routeUrl: string;
  pageInstance?: string;
  pageInstanceTrackingId?: string;
}

function csrfFromCookie(cookie: string): string | undefined {
  const match = cookie.match(/(?:^|;\s*)JSESSIONID=([^;]+)/i);
  if (!match?.[1]) return undefined;
  return `ajax:${match[1].replace(/^"|"$/g, "")}`;
}

/** Generate a W3C traceparent header: 00-<32hex>-<16hex>-01 */
function generateTraceparent(): string {
  const traceId = randomBytes(16).toString("hex");
  const parentId = randomBytes(8).toString("hex");
  return `00-${traceId}-${parentId}-01`;
}

export function buildLinkedInHeaders(
  context: HeaderContext,
): Record<string, string> {
  const LINKEDIN_ORIGIN = "https://www.linkedin.com";

  // Parse the major Chrome version from the user-agent for Sec-Ch-Ua
  const chromeVerMatch = env.LINKEDIN_USER_AGENT.match(/Chrome\/(\d+)/);
  const chromeVer = chromeVerMatch?.[1] ?? "131";

  const headers: Record<string, string> = {
    accept: "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en,en-IN;q=0.9,hi;q=0.8",
    "content-type": "application/json",
    origin: LINKEDIN_ORIGIN,
    priority: "u=1, i",
    referer: `${LINKEDIN_ORIGIN}${context.initialUrl}`,
    "sec-ch-prefers-color-scheme": "light",
    "sec-ch-ua": `"Chromium";v="${chromeVer}", "Not A(Brand";v="24", "Google Chrome";v="${chromeVer}"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": env.LINKEDIN_USER_AGENT,
    "x-li-anchor-page-key": env.LINKEDIN_ANCHOR_PAGE_KEY,
    "x-li-application-version": env.LINKEDIN_APP_VERSION,
    "x-li-rsc-stream": "true",
    "x-li-sdui-version": env.LINKEDIN_SDUI_VERSION,
    "x-li-initial-url": context.initialUrl,
    "x-li-route-url": context.routeUrl,
    "x-li-traceparent":
      "00-00065a1e92fb4252000155082cbabc5b-4c6f5d2bf855e07b-00",
    "x-li-tracestate": "LinkedIn=4c6f5d2bf855e07b",
    "x-li-track": JSON.stringify({
      clientVersion: env.LINKEDIN_APP_VERSION,
      mpVersion: env.LINKEDIN_APP_VERSION,
      osName: "web",
      timezoneOffset: Number(env.LINKEDIN_TIMEZONE_OFFSET),
      timezone: env.LINKEDIN_TIMEZONE,
      deviceFormFactor: env.LINKEDIN_DEVICE_FORM_FACTOR,
      mpName: "web",
      displayDensity: Number(env.LINKEDIN_DISPLAY_DENSITY),
      displayWidth: Number(env.LINKEDIN_DISPLAY_WIDTH),
      displayHeight: Number(env.LINKEDIN_DISPLAY_HEIGHT),
    }),
  };

  const csrf = env.LINKEDIN_CSRF_TOKEN || csrfFromCookie(env.LINKEDIN_COOKIE);
  if (csrf) headers["csrf-token"] = csrf;
  if (env.LINKEDIN_COOKIE) headers.cookie = env.LINKEDIN_COOKIE;
  if (env.LINKEDIN_APPLICATION_INSTANCE)
    headers["x-li-application-instance"] = env.LINKEDIN_APPLICATION_INSTANCE;
  if (env.LINKEDIN_PAGE_FOREST_ID)
    headers["x-li-pageforestid"] = env.LINKEDIN_PAGE_FOREST_ID;

  const pageInstance = context.pageInstance || env.LINKEDIN_PAGE_INSTANCE;
  const trackingId =
    context.pageInstanceTrackingId || env.LINKEDIN_PAGE_INSTANCE_TRACKING_ID;
  if (pageInstance) headers["x-li-page-instance"] = pageInstance;
  if (trackingId) headers["x-li-page-instance-tracking-id"] = trackingId;

  return headers;
}

export function buildProfileContext(
  publicIdentifier: string,
  routeUrl?: string,
): HeaderContext {
  return {
    initialUrl: profilePath(publicIdentifier),
    routeUrl: routeUrl ?? profilePath(publicIdentifier),
  };
}
