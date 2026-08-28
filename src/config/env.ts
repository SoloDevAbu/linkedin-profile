import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LINKEDIN_COOKIE: z.string().default(''),
  LINKEDIN_CSRF_TOKEN: z.string().default(''),
  LINKEDIN_USER_AGENT: z.string().default('Mozilla/5.0'),
  LINKEDIN_APP_VERSION: z.string().default('0.2.6951'),
  LINKEDIN_SDUI_VERSION: z.string().default('0.1.50904'),
  LINKEDIN_APPLICATION_INSTANCE: z.string().default(''),
  LINKEDIN_PAGE_INSTANCE: z.string().default(''),
  LINKEDIN_PAGE_INSTANCE_TRACKING_ID: z.string().default(''),
  LINKEDIN_PAGE_FOREST_ID: z.string().default(''),
  LINKEDIN_ANCHOR_PAGE_KEY: z.string().default('d_flagship3_profile_view_base'),
  LINKEDIN_TIMEZONE: z.string().default('Asia/Calcutta'),
  LINKEDIN_TIMEZONE_OFFSET: z.string().default('5.5'),
  LINKEDIN_DEVICE_FORM_FACTOR: z.string().default('DESKTOP'),
  LINKEDIN_DISPLAY_DENSITY: z.string().default('1.25'),
  LINKEDIN_DISPLAY_WIDTH: z.string().default('1920'),
  LINKEDIN_DISPLAY_HEIGHT: z.string().default('1080'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000)
});

export const env = envSchema.parse(process.env);
