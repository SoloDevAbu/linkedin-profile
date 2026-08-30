import type { RscResponse } from "./rsc.js";
import type { ProfileResponse } from "../../schemas/profile.js";

export interface ParsedBaseProfile {
  profileId: string | null;
  name: ProfileResponse["name"];
  headline: string | null;
  location: ProfileResponse["location"];
  about: string | null;
  profileImage: ProfileResponse["profileImage"];
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  return normalized || null;
}

/** Extract the member's profileId from RSC component key patterns. */
function findProfileId(text: string): string | null {
  // Pattern 1: component key "ref{ACo...}SomeSuffix" — profileId is the ACo part
  const m1 = text.match(
    /\.profile\.card\.ref(ACo[A-Za-z0-9_+/=-]{15,}?)(?=[A-Z])/,
  );
  if (m1?.[1]) return m1[1];
  // Pattern 2: vanity-name binding e.g. "highlightedReactorName-urn:li:ugcPost:xxx"
  // — profile id often in fsd_profile URN
  const m2 = text.match(
    /fsd_profile[%:](ACo[A-Za-z0-9_+/=-]{15,}?)(?=[%"&'\s\\])/,
  );
  if (m2?.[1]) return decodeURIComponent(m2[1]);
  // Pattern 3: simple ACo match
  const m3 = text.match(/ACo[A-Za-z0-9_+/=-]{20,}/);
  return m3?.[0] ?? null;
}

/**
 * Extract the member's full name from the `modelStates` array.
 *
 * LinkedIn SDUI stores the name as:
 *   {"key":{"key":{"value":{"$case":"id","id":"highlightedReactorName-urn:li:..."}}},...
 *    "value":{"$case":"stringValue","stringValue":"<Full Name>"}}
 *
 * This key appears in the `profileCardsActivity` component because the member's
 * name is embedded in the activity feed's reaction state.
 */
function findFullName(text: string): string | null {
  // Match: "id":"highlightedReactorName-<anything>"} ... "stringValue":"<Name>"
  // Both fields appear within the same modelState object.
  // We scan all occurrences of highlightedReactorName and capture the nearest stringValue.
  const namePattern =
    /"id"\s*:\s*"highlightedReactorName-[^"]+"[^}]*?}[^}]*?}[^}]*?}[^}]*?}[^}]*?}[^}]*?"stringValue"\s*:\s*"([^"]+)"/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = namePattern.exec(text)) !== null) {
    if (m[1] !== undefined) matches.push(m[1]);
  }
  if (matches.length === 0) return null;
  // All occurrences should be the same name — return the first
  return clean(matches[0]);
}

/**
 * Extract profile image URL.
 * LinkedIn image data appears as:
 *   "rootUrl":"https://media.licdn.com/dms/image/.../profile-displayphoto-shrink_"
 *   "suffixUrl":"200_200/..."
 * We pick the 200×200 rendition for a balanced image size.
 */
function findProfileImage(text: string): string | null {
  // Find rootUrl that looks like a profile photo
  const rootMatch = text.match(
    /"rootUrl"\s*:\s*"(https:\/\/media\.licdn\.com\/dms\/image\/[^"]*?profile-displayphoto-shrink_)"/,
  );
  if (!rootMatch) return null;
  const root = rootMatch[1];

  // Find the 200x200 suffixUrl that follows the rootUrl
  const rootIdx = text.indexOf(rootMatch[0]);
  const afterRoot = text.slice(rootIdx, rootIdx + 2000);
  const suffixMatch =
    afterRoot.match(/"width"\s*:\s*200[^}]*?"suffixUrl"\s*:\s*"([^"]+)"/) ??
    afterRoot.match(/"suffixUrl"\s*:\s*"([^"]+200_200[^"]+)"/) ??
    afterRoot.match(/"suffixUrl"\s*:\s*"([^"]+)"/s);
  if (!root || !suffixMatch?.[1]) return clean(root ?? null);
  return clean(root + suffixMatch[1]);
}

/**
 * Walk an RSC JSON node recursively and collect all leaf string values
 * found inside "children" arrays. Used to harvest pre-rendered text snippets.
 */
function collectTextNodes(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    const s = node.trim();
    if (s && !s.startsWith("$")) out.push(s);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectTextNodes(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // Recurse into children and textProps.children
    if ("children" in obj) collectTextNodes(obj["children"], out);
    if (
      "textProps" in obj &&
      obj["textProps"] &&
      typeof obj["textProps"] === "object"
    ) {
      const tp = obj["textProps"] as Record<string, unknown>;
      if ("children" in tp) collectTextNodes(tp["children"], out);
    }
  }
}

/**
 * Returns true if a string looks like a CSS class-name token.
 * LinkedIn RSC className values are hex hashes: e.g. "aa13b50b", "_01e54e47".
 * They contain only lowercase hex digits (0-9, a-f) and leading underscores.
 */
function isCssClassString(s: string): boolean {
  return s
    .trim()
    .split(/\s+/)
    .every((token) => /^_?[0-9a-f]{6,}$/i.test(token));
}

function findAbout(text: string): string | null {
  const headlineIdx = text.indexOf('"profile_headline_loading_state"');
  const searchFrom = headlineIdx >= 0 ? headlineIdx : 0;

  const anchorIdx = text.indexOf("typographyVars", searchFrom);
  if (anchorIdx === -1) return null;

  const win = text.slice(Math.max(0, anchorIdx - 50), anchorIdx + 15000);

  const lineRe =
    /"children"\s*:\s*\[\s*(?:\["\$","br",null,\{\}\]|null)\s*,\s*"((?:[^"\\]|\\.)*)"/g;

  const lines: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(win)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    let line: string;
    try {
      line = JSON.parse(`"${raw}"`) as string;
    } catch {
      line = raw;
    }
    line = line.trim();
    if (!line) continue;
    if (isCssClassString(line)) continue;
    if (line.startsWith("com.linkedin")) continue;
    if (line.includes("urn:li")) continue;
    if (line.startsWith("$")) continue;
    lines.push(line);
  }

  if (lines.length === 0) return null;

  const unique = lines.filter((l, i) => l !== lines[i - 1]);

  return unique.join("\n") || null;
}

/**
 * Extract the headline from the `profile_headline_loading_state` stringValue.
 */
function findHeadline(text: string): string | null {
  const match = text.match(
    /"id"\s*:\s*"profile_headline_loading_state".*?"stringValue"\s*:\s*"([^"]+)"/,
  );
  return clean(match?.[1]);
}

/**
 * Extract the location from the `profile_location_loading_state` stringValue.
 * This model state is present for profiles that have a structured location set.
 * Returns null if absent.
 */
function findLocation(text: string): string | null {
  const match = text.match(
    /"id"\s*:\s*"profile_location_loading_state".*?"stringValue"\s*:\s*"([^"]+)"/,
  );
  return clean(match?.[1]);
}

export function parseBaseProfile(response: RscResponse): ParsedBaseProfile {
  const text = response.text;

  const profileId = findProfileId(text);

  const fullName = findFullName(text);
  let firstName: string | null = null;
  let lastName: string | null = null;
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    firstName = parts[0] ?? null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }

  const imageUrl = findProfileImage(text);

  const about = findAbout(text);

  const headline = findHeadline(text);

  const rawLocation = findLocation(text);
  const location: ParsedBaseProfile["location"] = {
    raw: rawLocation,
    city: null,
    region: null,
    country: null,
  };

  return {
    profileId,
    name: { first: firstName, last: lastName, full: fullName },
    headline,
    location,
    about,
    profileImage: { url: imageUrl },
  };
}
