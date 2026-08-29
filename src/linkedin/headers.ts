import { env } from "../config/env.js";
import { profilePath } from "./url.js";
import { randomBytes } from "crypto";

export interface HeaderContext {
  initialUrl: string;
  routeUrl: string;
  pageInstance?: string;
  pageInstanceTrackingId?: string;
  freshApplicationInstance?: string; // x-li-application-instance from GET response
  freshPageForestId?: string; // x-li-initialpageforestid from GET response
  freshAppVersion?: string; // x-li-application-version from GET response
}

// Auth helpers

/**
 * Derive the CSRF token from the JSESSIONID cookie value.
 *
 * LinkedIn sets JSESSIONID as: JSESSIONID="ajax:1234567890"
 * The CSRF token is the raw cookie value (already includes "ajax:" prefix).
 *
 * Throws if JSESSIONID is absent so callers fail fast instead of sending
 * a guaranteed-invalid request.
 */
export function getCsrfToken(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)JSESSIONID="?([^";]+)"?/i);
  if (!match?.[1]) {
    throw new Error("JSESSIONID not found in LINKEDIN_COOKIE");
  }
  return match[1]; // e.g. "ajax:1234567890"  — already has the prefix
}

// Telemetry helpers

/**
 * Generate a W3C-style traceparent header.
 *
 * **Critical HAR finding**: LinkedIn's browser ALWAYS sets the traceId portion
 * of traceparent equal to the `x-li-pageforestid` value. This is the
 * page-session trace root. Individual requests vary only the parentId (span).
 *
 * Format: 00-<32hex traceId>-<16hex parentId>-00
 *
 * @param traceId - If provided (from LINKEDIN_PAGE_FOREST_ID), use it as the
 *                  traceId. Otherwise generate a random one.
 */
function generateTraceparent(traceId?: string): string {
  const tid = traceId ?? randomBytes(16).toString("hex");
  const parentId = randomBytes(8).toString("hex");
  return `00-${tid}-${parentId}-00`;
}

/** Extract the parent-span-id segment from a traceparent string. */
function traceStateFromTraceparent(traceparent: string): string {
  // Format: 00-<traceId>-<parentId>-<flags>
  const parts = traceparent.split("-");
  const parentId = parts[2] ?? randomBytes(8).toString("hex");
  return `LinkedIn=${parentId}`;
}

// Header builder

export function buildLinkedInHeaders(
  context: HeaderContext,
): Record<string, string> {
  const LINKEDIN_ORIGIN = "https://www.linkedin.com";

  // Parse the major Chrome version from the user-agent for Sec-Ch-Ua
  const chromeVerMatch = env.LINKEDIN_USER_AGENT.match(/Chrome\/(\d+)/);
  const chromeVer = chromeVerMatch?.[1] ?? "131";

  const headers: Record<string, string> = {};

  // Static / Application
  const appVersion = context.freshAppVersion ?? env.LINKEDIN_APP_VERSION;
  headers["user-agent"] = env.LINKEDIN_USER_AGENT;
  headers["x-li-application-version"] = appVersion;
  headers["x-li-rsc-stream"] = "true";
  headers["x-li-anchor-page-key"] = env.LINKEDIN_ANCHOR_PAGE_KEY;

  // Standard fetch headers
  headers["accept"] = "*/*";
  headers["accept-encoding"] = "gzip, deflate, br, zstd";
  headers["accept-language"] = "en,en-IN;q=0.9,hi;q=0.8";
  headers["content-type"] = "application/json";
  headers["priority"] = "u=1, i";
  headers["sec-ch-prefers-color-scheme"] = "dark";
  headers["sec-ch-ua"] =
    `"Not=A?Brand";v="99", "Google Chrome";v="${chromeVer}", "Chromium";v="${chromeVer}"`;
  headers["sec-ch-ua-mobile"] = "?0";
  headers["sec-ch-ua-platform"] = '"Windows"';
  headers["sec-fetch-dest"] = "empty";
  headers["sec-fetch-mode"] = "cors";
  headers["sec-fetch-site"] = "same-origin";

  // Session
  if (env.LINKEDIN_COOKIE) {
    headers["cookie"] = env.LINKEDIN_COOKIE;
  }
  const csrf =
    env.LINKEDIN_CSRF_TOKEN ||
    (env.LINKEDIN_COOKIE
      ? (() => {
          try {
            return getCsrfToken(env.LINKEDIN_COOKIE);
          } catch {
            return undefined;
          }
        })()
      : undefined);
  if (csrf) headers["csrf-token"] = csrf;

  // Page Context
  const appInstance =
    context.freshApplicationInstance ?? env.LINKEDIN_APPLICATION_INSTANCE;
  const pageForestId = context.freshPageForestId ?? env.LINKEDIN_PAGE_FOREST_ID;

  if (appInstance) headers["x-li-application-instance"] = appInstance;
  if (pageForestId) headers["x-li-pageforestid"] = pageForestId;

  const trackingId =
    context.pageInstanceTrackingId ?? env.LINKEDIN_PAGE_INSTANCE_TRACKING_ID;
  const pageInstance =
    context.pageInstance ??
    env.LINKEDIN_PAGE_INSTANCE ??
    (trackingId
      ? `urn:li:page:${env.LINKEDIN_ANCHOR_PAGE_KEY};${trackingId}`
      : undefined);
  if (pageInstance) headers["x-li-page-instance"] = pageInstance;
  if (trackingId) headers["x-li-page-instance-tracking-id"] = trackingId;

  // Request Context
  headers["origin"] = LINKEDIN_ORIGIN;
  headers["referer"] = `${LINKEDIN_ORIGIN}${context.initialUrl}`;

  // Telemetry
  const traceparent = generateTraceparent(pageForestId || undefined);
  headers["x-li-traceparent"] = traceparent;
  headers["x-li-tracestate"] = traceStateFromTraceparent(traceparent);
  headers["x-li-track"] = JSON.stringify({
    clientVersion: appVersion,
    mpVersion: appVersion,
    osName: "web",
    timezoneOffset: Number(env.LINKEDIN_TIMEZONE_OFFSET),
    timezone: env.LINKEDIN_TIMEZONE,
    deviceFormFactor: env.LINKEDIN_DEVICE_FORM_FACTOR,
    mpName: "web",
    displayDensity: Number(env.LINKEDIN_DISPLAY_DENSITY),
    displayWidth: Number(env.LINKEDIN_DISPLAY_WIDTH),
    displayHeight: Number(env.LINKEDIN_DISPLAY_HEIGHT),
  });

  return headers;
}

export function buildProfileContext(
  publicIdentifier: string,
  routeUrl?: string,
  freshCtx?: {
    applicationInstance?: string;
    pageForestId?: string;
    pageInstanceTrackingId?: string;
    appVersion?: string;
  },
): HeaderContext {
  return {
    initialUrl: profilePath(publicIdentifier),
    routeUrl: routeUrl ?? profilePath(publicIdentifier),
    ...(freshCtx?.applicationInstance
      ? { freshApplicationInstance: freshCtx.applicationInstance }
      : {}),
    ...(freshCtx?.pageForestId
      ? { freshPageForestId: freshCtx.pageForestId }
      : {}),
    ...(freshCtx?.pageInstanceTrackingId
      ? { pageInstanceTrackingId: freshCtx.pageInstanceTrackingId }
      : {}),
    ...(freshCtx?.appVersion ? { freshAppVersion: freshCtx.appVersion } : {}),
  };
}
