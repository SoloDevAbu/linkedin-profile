import { z } from 'zod';

export const profileRequestSchema = z.object({
  url: z.url()
}).strict();

export const profileResponseSchema = z.object({
  url: z.string(),
  publicIdentifier: z.string(),
  profileId: z.string().nullable(),
  name: z.object({
    first: z.string().nullable(),
    last: z.string().nullable(),
    full: z.string().nullable()
  }),
  headline: z.string().nullable(),
  location: z.object({
    raw: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string().nullable()
  }),
  about: z.string().nullable(),
  profileImage: z.object({
    url: z.string().nullable()
  }),
  experience: z.array(z.unknown()),
  education: z.array(z.unknown()),
  projects: z.array(z.unknown()),
  skills: z.array(z.unknown()),
  certifications: z.array(z.unknown()),
  languages: z.array(z.unknown())
});

export type ProfileRequest = z.infer<typeof profileRequestSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
