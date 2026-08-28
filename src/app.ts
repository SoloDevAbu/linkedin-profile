import Fastify from 'fastify';
import { healthRoutes } from './routes/health.js';
import { profileRoutes } from './routes/profile.js';
import { LinkedInClient } from './linkedin/client.js';
import { LinkedInProfileService } from './linkedin/service.js';
import { registerRateLimit } from './middleware/rate-limit.js';

export function buildApp(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: true });
  const client = new LinkedInClient();
  const service = new LinkedInProfileService(client);

  registerRateLimit(app);
  void healthRoutes(app);
  void profileRoutes(app, service);

  return app;
}
