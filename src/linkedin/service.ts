import { LinkedInClient } from "./client.js";
import { extractPublicIdentifier } from "./url.js";
import { PROFILE_COMPONENTS } from "./components.js";
import { parseBaseProfile } from "./parsers/profile.js";
import { normalizeBaseProfile } from "./normalizers/profile.js";
import { parseExperience } from "./parsers/experience.js";
import { parseEducation } from "./parsers/education.js";
import { parseProjects } from "./parsers/projects.js";
import { parseCertifications } from "./parsers/certifications.js";
import { parseSkills } from "./parsers/skills.js";
import { parseLanguages } from "./parsers/languages.js";
import type { ProfileResponse } from "../schemas/profile.js";

export class LinkedInProfileService {
  constructor(private readonly client: LinkedInClient) {}

  async getProfile(inputUrl: string): Promise<ProfileResponse> {
    const publicIdentifier = extractPublicIdentifier(inputUrl);

    // Step 1: Resolve the LinkedIn member URN + extract fresh page-session context.
    // LinkedIn returns x-li-application-instance, x-li-initialpageforestid, etc.
    // in the GET response headers. These MUST be used in subsequent SDUI requests;
    // stale .env values cause HTTP 500.
    // The HTML response body is also mined for name/headline/location/image (htmlData).
    const pageCtx = await this.client.resolveProfileId(publicIdentifier);
    const { profileId: vieweeProfileId, htmlData, ...sessionCtx } = pageCtx;
    console.log(
      `[getProfile] vieweeProfileId for "${publicIdentifier}":`,
      vieweeProfileId ?? "(not resolved — proceeding without it)",
    );
    // (Removed verbose session context logging to prevent confidential data leaks)
    console.log("[getProfile] htmlData:", {
      fullName: htmlData?.fullName ?? "(none)",
      headline: htmlData?.headline ?? "(none)",
      location: htmlData?.location ?? "(none)",
      imageUrl: htmlData?.imageUrl?.slice(0, 60) ?? "(none)",
    });

    // Step 2: Fetch profile components concurrently using fresh page context.
    const baseRequestOpts = {
      publicIdentifier,
      payloadStyle: "simple" as const,
      ...(vieweeProfileId ? { profileId: vieweeProfileId } : {}),
      pageContext: {
        ...(sessionCtx.applicationInstance
          ? { applicationInstance: sessionCtx.applicationInstance }
          : {}),
        ...(sessionCtx.pageForestId
          ? { pageForestId: sessionCtx.pageForestId }
          : {}),
        ...(sessionCtx.pageInstanceTrackingId
          ? { pageInstanceTrackingId: sessionCtx.pageInstanceTrackingId }
          : {}),
        ...(sessionCtx.appVersion ? { appVersion: sessionCtx.appVersion } : {}),
      },
    };

    const [activityRes, aboveActivityRes, experienceRes, below1Res] =
      await Promise.all([
        this.client.fetchComponent({
          ...baseRequestOpts,
          componentId: PROFILE_COMPONENTS.activity,
        }),
        this.client.fetchComponent({
          ...baseRequestOpts,
          componentId: PROFILE_COMPONENTS.aboveActivity,
        }),
        this.client.fetchComponent({
          ...baseRequestOpts,
          componentId: PROFILE_COMPONENTS.experience,
        }),
        this.client.fetchComponent({
          ...baseRequestOpts,
          componentId: PROFILE_COMPONENTS.below1,
        }),
      ]);

    // Step 3: Parse the RSC response for any additional fields (profileId fallback, etc.)
    const combinedBaseText = activityRes.text + "\n" + aboveActivityRes.text;
    const base = parseBaseProfile({ ...activityRes, text: combinedBaseText });
    const profile = normalizeBaseProfile(base);

    profile.experience = parseExperience(experienceRes);

    const resolvedProfileId = vieweeProfileId || base.profileId;
    if (resolvedProfileId) {
      const paginationOpts = {
        publicIdentifier,
        profileId: resolvedProfileId,
        pageContext: baseRequestOpts.pageContext,
        count: 50,
      };

      const [eduRes, projRes, certRes, skillsRes, langRes] =
        await Promise.allSettled([
          this.client.fetchPagination({
            ...paginationOpts,
            section: "education",
          }),
          this.client.fetchPagination({
            ...paginationOpts,
            section: "projects",
          }),
          this.client.fetchPagination({
            ...paginationOpts,
            section: "certifications",
          }),
          this.client.fetchPagination({ ...paginationOpts, section: "skills" }),
          this.client.fetchPagination({
            ...paginationOpts,
            section: "languages",
          }),
        ]);

      if (eduRes.status === "fulfilled")
        profile.education = parseEducation(eduRes.value);
      if (projRes.status === "fulfilled")
        profile.projects = parseProjects(projRes.value);
      if (certRes.status === "fulfilled")
        profile.certifications = parseCertifications(certRes.value);
      if (skillsRes.status === "fulfilled")
        profile.skills = parseSkills(skillsRes.value);
      if (langRes.status === "fulfilled")
        profile.languages = parseLanguages(langRes.value);
    } else {
      profile.education = parseEducation(below1Res);
    }

    // Step 4: Merge htmlData (from SSR HTML) — these values are authoritative for
    // top-card fields (name, headline, location, image) and always override RSC-parsed values.
    if (htmlData) {
      // Name: split full name into first/last
      const fullName = htmlData.fullName;
      if (fullName) {
        const parts = fullName.trim().split(/\s+/);
        profile.name = {
          first: parts[0] ?? null,
          last: parts.length > 1 ? parts.slice(1).join(" ") : null,
          full: fullName,
        };
      }
      if (htmlData.headline) profile.headline = htmlData.headline;
      if (htmlData.location)
        profile.location = {
          raw: htmlData.location,
          city: null,
          region: null,
          country: null,
        };
      if (htmlData.about) profile.about = htmlData.about;
      if (htmlData.imageUrl) profile.profileImage = { url: htmlData.imageUrl };
    }

    return {
      ...profile,
      url: inputUrl,
      publicIdentifier,
    };
  }
}
