import type { RscResponse } from './rsc.js';
import type { ProfileResponse } from '../../schemas/profile.js';

export interface ParsedBaseProfile {
  profileId: string | null;
  name: ProfileResponse['name'];
  headline: string | null;
  location: ProfileResponse['location'];
  about: string | null;
  profileImage: ProfileResponse['profileImage'];
}

function clean(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
  return normalized || null;
}

function findProfileId(text: string): string | null {
  const match = text.match(/ACo[A-Za-z0-9_-]{20,}/);
  return match?.[0] ?? null;
}

export function parseBaseProfile(_response: RscResponse): ParsedBaseProfile {
  // Deliberately conservative for phase 1.
  // The current LinkedIn top-card payload is SDUI/RSC, not a stable JSON contract.
  // We only persist identifiers here until the RSC entity parser is implemented.
  return {
    profileId: findProfileId(_response.text),
    name: { first: null, last: null, full: null },
    headline: clean(null),
    location: { raw: null, city: null, region: null, country: null },
    about: null,
    profileImage: { url: null }
  };
}
