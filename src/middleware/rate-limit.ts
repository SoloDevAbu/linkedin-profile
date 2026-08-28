import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

interface Bucket { count: number; resetAt: number }

export function registerRateLimit(app: FastifyInstance): void {
  const buckets = new Map<string, Bucket>();

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.ip;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + env.RATE_LIMIT_WINDOW_MS };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > env.RATE_LIMIT_MAX) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests.' }
      });
    }
  });
}
