import { LinkedInClient } from './client.js';
import { extractPublicIdentifier } from './url.js';
import { PROFILE_COMPONENTS } from './components.js';
import { parseBaseProfile } from './parsers/profile.js';
import { normalizeBaseProfile } from './normalizers/profile.js';
import type { ProfileResponse } from '../schemas/profile.js';

export class LinkedInProfileService {
  constructor(private readonly client: LinkedInClient) {}

  async getProfile(inputUrl: string): Promise<ProfileResponse> {
    const publicIdentifier = extractPublicIdentifier(inputUrl);

    // Step 1: Resolve the LinkedIn member URN + extract fresh page-session context.
    // LinkedIn returns x-li-application-instance, x-li-initialpageforestid, etc.
    // in the GET response headers. These MUST be used in subsequent SDUI requests;
    // stale .env values cause HTTP 500.
    const pageCtx = await this.client.resolveProfileId(publicIdentifier);
    const { profileId: vieweeProfileId, ...sessionCtx } = pageCtx;
    console.log(
      `[getProfile] vieweeProfileId for "${publicIdentifier}":`,
      vieweeProfileId ?? '(not resolved — proceeding without it)',
    );
    console.log('[getProfile] fresh session context:', {
      applicationInstance: sessionCtx.applicationInstance ?? '(none)',
      pageForestId: sessionCtx.pageForestId ?? '(none)',
      pageInstanceTrackingId: sessionCtx.pageInstanceTrackingId ?? '(none)',
      leafScreenId: sessionCtx.leafScreenId ?? '(none)',
    });

    // Step 2: Fetch the main profile component using fresh page context.
    const response = await this.client.fetchComponent({
      publicIdentifier,
      componentId: PROFILE_COMPONENTS.aboveActivity,
      ...(vieweeProfileId ? { profileId: vieweeProfileId } : {}),
      // Fresh session context from GET response overrides stale .env values.
      // appVersion is included so x-li-application-version + x-li-track stay coherent.
      // Conditional spreads satisfy exactOptionalPropertyTypes: keys are omitted
      // entirely when undefined, never explicitly set to undefined.
      pageContext: {
        ...(sessionCtx.applicationInstance    ? { applicationInstance:    sessionCtx.applicationInstance }    : {}),
        ...(sessionCtx.pageForestId           ? { pageForestId:           sessionCtx.pageForestId }           : {}),
        ...(sessionCtx.pageInstanceTrackingId ? { pageInstanceTrackingId: sessionCtx.pageInstanceTrackingId } : {}),
        ...(sessionCtx.appVersion             ? { appVersion:             sessionCtx.appVersion }             : {}),
      },
    });

    const base = parseBaseProfile(response);
    const profile = normalizeBaseProfile(base);

    return {
      ...profile,
      url: inputUrl,
      publicIdentifier,
    };
  }
}
