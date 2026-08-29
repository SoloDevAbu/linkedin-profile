import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('POST /v1/profile', () => {
  it('validates the request body before contacting LinkedIn', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/profile',
      payload: { url: 'not-a-url' }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
