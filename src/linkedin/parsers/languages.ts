import type { RscResponse } from "./rsc.js";

export function parseLanguages(response: RscResponse): any[] {
  const text = response.text;
  if (!text) return [];

  const matches = [
    ...text.matchAll(/"children"\s*:\s*\[\s*"([^"$][^"]+?)"\s*\]/g),
  ];

  const values = matches
    .map((m) => m[1]?.trim() ?? "")
    .filter(
      (v) =>
        v.length > 2 &&
        !v.includes("urn:li") &&
        !v.includes("com.linkedin") &&
        !v.includes("Profile_") &&
        v !== "Collapsed" &&
        v !== "Expanded" &&
        v !== "Show all" &&
        v !== "Languages",
    );

  const uniqueValues = values.filter((val, i) => val !== values[i - 1]);

  // LinkedIn standard proficiencies
  const proficiencies = new Set([
    "Elementary proficiency",
    "Limited working proficiency",
    "Professional working proficiency",
    "Full professional proficiency",
    "Native or bilingual proficiency",
  ]);

  const results: any[] = [];

  for (const val of uniqueValues) {
    if (proficiencies.has(val) || val.toLowerCase().includes("proficiency")) {
      if (results.length > 0) {
        results[results.length - 1].proficiency = val;
      }
    } else {
      results.push({ name: val });
    }
  }

  return results;
}
