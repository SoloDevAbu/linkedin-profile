export class InvalidLinkedInUrlError extends Error {
  constructor(message = 'Invalid LinkedIn profile URL') {
    super(message);
    this.name = 'InvalidLinkedInUrlError';
  }
}

export function extractPublicIdentifier(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidLinkedInUrlError();
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidLinkedInUrlError();
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'linkedin.com' && hostname !== 'www.linkedin.com') {
    throw new InvalidLinkedInUrlError('URL must point to linkedin.com');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'in') {
    throw new InvalidLinkedInUrlError('URL must have the form https://www.linkedin.com/in/<public-identifier>/');
  }

  return decodeURIComponent(parts[1]!).trim();
}

export function profilePath(publicIdentifier: string): string {
  return `/in/${encodeURIComponent(publicIdentifier)}/`;
}
