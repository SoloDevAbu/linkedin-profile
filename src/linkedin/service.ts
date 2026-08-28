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

    // Step 1: Resolve the LinkedIn member URN (vieweeProfileId).
    // This is required by the SDUI component endpoint to look up the profile.
    const vieweeProfileId = await this.client.resolveProfileId(publicIdentifier);
    console.log(`[getProfile] vieweeProfileId for "${publicIdentifier}": ${vieweeProfileId ?? 'not resolved – proceeding without it'}`);

    // Step 2: Fetch the main profile component.
    const response = await this.client.fetchComponent({
      publicIdentifier,
      componentId: PROFILE_COMPONENTS.aboveActivity,
      ...(vieweeProfileId ? { profileId: vieweeProfileId } : {})
    });

    const base = parseBaseProfile(response);
    const profile = normalizeBaseProfile(base);

    return {
      ...profile,
      url: inputUrl,
      publicIdentifier
    };
  }
}
