import type { RscResponse } from "./rsc.js";

export function parseSkills(response: RscResponse): any[] {
  const text = response.text;
  if (!text) return [];

  const matches = [...text.matchAll(/"children"\s*:\s*\[\s*"([^"$][^"]+?)"\s*\]/g)];
  const values = matches
    .map(m => m[1]?.trim() ?? '')
    .filter(v => 
      v.length > 2 && 
      !v.includes('urn:li') && 
      !v.includes('com.linkedin') && 
      !v.includes('Profile_') &&
      v !== 'Collapsed' &&
      v !== 'Expanded' &&
      v !== 'Show all' &&
      v !== 'Message' &&
      v !== 'Endorse'
    );

  const uniqueValues = [...new Set(values)];
  return uniqueValues.map(v => ({ name: v }));
}
