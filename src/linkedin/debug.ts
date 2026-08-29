/**
 * debug.ts — Temporary debugging utilities for reproducing the LinkedIn
 * SDUI component request and capturing the raw RSC response to disk.
 *
 * Usage (from a one-off script or a test route):
 *   import { debugInitialProfileRequest } from './debug.js';
 *   await debugInitialProfileRequest('gauravdas17');
 *
 * Files saved on success:
 *   debug/linkedin-profile-response.bin   — raw bytes from LinkedIn
 *   debug/linkedin-profile-response.txt   — UTF-8 decoded text
 *
 * NEVER saves cookies, CSRF tokens, or any credentials.
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { env } from "../config/env.js";
import { LinkedInClient } from "./client.js";
import { buildLinkedInHeaders, buildProfileContext, getCsrfToken } from "./headers.js";
import { PROFILE_COMPONENTS } from "./components.js";

const LINKEDIN_BASE = "https://www.linkedin.com";
const DEBUG_DIR = join(process.cwd(), "debug");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertAuth(): void {
  if (!env.LINKEDIN_COOKIE) {
    throw new Error(
      "[debugInitialProfileRequest] LINKEDIN_COOKIE is not configured.\n" +
        "Add it to .env before running this debug function.",
    );
  }
  // Will throw with a clear message if JSESSIONID is missing
  getCsrfToken(env.LINKEDIN_COOKIE);
}

// ---------------------------------------------------------------------------
// Public debug function
// ---------------------------------------------------------------------------

export async function debugInitialProfileRequest(
  publicIdentifier: string,
): Promise<void> {
  console.log(
    `\n${"=".repeat(60)}\n[debugInitialProfileRequest] publicIdentifier: ${publicIdentifier}\n${"=".repeat(60)}`,
  );

  // 1. Pre-flight auth check
  assertAuth();

  // 2. Resolve vieweeProfileId + fresh page-session context
  const client = new LinkedInClient();
  const pageCtx = await client.resolveProfileId(publicIdentifier);
  const {
    profileId: vieweeProfileId,
    applicationInstance,
    pageForestId,
    pageInstanceTrackingId,
    appVersion,
  } = pageCtx;
  console.log(
    `[debug] vieweeProfileId: ${vieweeProfileId ?? "(not resolved — proceeding without it)"}`,
  );
  console.log('[debug] fresh page context:', {
    applicationInstance: applicationInstance ?? '(none)',
    pageForestId:        pageForestId        ?? '(none)',
    pageInstanceTrackingId: pageInstanceTrackingId ?? '(none)',
    appVersion:          appVersion          ?? '(none)',
  });

  // 3. Build request parameters
  const componentId = PROFILE_COMPONENTS.aboveActivity;
  const routeUrl = `/in/${encodeURIComponent(publicIdentifier)}/`;

  const query = new URLSearchParams({
    componentId,
    sduiid: componentId,
  });
  const url = `${LINKEDIN_BASE}/flagship-web/rsc-action/actions/component?${query.toString()}`;

  const body = {
    clientArguments: {
      payload: {
        isSelfView: false,
        vanityName: publicIdentifier,
        replaceableSectionArgs: {
          vanityName: publicIdentifier,
          hideCardsForGoldenGate: false,
          shouldSetupReplaceableComponent: true,
          ...(vieweeProfileId ? { vieweeProfileId } : {}),
          isSelfView: false,
          isSelfViewResolved: false,
        },
      },
      states: [],
      requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
      screenId: "com.linkedin.sdui.flagshipnav.profile.Profile",
      knownTemplateIds: [],
    },
  };

  const headers = buildLinkedInHeaders(
    buildProfileContext(publicIdentifier, routeUrl, {
      // Conditional spreads satisfy exactOptionalPropertyTypes: keys are
      // omitted entirely when undefined, never explicitly set to undefined.
      ...(applicationInstance    ? { applicationInstance }    : {}),
      ...(pageForestId           ? { pageForestId }           : {}),
      ...(pageInstanceTrackingId ? { pageInstanceTrackingId } : {}),
      ...(appVersion             ? { appVersion }             : {}),
    }),
  );

  // 4. Structured pre-flight log (no secret values)
  console.log("\n[debug] Request summary:");
  console.log("  method          :", "POST");
  console.log("  url             :", url);
  console.log("  routeUrl        :", routeUrl);
  console.log("  componentId     :", componentId);
  console.log("  publicIdentifier:", publicIdentifier);
  console.log("  profileId       :", vieweeProfileId ?? "(none)");
  console.log("  appVersion (live):", appVersion ?? env.LINKEDIN_APP_VERSION);
  console.log("  hasCookie       :", Boolean(headers["cookie"]));
  console.log("  hasCsrfToken    :", Boolean(headers["csrf-token"]));
  console.log("  hasAppInstance  :", Boolean(headers["x-li-application-instance"]));
  console.log("  hasPageInstance :", Boolean(headers["x-li-page-instance"]));
  console.log("  hasPageForestId :", Boolean(headers["x-li-pageforestid"]));
  console.log("  hasTrackingId   :", Boolean(headers["x-li-page-instance-tracking-id"]));
  console.log("  bodyKeys        :", Object.keys(body));
  console.log("  traceparent     :", headers["x-li-traceparent"]);
  console.log("");

  // 5. Send the request
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.REQUEST_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  // 6. Log response metadata
  const contentType = response.headers.get("content-type") ?? "(none)";
  const contentEncoding = response.headers.get("content-encoding") ?? "(none)";

  console.log("[debug] Response:");
  console.log("  status          :", response.status, response.statusText);
  console.log("  content-type    :", contentType);
  console.log("  content-encoding:", contentEncoding);

  if (!response.ok) {
    console.error(
      `\n[debug] ❌ Request failed — HTTP ${response.status}. Check headers and cookie freshness.`,
    );
    // Try to show a snippet of the error body for debugging
    try {
      const errText = await response.text();
      console.error("[debug] Error body snippet:", errText.slice(0, 500));
    } catch {
      // ignore
    }
    return;
  }

  // 7. Read raw bytes
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  console.log("  byte length     :", bytes.length);
  console.log("  text length     :", text.length);

  // 8. Save to debug/ directory (no credentials included)
  await mkdir(DEBUG_DIR, { recursive: true });
  const binPath = join(DEBUG_DIR, "linkedin-profile-response.bin");
  const txtPath = join(DEBUG_DIR, "linkedin-profile-response.txt");

  await writeFile(binPath, bytes);
  await writeFile(txtPath, text, "utf-8");

  console.log(`\n[debug] ✅ HTTP 200 — Raw response saved:`);
  console.log(`  binary → ${binPath}`);
  console.log(`  text   → ${txtPath}`);
  console.log(`\n[debug] First 400 chars of decoded text:`);
  console.log(text.slice(0, 400).replace(/\n+/g, " "));
  console.log(`\n${"=".repeat(60)}\n`);
}
