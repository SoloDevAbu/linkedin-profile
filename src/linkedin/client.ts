import { env } from "../config/env.js";
import {
  buildLinkedInHeaders,
  buildProfileContext,
  getCsrfToken,
} from "./headers.js";
import {
  DETAIL_DEFINITIONS,
  PROFILE_COMPONENTS,
  type DetailSection,
} from "./components.js";
import { decodeRscResponse, type RscResponse } from "./parsers/rsc.js";
import { profilePath } from "./url.js";
import { randomBytes } from "crypto";

const LINKEDIN_BASE = "https://www.linkedin.com";

/** Generate a base64-encoded 8-byte span ID (matches LinkedIn's parentSpanId format) */
function generateParentSpanId(): string {
  return randomBytes(8).toString("base64");
}

/**
 * Build the profileComponentState object the SDUI server requires.
 * All keys follow the pattern: ProfileComponentState{FieldName}{vanityName}ProfileComponentState
 * under the MemoryNamespace.
 */
function buildProfileComponentState(
  vanityName: string,
): Record<string, unknown> {
  const binding = (key: string) => ({
    type: "com.linkedin.sdui.components.core.BindingImpl",
    value: {
      key: `${key}${vanityName}ProfileComponentState`,
      namespace: "MemoryNamespace",
    },
  });
  return {
    profileId: vanityName,
    shouldRefreshScreenOnReappear: binding(
      "ProfileComponentStateShouldRefreshScreen",
    ),
    shouldFetchFromCache: binding("ProfileComponentStateFetchFromCache"),
    loadedSections: binding("ProfileComponentStateLoadedProfileSections"),
    shouldDisplayTabAnchors: binding(
      "ProfileComponentStateShouldDisplayTabAnchors",
    ),
    shouldReloadTopCardOnReappear: binding(
      "ProfileComponentStateShouldReloadTopCardOnReappear",
    ),
    deferredTopCardReloadProfileId: binding(
      "ProfileComponentStateDeferredTopCardReloadProfileId",
    ),
    shouldDisplayStickyHeader: binding(
      "ProfileComponentStateShouldDisplayStickyHeader",
    ),
    shouldRefreshLanguageDetailScreen: binding(
      "ProfileComponentStateShouldRefreshLanguageDetails",
    ),
    lastPerformedActionRef: binding(
      "ProfileComponentStateLastPerformedActionRef",
    ),
    shouldFocusOnReappear: binding(
      "ProfileComponentStateShouldFocusOnReappear",
    ),
    shouldFocusFeaturedOnReappear: binding(
      "ProfileComponentStateShouldFocusFeaturedOnReappear",
    ),
    lastFeaturedActionRef: binding(
      "ProfileComponentStateLastFeaturedActionRef",
    ),
    shouldHideProfileCards: binding("ProfileComponentStateProfileHideCards"),
  };
}

/** Truncate a sensitive string so we can verify it's set without leaking it. */
function redact(value: string | undefined, prefixLen = 20): string {
  if (!value) return "[NOT SET]";
  if (value.length <= prefixLen) return `${value}…[SHORT/REDACTED]`;
  return `${value.slice(0, prefixLen)}…[REDACTED]`;
}

/** Build a safe loggable copy of the headers – redacting only credentials. */
function safeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => {
      const key = k.toLowerCase();
      if (key === "cookie") return [k, redact(v, 30)];
      if (key === "csrf-token") return [k, redact(v, 12)];
      return [k, v];
    }),
  );
}

/**
 * Extract profile fields from the LinkedIn SSR HTML page.
 *
 * Extraction strategy (most → least reliable):
 * 1. JSON-LD `@type:Person` — structured, stable schema.org data
 * 2. Open Graph meta tags (`og:title`, `og:description`, `og:image`)
 * 3. HTML `<title>` tag
 * 4. `<link rel="preload">` imageSrcSet for the profile photo
 * 5. `<meta name="description">` for headline/location
 */
function extractHtmlProfileData(html: string): HtmlProfileData {
  let fullName: string | null = null;
  let headline: string | null = null;
  let location: string | null = null;
  let about: string | null = null;
  let imageUrl: string | null = null;

  // 1. JSON-LD Person schema
  // LinkedIn embeds <script type="application/ld+json">{...}</script> blocks
  // with schema.org/Person data including name, jobTitle, address, description.
  const jsonLdMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of jsonLdMatches) {
    try {
      const parsed = JSON.parse(block[1]!) as Record<string, unknown>;
      const entries: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed["@graph"] instanceof Array
          ? (parsed["@graph"] as unknown[])
          : [parsed];
      for (const entry of entries) {
        const obj = entry as Record<string, unknown>;
        if (
          obj["@type"] === "Person" ||
          (Array.isArray(obj["@type"]) &&
            (obj["@type"] as string[]).includes("Person"))
        ) {
          if (typeof obj["name"] === "string" && !fullName)
            fullName = obj["name"];
          if (typeof obj["jobTitle"] === "string" && !headline)
            headline = obj["jobTitle"];
          if (typeof obj["description"] === "string" && !about)
            about = obj["description"];
          if (obj["address"] && typeof obj["address"] === "object") {
            const addr = obj["address"] as Record<string, unknown>;
            const parts = [
              addr["addressLocality"],
              addr["addressRegion"],
              addr["addressCountry"],
            ].filter((p): p is string => typeof p === "string");
            if (parts.length > 0 && !location) location = parts.join(", ");
          }
          if (obj["image"] && typeof obj["image"] === "object") {
            const img = obj["image"] as Record<string, unknown>;
            if (typeof img["url"] === "string" && !imageUrl)
              imageUrl = img["url"];
            else if (typeof img["contentUrl"] === "string" && !imageUrl)
              imageUrl = img["contentUrl"];
          } else if (typeof obj["image"] === "string" && !imageUrl) {
            imageUrl = obj["image"];
          }
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }

  // 2. Open Graph meta tag
  // og:title is "<Name> | LinkedIn"; strip the suffix
  if (!fullName) {
    const ogTitle =
      html.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      );
    if (ogTitle?.[1]) {
      fullName = ogTitle[1].replace(/\s*[|].*$/, "").trim() || null;
    }
  }

  if (!headline) {
    // og:description is typically "<Name> · <Headline> · <Location>: <about snippet>"
    const ogDesc =
      html.match(
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
      );
    if (ogDesc?.[1]) {
      // Format: "Name · Headline · Location: About..."
      // Split on interpunct (·) or bullet (•) to isolate fields
      const decoded = ogDesc[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"');
      const parts = decoded.split(/\s*[·•]\s*/);
      if (parts.length >= 2 && !headline) headline = parts[1]?.trim() || null;
      if (parts.length >= 3 && !location) {
        // "Location: about snippet..." — take the location part before the colon
        const locPart = parts[2]?.trim() ?? "";
        const colonIdx = locPart.indexOf(":");
        location =
          (colonIdx > 0 ? locPart.slice(0, colonIdx).trim() : locPart) || null;
      }
    }
  }

  // og:image for profile photo — prefer displayphoto over background image
  if (!imageUrl) {
    // Try og:image first (always a profile photo)
    const ogImg =
      html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      );
    if (ogImg?.[1]) imageUrl = ogImg[1].replace(/&amp;/g, "&");
  }

  // 3. HTML <title> tag
  if (!fullName) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const raw = titleMatch[1].trim();
      fullName = raw.replace(/\s*[-|].*$/, "").trim() || null;
    }
  }

  // 4. <link rel="preload" imageSrcSet> for the profile photo
  // LinkedIn preloads the profile image with an imageSrcSet attribute.
  // IMPORTANT: match ONLY profile-displayphoto URLs — the background banner
  // image (profile-displaybackgroundimage) may appear first and must be skipped.
  if (!imageUrl) {
    // Scan all preload links and pick the first one containing 'profile-displayphoto'
    const preloadRe =
      /<link[^>]+rel=["']preload["'][^>]+as=["']image["'][^>]+imageSrcSet=["']([^"']+)["']/gi;
    for (const m of html.matchAll(preloadRe)) {
      if (m[1]?.includes("profile-displayphoto")) {
        const firstSrc = m[1].split(",")[0]?.trim().split(/\s+/)[0];
        if (firstSrc) {
          imageUrl = firstSrc.replace(/&amp;/g, "&");
          break;
        }
      }
    }
  }

  // 5. <meta name="description">
  if (!headline) {
    const metaDesc =
      html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
      );
    if (metaDesc?.[1]) {
      const decoded = metaDesc[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"');
      const parts = decoded.split(/\s*[·•]\s*/);
      if (parts.length >= 2 && !headline) headline = parts[1]?.trim() || null;
    }
  }

  console.log("[extractHtmlProfileData] extracted:", {
    fullName,
    headline,
    location,
    imageUrl: imageUrl?.slice(0, 60),
  });
  return { fullName, headline, location, about, imageUrl };
}

export class LinkedInHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "LinkedInHttpError";
  }
}

export interface ComponentOptions {
  publicIdentifier: string;
  componentId: string;
  sduiid?: string;
  profileId?: string;
  /**
   * Controls which request body shape to send.
   *
   * - `'full'` (default): Complex payload with replaceableSectionArgs + profileComponentState.
   *   Used by profileCardsAboveActivity, below1–7, experienceOnly.
   * - `'simple'`: Lightweight payload `{isSelfView, vanityName}` with screenId=home.Home.
   *   Required by profileCardsActivity (HAR entry 1).
   */
  payloadStyle?: "full" | "simple";
  /** Fresh page-session context from the profile page GET response. */
  pageContext?: {
    applicationInstance?: string;
    pageForestId?: string;
    pageInstanceTrackingId?: string;
    appVersion?: string;
  };
}

export interface PaginationOptions {
  section: DetailSection;
  publicIdentifier: string;
  profileId: string;
  start?: number;
  count?: number;
  pageContext?: PageContext;
}

/**
 * Profile data extracted directly from the LinkedIn SSR HTML page.
 * This is the most reliable source for name/headline/location/image
 * because they are always present in the SSR meta tags.
 */
export interface HtmlProfileData {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  imageUrl: string | null;
}

/**
 * Page-session context extracted from the LinkedIn profile page GET response.
 * LinkedIn sends these as response headers on every SSR page load — they are
 * the authoritative, fresh values for the current session and should be used
 * verbatim in subsequent SDUI POST requests.
 */
export interface PageContext {
  profileId?: string;
  applicationInstance?: string; // x-li-application-instance
  pageForestId?: string; // x-li-initialpageforestid
  pageInstanceTrackingId?: string; // x-li-page-instance-tracking-id
  leafScreenId?: string; // x-li-leaf-screen-id
  appVersion?: string; // x-li-application-version
  /** Profile fields mined from the SSR HTML response body. */
  htmlData?: HtmlProfileData;
}

export class LinkedInClient {
  constructor(private readonly timeoutMs = env.REQUEST_TIMEOUT_MS) {}

  /**
   * Validate that auth credentials are present before making an SDUI request.
   * Throws with a clear message so the problem is diagnosed immediately
   * instead of sending a guaranteed-invalid request to LinkedIn.
   */
  private validateAuth(): void {
    if (!env.LINKEDIN_COOKIE) {
      throw new Error(
        "LINKEDIN_COOKIE is not configured. " +
          "Add your authenticated LinkedIn browser cookie to .env",
      );
    }
    // Will throw with 'JSESSIONID not found in LINKEDIN_COOKIE' if absent
    getCsrfToken(env.LINKEDIN_COOKIE);
  }

  private async request(
    url: string,
    init: RequestInit,
    routeUrl: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      // DEBUG: log response status
      console.log(
        `[LinkedIn Response] ${response.status} ${response.statusText} <- ${url}`,
      );

      if (!response.ok) {
        // Log response headers & body for diagnosis
        console.log("[LinkedIn Error] response headers:");
        response.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));
        const errText = await response
          .text()
          .catch(() => "(could not read body)");
        console.log(
          "[LinkedIn Error] body (first 500 chars):",
          errText.slice(0, 500),
        );
        throw new LinkedInHttpError(
          `LinkedIn returned HTTP ${response.status}`,
          response.status,
          url,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof LinkedInHttpError) throw error;
      const message =
        error instanceof Error
          ? error.message
          : "Unknown LinkedIn request error";
      throw new Error(`LinkedIn request failed for ${routeUrl}: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Resolve the LinkedIn member URN (vieweeProfileId) for a given vanity name.
   *
   * Also extracts the fresh page-session context headers that LinkedIn returns
   * on every SSR page load. These MUST be used in subsequent SDUI requests —
   * stale values from .env cause 500 errors.
   */
  async resolveProfileId(vanityName: string): Promise<PageContext> {
    const profileUrl = `${LINKEDIN_BASE}/in/${encodeURIComponent(vanityName)}/`;
    console.log(`[resolveProfileId] GET ${profileUrl}`);

    const headers: Record<string, string> = {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en,en-IN;q=0.9,hi;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "user-agent": env.LINKEDIN_USER_AGENT,
    };
    if (env.LINKEDIN_COOKIE) headers.cookie = env.LINKEDIN_COOKIE;
    if (env.LINKEDIN_CSRF_TOKEN)
      headers["csrf-token"] = env.LINKEDIN_CSRF_TOKEN;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(profileUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const ct = res.headers.get("content-type") ?? "(none)";
      console.log(
        `[resolveProfileId] status=${res.status}  content-type=${ct}`,
      );

      // Extract fresh page-session context from response headers
      // LinkedIn sends these on every SSR page load. They MUST be used
      // verbatim in SDUI requests — stale .env values cause HTTP 500.
      const appInstance =
        res.headers.get("x-li-application-instance") ?? undefined;
      const pageForestId =
        res.headers.get("x-li-initialpageforestid") ?? undefined;
      const trackingId =
        res.headers.get("x-li-page-instance-tracking-id") ?? undefined;
      const leafScreenId = res.headers.get("x-li-leaf-screen-id") ?? undefined;
      const appVersion =
        res.headers.get("x-li-application-version") ?? undefined;

      if (!res.ok) {
        console.warn(
          `[resolveProfileId] GET failed ${res.status} — session may be expired`,
        );
        return {};
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      console.log("[resolveProfileId] response length: ", text.length, "chars");
      // Log two snippets: the start (meta/RSC) and a section likely to contain entityUrn
      console.log(
        "[resolveProfileId] SNIPPET (start):",
        text.slice(0, 400).replace(/\n+/g, " "),
      );
      const urnIdx = text.indexOf("fsd_profile");
      if (urnIdx !== -1) {
        console.log(
          "[resolveProfileId] SNIPPET (fsd_profile):",
          text.slice(Math.max(0, urnIdx - 20), urnIdx + 80),
        );
      } else {
        console.log(
          '[resolveProfileId] NOTE: "fsd_profile" not found in page — checking alternative patterns',
        );
      }

      // HTML profile data
      // Extract name/headline/location/image from the SSR page while we have it.
      const htmlData = extractHtmlProfileData(text);

      // Pattern matching order (most specific → least specific)
      const ctx = (profileId: string): PageContext => ({
        profileId,
        htmlData,
        ...(appInstance ? { applicationInstance: appInstance } : {}),
        ...(pageForestId ? { pageForestId: pageForestId } : {}),
        ...(trackingId ? { pageInstanceTrackingId: trackingId } : {}),
        ...(leafScreenId ? { leafScreenId: leafScreenId } : {}),
        ...(appVersion ? { appVersion: appVersion } : {}),
      });

      // Pattern 1a: JSON entityUrn — "entityUrn":"urn:li:fsd_profile:ID"
      let m = text.match(/\"entityUrn\"\s*:\s*\"(urn:li:fsd_profile:[^\"]+)\"/);
      if (m?.[1]) {
        const id = m[1].replace("urn:li:fsd_profile:", "");
        console.log(
          `[resolveProfileId] ✓ P1a (entityUrn JSON): ${id.slice(0, 12)}… (${id.length} chars)`,
        );
        return ctx(id);
      }

      // Pattern 1b: URL-encoded entityUrn — entityUrn%22%3A%22urn%3Ali%3Afsd_profile%3AID
      m = text.match(
        /entityUrn(?:%22%3A%22|"\s*:\s*")urn(?:%3A|:)li(?:%3A|:)fsd_profile(?:%3A|:)([A-Za-z0-9+/=_-]{20,}?)(?=[%&"'\s])/,
      );
      if (m?.[1]) {
        const id = decodeURIComponent(m[1]);
        console.log(
          `[resolveProfileId] ✓ P1b (entityUrn URL-enc): ${id.slice(0, 12)}… (${id.length} chars)`,
        );
        return ctx(id);
      }

      // Pattern 3: URL-encoded fsd_profile URN (e.g. in image media URLs on the page).
      // Uses a precise boundary: &, ", ', or whitespace — avoids overcapturing.
      // Run BEFORE P2 (RSC greedy) which overcaptures by 7+ chars on long IDs.
      m = text.match(
        /fsd_profile(?:%3A|:)([A-Za-z0-9+/=_-]{20,}?)(?=[&"'\s%])/,
      );
      if (m?.[1]) {
        const id = decodeURIComponent(m[1]);
        console.log(
          `[resolveProfileId] ✓ P3 (URL-encoded): ${id.slice(0, 12)}… (${id.length} chars)`,
        );
        return ctx(id);
      }

      // Pattern 4: vieweeProfileId field in embedded JSON
      m = text.match(/\"vieweeProfileId\"\s*:\s*\"([^\"]{10,})\"/);
      if (m?.[1]) {
        console.log(
          `[resolveProfileId] ✓ P4 (vieweeProfileId): ${m[1].slice(0, 12)}… (${m[1].length} chars)`,
        );
        return ctx(m[1]);
      }

      // Pattern 2 (LAST RESORT): RSC component key — can overcapture.
      m = text.match(
        /\.profile\.card\.ref([A-Za-z0-9+/=_-]{20,})(?=[^A-Za-z0-9+/=_-])/,
      );
      if (m?.[1]) {
        console.log(
          `[resolveProfileId] ✓ P2 (RSC key, last resort): ${m[1].slice(0, 12)}… (${m[1].length} chars)`,
        );
        return ctx(m[1]);
      }

      console.warn(
        "[resolveProfileId] No profileId pattern matched — using session context only",
      );
      return {
        htmlData,
        ...(appInstance ? { applicationInstance: appInstance } : {}),
        ...(pageForestId ? { pageForestId: pageForestId } : {}),
        ...(trackingId ? { pageInstanceTrackingId: trackingId } : {}),
        ...(leafScreenId ? { leafScreenId: leafScreenId } : {}),
        ...(appVersion ? { appVersion: appVersion } : {}),
      };
    } catch (err) {
      console.warn(
        "[resolveProfileId] GET threw:",
        err instanceof Error ? err.message : err,
      );
      return {};
    }
  }

  async fetchComponent(options: ComponentOptions): Promise<RscResponse> {
    // M1: Pre-flight auth validation
    this.validateAuth();

    const sduiid = options.sduiid ?? options.componentId;
    const parentSpanId = generateParentSpanId();
    const query = new URLSearchParams({
      componentId: options.componentId,
      sduiid,
      parentSpanId,
    });
    const routeUrl = profilePath(options.publicIdentifier);

    const url = `${LINKEDIN_BASE}/flagship-web/rsc-action/actions/component?${query.toString()}`;
    const body =
      options.payloadStyle === "simple"
        ? {
            clientArguments: {
              payload: {
                isSelfView: false,
                vanityName: options.publicIdentifier,
              },
              states: [],
              requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
              screenId: "com.linkedin.sdui.flagshipnav.home.Home",
              knownTemplateIds: [],
            },
          }
        : {
            clientArguments: {
              payload: {
                isSelfView: false,
                vanityName: options.publicIdentifier,
                // Always send replaceableSectionArgs — required by LinkedIn SDUI server.
                // vieweeProfileId is the LinkedIn member URN; omit if unknown (server may 500 without it).
                replaceableSectionArgs: {
                  vanityName: options.publicIdentifier,
                  hideCardsForGoldenGate: false,
                  shouldSetupReplaceableComponent: true,
                  ...(options.profileId
                    ? { vieweeProfileId: options.profileId }
                    : {}),
                  isSelfView: false,
                  isSelfViewResolved: false,
                },
                // profileComponentState is required by the SDUI server for component state tracking.
                profileComponentState: buildProfileComponentState(
                  options.publicIdentifier,
                ),
              },
              states: [],
              requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
              screenId: "com.linkedin.sdui.flagshipnav.profile.Profile",
              knownTemplateIds: [],
            },
          };

    const headers = buildLinkedInHeaders(
      buildProfileContext(options.publicIdentifier, routeUrl, {
        ...options.pageContext,
      }),
    );
    const response = await this.request(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      routeUrl,
    );
    return decodeRscResponse(
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get("content-type") ?? "application/octet-stream",
      response.headers.get("content-encoding"),
    );
  }

  async navigateToDetail(
    section: DetailSection,
    publicIdentifier: string,
  ): Promise<RscResponse> {
    const definition = DETAIL_DEFINITIONS[section];
    const route = `/in/${encodeURIComponent(publicIdentifier)}/details/${definition.route}/`;
    const body = {
      $type: "proto.sdui.actions.core.NavigateToScreen",
      screenId: definition.screenId,
      pageKey: definition.pageKey,
      presentationStyle: "PresentationStyle_FULL_PAGE",
      presentation: {
        $case: "fullPage",
        fullPage: {
          $type: "proto.sdui.actions.core.presentation.FullPagePresentation",
        },
      },
      title: "",
      url: route,
      inheritActor: false,
      colorScheme: "ColorScheme_UNKNOWN",
      disableScreenGutters: false,
      shouldHideMobileTopNavBar: false,
      shouldHideLoadingSpinner: false,
      replaceCurrentScreen: false,
      shouldHideMobileTopNavBarDivider: false,
      clearBackStack: false,
      requestedArguments: {
        payload: { vanityName: publicIdentifier },
        states: [],
        requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
        screenId: "",
        knownTemplateIds: [],
      },
    };

    const headers = buildLinkedInHeaders(
      buildProfileContext(publicIdentifier, route),
    );
    headers["content-type"] = "application/json";
    const response = await this.request(
      `${LINKEDIN_BASE}/flagship-web${route}`,
      { method: "POST", headers, body: JSON.stringify(body) },
      route,
    );

    return decodeRscResponse(
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get("content-type") ?? "application/octet-stream",
      response.headers.get("content-encoding"),
    );
  }

  async fetchPagination(options: PaginationOptions): Promise<RscResponse> {
    const definition = DETAIL_DEFINITIONS[options.section];
    const start = options.start ?? 0;
    const count = options.count ?? 10;
    const route = `/in/${encodeURIComponent(options.publicIdentifier)}/details/${definition.route}/`;
    const pagerUrl = `${LINKEDIN_BASE}/flagship-web/rsc-action/actions/pagination`;

    const payload: Record<string, unknown> = {
      vanityName: options.publicIdentifier,
      profileId: options.profileId,
      start,
      count,
    };

    if (options.section === "education") {
      payload.detailSectionReplaceableComponentRef = `com.linkedin.sdui.profile.card.ref${options.profileId}EducationDetailsSection`;
    }

    if (options.section === "skills") {
      payload.filter = "ProfileSkillCategory_ALL";
    }

    const requestArguments = {
      $type: "proto.sdui.actions.requests.RequestedArguments",
      requestedStateKeys: [],
      payload,
      requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
      states: [],
      screenId: definition.screenId,
      knownTemplateIds: [],
    };

    const body = {
      pagerId: definition.pagerId,
      clientArguments: requestArguments,
      paginationRequest: {
        $type: "proto.sdui.actions.requests.PaginationRequest",
        trigger: {
          $case: "itemDistanceTrigger",
          itemDistanceTrigger: {
            $type: "proto.sdui.actions.requests.ItemDistanceTrigger",
            preloadDistance: 3,
            preloadLength: 250,
          },
        },
        retryCount: 2,
        requestedArguments: requestArguments,
      },
    };

    const url = `${pagerUrl}?sduiid=${encodeURIComponent(definition.pagerId)}`;
    const headers = buildLinkedInHeaders(
      buildProfileContext(options.publicIdentifier, route, options.pageContext),
    );
    headers["content-type"] = "application/json";
    const response = await this.request(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      route,
    );

    return decodeRscResponse(
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get("content-type") ?? "application/octet-stream",
      response.headers.get("content-encoding"),
    );
  }

  getComponentId(name: keyof typeof PROFILE_COMPONENTS): string {
    return PROFILE_COMPONENTS[name];
  }
}
