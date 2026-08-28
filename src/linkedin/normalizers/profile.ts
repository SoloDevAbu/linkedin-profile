import type { ParsedBaseProfile } from '../parsers/profile.js';
import type { ProfileResponse } from '../../schemas/profile.js';

export function normalizeBaseProfile(input: ParsedBaseProfile): ProfileResponse {
  return {
    url: '',
    publicIdentifier: '',
    profileId: input.profileId,
    name: input.name,
    headline: input.headline,
    location: input.location,
    about: input.about,
    profileImage: input.profileImage,
    experience: [],
    education: [],
    projects: [],
    skills: [],
    certifications: [],
    languages: []
  };
}
