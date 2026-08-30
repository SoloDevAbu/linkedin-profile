# LinkedIn Profile API

A reverse-engineered REST API that retrieves structured data from a public LinkedIn profile page. The implementation uses **direct HTTP requests only** — no browser automation, headless browsers, or Playwright/Puppeteer are involved at any stage.

Built with **Fastify**, **TypeScript**, and **Node.js ≥ 20**.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Key Features / Supported Profile Fields](#key-features--supported-profile-fields)
3. [Architecture and Request Flow](#architecture-and-request-flow)
4. [Reverse-Engineering Approach](#reverse-engineering-approach)
5. [Authentication / Session Context](#authentication--session-context)
6. [Setup and Installation](#setup-and-installation)
7. [Environment Variables](#environment-variables)
8. [Running Locally](#running-locally)
9. [API Endpoint Reference](#api-endpoint-reference)
10. [Project Structure](#project-structure)
11. [Testing](#testing)
12. [Deployment / HTTPS](#deployment--https)
13. [Known Limitations](#known-limitations)
14. [Security Considerations](#security-considerations)

---

## Project Overview

This API accepts a LinkedIn profile URL and returns a normalized JSON document containing the profile's top-card data (name, headline, location, profile photo, about summary) together with structured sections: experience, education, projects, skills, certifications, and languages.

LinkedIn does not expose a public data API. All data is obtained by replicating the exact sequence of authenticated HTTP requests that the LinkedIn web application makes when a user visits a profile page — specifically the **Flagship Web** server-side rendering (SSR) page, the **SDUI/RSC component** endpoint, the **RSC detail-screen navigation** endpoint, and the **RSC pagination** endpoint.

---

## Key Features / Supported Profile Fields

| Field | Source |
|---|---|
| `name` (first, last, full) | SSR HTML JSON-LD / `og:title` |
| `headline` | SSR HTML JSON-LD / `og:description` |
| `location` (raw string) | SSR HTML JSON-LD / `og:description` |
| `about` | SSR HTML JSON-LD / SDUI RSC stream |
| `profileImage.url` | SSR HTML `og:image` / `<link rel="preload">` |
| `profileId` (member URN) | SSR HTML embedded JSON patterns |
| `experience[]` | SDUI component `profileCardsExperienceOnly` |
| `education[]` | Pagination endpoint (section: education) |
| `projects[]` | Pagination endpoint (section: projects) |
| `skills[]` | Pagination endpoint (section: skills) |
| `certifications[]` | Pagination endpoint (section: certifications) |
| `languages[]` | Stub (always `[]`) — parser not yet implemented |

Structured section items (`experience`, `education`, `projects`, `certifications`) contain: `title`, `subtitle`, `dateRange`, `locationOrExtra`, and `description` where available.

Skills items are returned as `{ name: string }` objects.

---

## Architecture and Request Flow

```
Client
  │
  │  POST /v1/profile  { "url": "https://www.linkedin.com/in/<id>/" }
  ▼
Fastify App  (src/app.ts)
  │
  ├─ Rate-limit middleware  (src/middleware/rate-limit.ts)
  │    Fixed-window in-memory counter per client IP
  │
  ├─ Route handler          (src/routes/profile.ts)
  │    Validates body with Zod schema
  │
  └─ LinkedInProfileService (src/linkedin/service.ts)
       │
       ├─ Step 1: GET  https://www.linkedin.com/in/<vanityName>/
       │    LinkedInClient.resolveProfileId()
       │    → Extracts member URN (profileId) from embedded JSON patterns
       │    → Extracts fresh page-session headers from HTTP response headers
       │    → Mines name/headline/location/image from HTML (JSON-LD, OG tags, <title>)
       │
       ├─ Step 2: POST (×4 concurrent)  /flagship-web/rsc-action/actions/component
       │    LinkedInClient.fetchComponent()
       │    Components: activity, aboveActivity, experienceOnly, belowActivity1
       │    → Parses RSC text stream for name, headline, profileId, profile image
       │    → Parses experience section from RSC stream
       │
       └─ Step 3: POST (×4 concurrent)  /flagship-web/rsc-action/actions/pagination
            LinkedInClient.fetchPagination()
            Sections: education, projects, certifications, skills
            → Parses each RSC text stream into structured items
```

### Data merge strategy

Top-card fields (name, headline, location, profile image) obtained from the **SSR HTML** always override values extracted from the SDUI RSC stream, because the HTML meta tags are the most stable and authoritative source for these fields.

---

## Reverse-Engineering Approach

LinkedIn's web application was analysed using a captured HAR archive. Four distinct internal request patterns were identified and replicated:

### 1. Flagship Web SSR page (`GET /in/<vanityName>/`)

The initial profile page load returns a standard HTML document. It embeds:

- A `<script type="application/ld+json">` block containing a `schema.org/Person` entity with name, jobTitle, description, address, and image.
- Open Graph meta tags (`og:title`, `og:description`, `og:image`).
- Embedded JSON containing the member's `entityUrn` (URN of the form `urn:li:fsd_profile:<ID>`), which is the internal member identifier required by subsequent SDUI requests.

The response headers on this request include fresh page-session identifiers that must be forwarded to every subsequent SDUI request:

| Response header | Purpose |
|---|---|
| `x-li-application-instance` | Identifies the current application deployment instance |
| `x-li-initialpageforestid` | Page-session trace root; doubles as the W3C `traceparent` traceId |
| `x-li-page-instance-tracking-id` | Per-session tracking identifier |
| `x-li-application-version` | Deployed app version string |

Using **stale** values from `.env` for these fields causes the SDUI server to return HTTP 500. The app always reads them fresh from the GET response.

### 2. SDUI/RSC component endpoint (`POST /flagship-web/rsc-action/actions/component`)

This is LinkedIn's internal React Server Components streaming action endpoint. The app sends a JSON body describing a `clientArguments` payload that identifies which profile card component to render. The response is an `application/octet-stream` RSC text stream, not standard JSON.

Two request body shapes are used:

- **`simple`** (`screenId: home.Home`): Lightweight payload used for the `profileCardsActivity` component. Body contains `{ isSelfView, vanityName }`.
- **`full`** (`screenId: profile.Profile`): Complex payload used for all other components. Body includes `replaceableSectionArgs` (containing the resolved `vieweeProfileId`) and a `profileComponentState` binding map with component-state keys.

Component IDs fetched:

| Key | Component ID |
|---|---|
| activity | `com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity` |
| aboveActivity | `com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity` |
| experience | `com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly` |
| below1 | `com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1WithoutExp` |

### 3. RSC detail-screen navigation (`POST /flagship-web/in/<vanityName>/details/<section>/`)

A `proto.sdui.actions.core.NavigateToScreen` action body that tells the SDUI server to render a full-page detail screen. This is a prerequisite step to establish the page context for the pagination request that follows. (Currently used internally by the client; section data is retrieved via the pagination endpoint described below.)

### 4. RSC pagination endpoint (`POST /flagship-web/rsc-action/actions/pagination?sduiid=<pagerId>`)

Used to retrieve full section data (education, projects, certifications, skills). Each call sends a `pagerId`, a `paginationRequest` with an `itemDistanceTrigger`, and a `requestedArguments` payload containing `vanityName`, `profileId`, `start`, and `count`.

Pager IDs per section:

| Section | Pager ID |
|---|---|
| education | `com.linkedin.sdui.pagers.profile.details.education` |
| projects | `com.linkedin.sdui.pagers.profile.details.projects` |
| certifications | `com.linkedin.sdui.pagers.profile.details.certifications` |
| skills | `com.linkedin.sdui.pagers.profile.details.skills` |

### RSC response decoding

All SDUI responses are `application/octet-stream`. Node's `fetch` transparently decompresses `gzip`/`br`/`zstd` content-encoding, so the raw bytes are decoded directly as UTF-8 text. The RSC stream is a line-delimited format; each parser extracts data using targeted regex patterns against the rendered text nodes.

---

## Authentication / Session Context

The API requires a **valid, authenticated LinkedIn browser session** captured from your own account. No credentials are hardcoded in the repository.

### Cookie and CSRF token

LinkedIn's internal API requires two session credentials:

- **`LINKEDIN_COOKIE`**: The full `Cookie` header string copied from an authenticated LinkedIn browser request. Must include `li_at` (session token) and `JSESSIONID` cookies.
- **`LINKEDIN_CSRF_TOKEN`**: The `csrf-token` request header value. If left blank, the app derives it automatically from `JSESSIONID` using the pattern `ajax:<JSESSIONID_value>`.

These values are **read only from environment variables** and are never logged, committed, or transmitted to any third party. The client redacts them in debug log output (showing only the first 20–30 characters followed by `[REDACTED]`).

### How to capture credentials

1. Log in to LinkedIn in your browser.
2. Open Developer Tools → Network tab.
3. Navigate to any profile page.
4. Find any XHR/Fetch request to `www.linkedin.com`.
5. Copy the value of the `Cookie` request header → set as `LINKEDIN_COOKIE`.
6. Copy the value of the `csrf-token` request header → set as `LINKEDIN_CSRF_TOKEN` (or leave blank to derive automatically).

> **Important**: Cookies expire. If the API starts returning 401/403 errors, refresh your cookie.

---

## Setup and Installation

**Prerequisites**

- Node.js ≥ 20 (uses native `fetch` and `--env-file` flag)
- pnpm (or npm / yarn)

```bash
# 1. Clone the repository
git clone <repo-url>
cd linkedin-profile

# 2. Install dependencies
pnpm install          # or: npm install

# 3. Copy the example env file and fill in your credentials
cp .env.example .env
```

Edit `.env` and set at minimum:

```
LINKEDIN_COOKIE=<your full Cookie header value>
```

---

## Environment Variables

All variables are validated at startup using Zod. The app fails fast with a clear error message if required values are missing or of the wrong type.

```env
# .env.example

NODE_ENV=development
HOST=0.0.0.0
PORT=3000

# Required: authenticated LinkedIn browser session cookie
LINKEDIN_COOKIE=
# Optional: explicit CSRF token (derived from JSESSIONID if blank)
LINKEDIN_CSRF_TOKEN=

# Browser fingerprint — change only if LinkedIn rejects requests
LINKEDIN_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
LINKEDIN_APP_VERSION=0.2.7003

# Page-session context (refreshed automatically from GET response headers;
# setting these is optional but can improve reliability)
LINKEDIN_APPLICATION_INSTANCE=
LINKEDIN_PAGE_INSTANCE=
LINKEDIN_PAGE_INSTANCE_TRACKING_ID=
LINKEDIN_PAGE_FOREST_ID=

# Browser / display telemetry sent in x-li-track header
LINKEDIN_ANCHOR_PAGE_KEY=d_flagship3_profile_view_base
LINKEDIN_TIMEZONE=Asia/Calcutta
LINKEDIN_TIMEZONE_OFFSET=5.5
LINKEDIN_DEVICE_FORM_FACTOR=DESKTOP
LINKEDIN_DISPLAY_DENSITY=1.25
LINKEDIN_DISPLAY_WIDTH=1920
LINKEDIN_DISPLAY_HEIGHT=1080

# Timeout and rate limiting
REQUEST_TIMEOUT_MS=20000
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW_MS=60000
```

| Variable | Default | Required | Description |
|---|---|---|---|
| `NODE_ENV` | `development` | No | Runtime environment |
| `HOST` | `0.0.0.0` | No | Bind address |
| `PORT` | `3000` | No | Listen port |
| `LINKEDIN_COOKIE` | _(empty)_ | **Yes** | Full `Cookie` header from authenticated session |
| `LINKEDIN_CSRF_TOKEN` | _(empty)_ | No | CSRF token; auto-derived from `JSESSIONID` if blank |
| `LINKEDIN_USER_AGENT` | Chrome 151 UA | No | `User-Agent` sent in all LinkedIn requests |
| `LINKEDIN_APP_VERSION` | `0.2.7003` | No | Sent as `x-li-application-version` |
| `LINKEDIN_APPLICATION_INSTANCE` | _(empty)_ | No | Overridden by fresh value from GET response |
| `LINKEDIN_PAGE_INSTANCE` | _(empty)_ | No | Overridden by fresh value from GET response |
| `LINKEDIN_PAGE_INSTANCE_TRACKING_ID` | _(empty)_ | No | Overridden by fresh value from GET response |
| `LINKEDIN_PAGE_FOREST_ID` | _(empty)_ | No | Used as W3C traceparent traceId if set |
| `LINKEDIN_ANCHOR_PAGE_KEY` | `d_flagship3_profile_view_base` | No | Sent as `x-li-anchor-page-key` |
| `LINKEDIN_TIMEZONE` | `Asia/Calcutta` | No | Sent in `x-li-track` telemetry header |
| `LINKEDIN_TIMEZONE_OFFSET` | `5.5` | No | Sent in `x-li-track` telemetry header |
| `LINKEDIN_DEVICE_FORM_FACTOR` | `DESKTOP` | No | Sent in `x-li-track` telemetry header |
| `LINKEDIN_DISPLAY_DENSITY` | `1.25` | No | Sent in `x-li-track` telemetry header |
| `LINKEDIN_DISPLAY_WIDTH` | `1920` | No | Sent in `x-li-track` telemetry header |
| `LINKEDIN_DISPLAY_HEIGHT` | `1080` | No | Sent in `x-li-track` telemetry header |
| `REQUEST_TIMEOUT_MS` | `20000` | No | Per-request timeout in milliseconds |
| `RATE_LIMIT_MAX` | `30` | No | Max requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | No | Rate-limit window in milliseconds |

---

## Running Locally

```bash
# Development (with hot reload via tsx --watch)
pnpm dev          # or: npm run dev

# Production build
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js

# Type-check only (no emit)
pnpm typecheck
```

The dev server reads `.env` automatically via Node's `--env-file=.env` flag (Node ≥ 20 required).

By default the API listens on `http://0.0.0.0:3000`.

---

## API Endpoint Reference

### `GET /health`

Health check. No authentication required.

**Response `200`**
```json
{ "status": "ok" }
```

---

### `POST /v1/profile`

Fetch and return structured data for a LinkedIn profile.

**Request**

```http
POST /v1/profile
Content-Type: application/json

{
  "url": "https://www.linkedin.com/in/guljar-hussain-7953a9243/"
}
```

The body must be a strict `{ url: string }` object. Any extra keys are rejected.

**Response `200` — success**

```json
{
  "url": "https://www.linkedin.com/in/guljar-hussain-7953a9243/",
  "publicIdentifier": "guljar-hussain-7953a9243",
  "profileId": "ACoAADyXxxxxxxxxxxxxxxxxxxxxxx",
  "name": {
    "first": "Guljar",
    "last": "Hussain",
    "full": "Guljar Hussain"
  },
  "headline": "Software Engineer",
  "location": {
    "raw": "Bengaluru, Karnataka, India",
    "city": null,
    "region": null,
    "country": null
  },
  "about": "Passionate about building scalable systems...",
  "profileImage": {
    "url": "https://media.licdn.com/dms/image/.../profile-displayphoto-shrink_200_200/..."
  },
  "experience": [
    {
      "title": "Software Engineer",
      "subtitle": "Acme Corp",
      "dateRange": "Jan 2023 - Present",
      "locationOrExtra": "Bengaluru, India"
    }
  ],
  "education": [
    {
      "title": "B.Tech Computer Science",
      "subtitle": "Example University",
      "dateRange": "2019 - 2023"
    }
  ],
  "projects": [],
  "skills": [
    { "name": "TypeScript" },
    { "name": "Node.js" }
  ],
  "certifications": [],
  "languages": []
}
```

**Error responses**

| Status | `error.code` | Meaning |
|---|---|---|
| `400` | `INVALID_REQUEST` | Body is not `{ url: string }` |
| `400` | `INVALID_LINKEDIN_URL` | URL is not a valid `https://www.linkedin.com/in/<id>/` profile URL |
| `429` | `RATE_LIMITED` | Client has exceeded the local rate limit |
| `429` | `LINKEDIN_RATE_LIMITED` | LinkedIn returned HTTP 429 |
| `502` | `LINKEDIN_REQUEST_FAILED` | LinkedIn returned 4xx/5xx (including 401/403 auth failure) |
| `502` | `PROFILE_FETCH_FAILED` | Unexpected error during profile fetch |

```json
{
  "error": {
    "code": "INVALID_LINKEDIN_URL",
    "message": "URL must have the form https://www.linkedin.com/in/<public-identifier>/"
  }
}
```

---

## Project Structure

```
linkedin-profile/
├── src/
│   ├── server.ts                  # Entry point — binds Fastify to HOST:PORT
│   ├── app.ts                     # Builds the Fastify app (routes, middleware, DI)
│   ├── config/
│   │   └── env.ts                 # Zod-validated environment configuration
│   ├── middleware/
│   │   └── rate-limit.ts          # Fixed-window in-memory rate limiter
│   ├── routes/
│   │   ├── health.ts              # GET /health
│   │   └── profile.ts             # POST /v1/profile — validates, delegates to service
│   ├── schemas/
│   │   └── profile.ts             # Zod schemas for request and response types
│   └── linkedin/
│       ├── client.ts              # LinkedInClient — all raw HTTP calls to LinkedIn
│       ├── service.ts             # LinkedInProfileService — orchestrates the 4-step flow
│       ├── components.ts          # SDUI component IDs and detail-section definitions
│       ├── headers.ts             # Header builder; CSRF derivation; traceparent generation
│       ├── url.ts                 # URL validation and publicIdentifier extraction
│       ├── parsers/
│       │   ├── rsc.ts             # RSC response decoder and utility helpers
│       │   ├── profile.ts         # Top-card parser (name, headline, image, about)
│       │   ├── experience.ts      # Experience RSC parser
│       │   ├── education.ts       # Education RSC parser
│       │   ├── projects.ts        # Projects RSC parser
│       │   ├── certifications.ts  # Certifications RSC parser
│       │   ├── skills.ts          # Skills RSC parser
│       │   ├── languages.ts       # Languages parser (stub — returns [])
│       │   └── utils.ts           # Shared structured-item builder (title/subtitle/date)
│       └── normalizers/
│           └── profile.ts         # Converts ParsedBaseProfile → ProfileResponse shape
├── tests/
│   ├── unit/
│   │   ├── url.test.ts            # extractPublicIdentifier unit tests
│   │   ├── headers.test.ts        # buildLinkedInHeaders unit tests
│   │   └── normalizers/           # (directory)
│   └── integration/
│       └── profile.test.ts        # POST /v1/profile integration test (no network)
├── scripts/                       # HAR inspection and debug scripts (dev only)
├── .env.example                   # Template for required environment variables
├── .gitignore                     # Excludes .env, *.har, dist/, debug/
├── package.json
├── tsconfig.json
└── README.md
```

---

## Testing

The test suite uses **Vitest**.

```bash
# Run all tests once
pnpm test           # or: npm test

# Watch mode
pnpm test:watch
```

### Unit tests

| File | What is tested |
|---|---|
| `tests/unit/url.test.ts` | `extractPublicIdentifier` accepts valid LinkedIn `/in/` URLs and rejects company/other routes |
| `tests/unit/headers.test.ts` | `buildLinkedInHeaders` correctly derives the `csrf-token` from `JSESSIONID`, sets `cookie`, and includes `x-li-rsc-stream: true` |

### Integration tests

| File | What is tested |
|---|---|
| `tests/integration/profile.test.ts` | `POST /v1/profile` with an invalid body returns `400` without making any network request to LinkedIn |

The integration test uses Fastify's `app.inject()` — no HTTP server is started and no network calls are made.

> **Note**: Live end-to-end tests (actually contacting LinkedIn) require valid credentials in `.env` and are not part of the automated suite, because LinkedIn credentials cannot be committed to the repository.

---

## Deployment / HTTPS

The Fastify server listens on plain HTTP. For production use, terminate TLS in front of the app (e.g. via a reverse proxy such as nginx, Caddy, or a cloud load balancer).

**Docker** support is included. A `Dockerfile` / `.dockerignore` is expected in the project root for container-based deployment. HAR captures and `.env` files are excluded from the image via `.gitignore`.

Example production flow:

```bash
pnpm build
NODE_ENV=production node dist/server.js
```

Or with Docker:

```bash
docker build -t linkedin-profile-api .
docker run -p 3000:3000 --env-file .env linkedin-profile-api
```

---

## Known Limitations

The following situations will cause partial or failed responses:

| Limitation | Detail |
|---|---|
| **Internal API changes** | All LinkedIn endpoints (`/flagship-web/rsc-action/...`) are undocumented. Component IDs, request body shapes, or RSC stream formats can change with any LinkedIn deployment. |
| **Session expiry** | `LINKEDIN_COOKIE` must be periodically refreshed. A 401/403 from LinkedIn results in a `502` from this API. |
| **RSC text-stream parsing** | Parsers use regex over rendered text nodes rather than structured entity extraction. Output quality depends on the stability of LinkedIn's RSC render tree. Fields that appear in the RSC stream under different component structures across different profile types may be missed. |
| **`languages` field** | The languages parser is a stub and always returns an empty array. |
| **`location` sub-fields** | `city`, `region`, and `country` are always `null`; only `raw` is populated (from the SSR HTML). |
| **Private profiles** | If the authenticated account cannot view a profile, LinkedIn returns an empty or restricted page. The API will return nulls for most fields. |
| **Rate limiting** | LinkedIn's own rate limiting (HTTP 429) is proxied as `429 LINKEDIN_RATE_LIMITED`. Spreading requests over time is recommended. |
| **Profile photo for private profiles** | The `og:image` fallback may return a generic silhouette URL rather than the actual photo. |

---

## Security Considerations

- **Credentials are environment-only.** `LINKEDIN_COOKIE` and `LINKEDIN_CSRF_TOKEN` are read exclusively from environment variables (`.env` file or OS environment). They are never logged in full, never committed (`.gitignore` excludes `.env` and `.env.*`), and never returned in any API response.
- **Debug log redaction.** Internal HTTP debug logging redacts the `cookie` header to its first 30 characters and `csrf-token` to its first 12 characters, followed by `[REDACTED]`.
- **No credential storage.** The server does not persist session credentials to disk. Each process reads them once from the environment at startup.
- **HAR captures excluded.** `*.har` files (which can contain raw credentials in request headers) are excluded from version control via `.gitignore`.
- **Input validation.** All incoming request bodies are validated with Zod before any processing occurs. Extra keys are rejected (`strict()` mode).
- **Rate limiting.** A fixed-window in-memory rate limiter (default: 30 req / 60 s per IP) prevents accidental abuse of the LinkedIn session from this API.

---

## Disclaimer

LinkedIn's internal endpoints are undocumented and subject to change without notice. Use of this API must comply with LinkedIn's Terms of Service, applicable law, and privacy regulations. The session credentials used must belong to an account you control. This project is submitted as a technical exercise and is not intended for production scraping at scale.
