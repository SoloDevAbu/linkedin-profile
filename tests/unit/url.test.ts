import { describe, expect, it } from 'vitest';
import { extractPublicIdentifier } from '../../src/linkedin/url.js';

describe('extractPublicIdentifier', () => {
  it('extracts a LinkedIn profile identifier', () => {
    expect(extractPublicIdentifier('https://www.linkedin.com/in/guljar-hussain-7953a9243/'))
      .toBe('guljar-hussain-7953a9243');
  });

  it('rejects non-profile routes', () => {
    expect(() => extractPublicIdentifier('https://www.linkedin.com/company/example/')).toThrow();
  });
});
