import { env } from "../config/env.js";
import { buildLinkedInHeaders, buildProfileContext } from "./headers.js";
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

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

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
}

export interface PaginationOptions {
  section: DetailSection;
  publicIdentifier: string;
  profileId: string;
  start?: number;
  count?: number;
}

export class LinkedInClient {
  constructor(private readonly timeoutMs = env.REQUEST_TIMEOUT_MS) {}

  private async request(
    url: string,
    init: RequestInit,
    routeUrl: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    // ── DEBUG: log outgoing request ────────────────────────────────────────
    console.log("\n========== [LinkedIn Outgoing Request] ==========");
    console.log("  Method     :", init.method ?? "GET");
    console.log("  URL        :", url);
    console.log("  Route URL  :", routeUrl);
    console.log(
      "  Headers    :",
      JSON.stringify(
        safeHeaders((init.headers ?? {}) as Record<string, string>),
        null,
        4,
      ),
    );
    if (init.body) {
      try {
        const parsed = JSON.parse(init.body as string);
        console.log("  Body       :", JSON.stringify(parsed, null, 4));
      } catch {
        console.log("  Body (raw) :", init.body);
      }
    }
    console.log("=================================================\n");
    // ──────────────────────────────────────────────────────────────────────

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      // ── DEBUG: log response status ────────────────────────────────────
      console.log(
        `[LinkedIn Response] ${response.status} ${response.statusText} <- ${url}`,
      );
      // ────────────────────────────────────────────────────────────────

      if (!response.ok) {
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
   * Strategy: GET the profile HTML page with browser navigation headers.
   * LinkedIn's SSR resolves the profileId from the vanityName server-side
   * and embeds it in the page. We extract it using multiple patterns.
   */
  async resolveProfileId(vanityName: string): Promise<string | undefined> {
    const profileUrl = `${LINKEDIN_BASE}/in/${encodeURIComponent(vanityName)}/`;
    console.log(`[resolveProfileId] GET ${profileUrl}`);

    const headers: Record<string, string> = {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en,en-IN;q=0.9,hi;q=0.8',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'user-agent': env.LINKEDIN_USER_AGENT,
    };
    if (env.LINKEDIN_COOKIE) headers.cookie = env.LINKEDIN_COOKIE;
    if (env.LINKEDIN_CSRF_TOKEN) headers['csrf-token'] = env.LINKEDIN_CSRF_TOKEN;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(profileUrl, { method: 'GET', headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      const ct = res.headers.get('content-type') ?? '(none)';
      console.log(`[resolveProfileId] status=${res.status}  content-type=${ct}`);

      if (!res.ok) {
        console.warn(`[resolveProfileId] GET failed ${res.status} — session may be expired`);
        return undefined;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      console.log(`[resolveProfileId] response length: ${text.length} chars`);
      console.log('[resolveProfileId] SNIPPET:', text.slice(0, 600).replace(/\n+/g, ' '));

      // Pattern 1: JSON entityUrn embedded in page data
      let m = text.match(/"entityUrn"\s*:\s*"(urn:li:fsd_profile:[^"]+)"/);
      if (m?.[1]) {
        const id = m[1].replace('urn:li:fsd_profile:', '');
        console.log(`[resolveProfileId] ✓ P1 (entityUrn): ${id.slice(0, 12)}…`);
        return id;
      }

      // Pattern 2: RSC component key if LinkedIn serves RSC for navigation
      m = text.match(/\.profile\.card\.ref([A-Za-z0-9+/=_-]{20,}?)(?=[A-Z])/);
      if (m?.[1]) {
        console.log(`[resolveProfileId] ✓ P2 (RSC key): ${m[1].slice(0, 12)}…`);
        return m[1];
      }

      // Pattern 3: URL-encoded fsd_profile URN
      m = text.match(/fsd_profile(?:%3A|:)([A-Za-z0-9+%/_=-]{20,}?)(?=[&"'\s])/);
      if (m?.[1]) {
        const id = decodeURIComponent(m[1]);
        console.log(`[resolveProfileId] ✓ P3 (URL-encoded): ${id.slice(0, 12)}…`);
        return id;
      }

      // Pattern 4: vieweeProfileId field in embedded JSON
      m = text.match(/"vieweeProfileId"\s*:\s*"([^"]{10,})"/);
      if (m?.[1]) {
        console.log(`[resolveProfileId] ✓ P4 (vieweeProfileId): ${m[1].slice(0, 12)}…`);
        return m[1];
      }

      console.warn('[resolveProfileId] No pattern matched — share the SNIPPET above for debugging');
      return undefined;

    } catch (err) {
      console.warn('[resolveProfileId] GET threw:', err instanceof Error ? err.message : err);
      return undefined;
    }
  }



  async fetchComponent(options: ComponentOptions): Promise<RscResponse> {
    const sduiid = options.sduiid ?? options.componentId;
    const parentSpanId = generateParentSpanId();
    const query = new URLSearchParams({
      componentId: options.componentId,
      sduiid,
      parentSpanId,
    });
    const routeUrl = profilePath(options.publicIdentifier);

    const url = `${LINKEDIN_BASE}/flagship-web/rsc-action/actions/component?${query.toString()}`;
    const body = {
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
      buildProfileContext(options.publicIdentifier, routeUrl),
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
      buildProfileContext(options.publicIdentifier, route),
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
