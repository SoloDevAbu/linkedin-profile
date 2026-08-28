export interface RscResponse {
  bytes: Uint8Array;
  text: string;
  contentType: string;
  contentEncoding: string | null;
}

export function decodeRscResponse(
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
  contentEncoding: string | null = null
): RscResponse {
  // Node's fetch transparently decompresses supported HTTP content-encodings,
  // so this function receives the decoded body and only handles the RSC payload itself.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return { bytes, text, contentType, contentEncoding };
}

export function rscLines(text: string): string[] {
  return text.split(/\r?\n/).filter(Boolean);
}

export function containsText(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

export function findFirstQuotedString(text: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`"${escaped}"\\s*[:=]\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`);
  const match = text.match(regex);
  return match?.[1] ? JSON.parse(`"${match[1]}"`) as string : null;
}
