import type { FastifyInstance } from 'fastify';
import { profileRequestSchema } from '../schemas/profile.js';
import { InvalidLinkedInUrlError } from '../linkedin/url.js';
import { LinkedInHttpError } from '../linkedin/client.js';
import { LinkedInProfileService } from '../linkedin/service.js';

export async function profileRoutes(app: FastifyInstance, service: LinkedInProfileService): Promise<void> {
  app.post('/v1/profile', async (request, reply) => {
    const parsed = profileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Body must be { "url": "https://www.linkedin.com/in/<identifier>/" }.'
        }
      });
    }

    try {
      return await service.getProfile(parsed.data.url);
    } catch (error) {
      if (error instanceof InvalidLinkedInUrlError) {
        return reply.code(400).send({ error: { code: 'INVALID_LINKEDIN_URL', message: error.message } });
      }
      if (error instanceof LinkedInHttpError) {
        const status = error.status === 401 || error.status === 403 ? 502 : error.status === 429 ? 429 : 502;
        const code = error.status === 429 ? 'LINKEDIN_RATE_LIMITED' : 'LINKEDIN_REQUEST_FAILED';
        return reply.code(status).send({ error: { code, message: error.message } });
      }

      request.log.error({ err: error }, 'profile fetch failed');
      return reply.code(502).send({
        error: {
          code: 'PROFILE_FETCH_FAILED',
          message: 'Failed to retrieve the LinkedIn profile.'
        }
      });
    }
  });
}
