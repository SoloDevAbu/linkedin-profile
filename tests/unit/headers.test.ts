import { describe, expect, it } from 'vitest';

// This test imports after setting process env so it can verify the pure header builder.
process.env.LINKEDIN_COOKIE = 'JSESSIONID="abc123"; li_at=secret';
process.env.LINKEDIN_CSRF_TOKEN = '';

const { buildLinkedInHeaders } = await import('../../src/linkedin/headers.js');

describe('buildLinkedInHeaders', () => {
  it('derives the csrf token from JSESSIONID when not explicitly set', () => {
    const headers = buildLinkedInHeaders({ initialUrl: '/in/test/', routeUrl: '/in/test/details/education/' });
    expect(headers['csrf-token']).toBe('ajax:abc123');
    expect(headers.cookie).toContain('li_at=secret');
    expect(headers['x-li-rsc-stream']).toBe('true');
  });
});
