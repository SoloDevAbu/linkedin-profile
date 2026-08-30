# LinkedIn Profile API

A reverse-engineered REST API that accepts a LinkedIn profile URL and returns structured profile information as JSON.

Built as part of the **Tross Software Engineer Challenge**.

The API analyzes LinkedIn's internal web APIs and React Server Component (RSC) responses, extracts profile data, and normalizes it into a predictable JSON structure.

---

## Features

The API currently extracts:

- **Basic information** — name, headline, location, about
- **Profile image**
- **Experience** — companies, titles, dates, descriptions
- **Education** — institutions, degrees, dates, descriptions
- **Projects** — names, dates, associations, descriptions
- **Certifications**
- **Languages** — including proficiency
- **Skills**

The response is normalized into a consistent JSON structure rather than exposing LinkedIn's internal response format.

---

## API

### `POST /v1/profile`

Fetch profile information from a LinkedIn profile URL.

### Request

```json
{
  "url": "https://www.linkedin.com/in/<vanityname>/"
}
```

### Local

The API runs locally on:

```text
http://localhost:3000
```

Example:

```bash
curl -X POST http://localhost:3000/v1/profile \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.linkedin.com/in/<vanityname>/"}'
```

### Production

Replace `<PRODUCTION_API_URL>` with the deployed API URL:

```bash
curl -X POST <PRODUCTION_API_URL>/v1/profile \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.linkedin.com/in/<vanityname>/"}'
```

---

## Example Response

```json
{
  "url": "https://www.linkedin.com/in/example-name/",
  "publicIdentifier": "example-name",
  "profileId": "ACoAADxx_xxEBx_x",
  "name": {
    "first": "Example",
    "last": "Name",
    "full": "Example Name"
  },
  "headline": "Software Engineer",
  "location": {
    "raw": "India",
    "city": null,
    "region": null,
    "country": null
  },
  "about": "Full stack developer...",
  "profileImage": {
    "url": "https://media.licdn.com/..."
  },
  "experience": [],
  "education": [],
  "projects": [],
  "certifications": [],
  "languages": [],
  "skills": ["TypeScript", "Node.js", "React.js"]
}
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm

### Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd linkedin-profile
pnpm install
```

Create your environment file:

```bash
cp .env.example .env
```

Configure the required environment variables:

```env
NODE_ENV=development
PORT=3000

LINKEDIN_COOKIE="your_authenticated_linkedin_cookie"
LINKEDIN_CSRF_TOKEN="ajax:..."
```

### Authentication

LinkedIn's internal APIs require an authenticated session.

The API uses credentials from an authenticated LinkedIn browser session:

- `LINKEDIN_COOKIE` — the authenticated browser cookie header
- `LINKEDIN_CSRF_TOKEN` — the CSRF token associated with the session

These values are loaded exclusively from environment variables and are never committed to the repository.

---

## Running Locally

### Development

```bash
pnpm dev
```

The API will be available at:

```text
http://localhost:3000
```

### Production Build

```bash
pnpm build
pnpm start
```

---

## Architecture

The application is built with:

- **Node.js**
- **Fastify**
- **TypeScript**
- **Zod**

The request flow is:

```text
Client
  │
  │ POST /v1/profile
  ▼
Fastify API
  │
  ▼
URL Resolver
  │
  ▼
LinkedIn Profile Fetch
  │
  ├── Base profile
  │
  └── Profile sections
       ├── Experience
       ├── Education
       ├── Projects
       ├── Certifications
       ├── Languages
       └── Skills
  │
  ▼
RSC Parser
  │
  ▼
Data Normalizers
  │
  ▼
Zod Validation
  │
  ▼
Structured JSON Response
```

### Parallel Fetching

After obtaining the internal profile ID, independent profile sections are fetched concurrently rather than sequentially.

This reduces the overall request latency when retrieving a complete profile.

---

## Reverse-Engineering Approach

LinkedIn does not expose a public API intended for this use case, so the implementation relies on analyzing the requests made by the LinkedIn web application.

### 1. Internal Web APIs

The LinkedIn web application communicates with internal endpoints, including its Voyager/GraphQL infrastructure and endpoints used by its profile pages.

The implementation identifies the requests responsible for retrieving profile data and reproduces the required request context.

### 2. React Server Components

A major challenge is that some responses are not conventional JSON.

LinkedIn uses React Server Components (RSC), which return serialized component trees and references rather than a simple JSON object.

The API implements a custom RSC parser that:

1. Parses the streamed response.
2. Resolves referenced values.
3. Reconstructs the component tree.
4. Traverses the resulting structure.
5. Extracts the required profile information.

This is particularly important for content such as projects and descriptions where values may appear separately from the component that references them.

### 3. Pagination Endpoints

Profile sections such as experience, education, projects, and skills are loaded through dedicated internal pagination endpoints.

The implementation currently handles the relevant first-page responses and normalizes them into the public API schema.

---

## Data Normalization

LinkedIn's internal response format is optimized for its own frontend and is not suitable as a stable API response.

The application therefore separates:

```text
LinkedIn Response
       ↓
RSC / Internal API Parser
       ↓
Raw Extracted Data
       ↓
Normalizer
       ↓
Zod Schema Validation
       ↓
Public API Response
```

This keeps LinkedIn-specific parsing logic isolated from the API contract exposed to consumers.

---

## Project Structure

```text
linkedin-profile/
├── src/
│   ├── server.ts
│   │
│   ├── routes/
│   │   └── profile.ts
│   │
│   ├── schemas/
│   │   └── profile.ts
│   │
│   └── linkedin/
│       ├── client.ts
│       ├── service.ts
│       │
│       ├── normalizers/
│       │
│       └── parsers/
│           ├── rsc.ts
│           ├── utils.ts
│           ├── profile.ts
│           ├── projects.ts
│           ├── education.ts
│           ├── experience.ts
│           ├── languages.ts
│           ├── certifications.ts
│           └── skills.ts
│
├── .env.example
├── package.json
└── README.md
```

---

## Design Decisions

### Why parse RSC instead of scraping HTML?

The LinkedIn web application does not expose all profile information as straightforward HTML.

The browser receives structured data through internal APIs and RSC streams, making those responses more useful for extracting the same information rendered by the application.

### Why normalize the response?

LinkedIn's internal response format is implementation-specific and can contain deeply nested structures, references, and frontend-specific metadata.

Returning a clean schema makes the API easier to consume and isolates consumers from those internal details.

### Why fetch profile sections in parallel?

Experience, education, projects, skills, languages, and certifications are independent requests once the profile ID is known.

Fetching them concurrently reduces total response time.

---

## Known Limitations

This project depends on undocumented LinkedIn internals, so the implementation is inherently fragile.

### 1. Internal API Changes

LinkedIn can change its internal endpoints, request parameters, or response structures at any time.

### 2. RSC Format Changes

The RSC parser depends on the current serialization format and reference structure. Changes to LinkedIn's RSC implementation may require parser updates.

### 3. Session Expiration

The API depends on a valid authenticated session. Expired or invalid credentials can result in authentication failures.

### 4. Rate Limiting / Security Controls

Automated requests may trigger LinkedIn's security mechanisms, rate limits, authentication challenges, or session invalidation.

### 5. Pagination

The current implementation retrieves the first page of supported paginated profile sections. Profiles with more data than the first page may therefore return incomplete results.

### 6. Location Normalization

LinkedIn may provide a pre-formatted location string rather than separate city, region, and country fields. The API preserves the original value where the individual components cannot be reliably determined.

---

## Security

Credentials are intentionally kept outside the source code.

**Never commit:**

- LinkedIn session cookies
- CSRF tokens
- `.env` files
- Any other authentication credentials

Use `.env.example` as the configuration template and provide actual credentials through environment variables.

For production deployments:

- Use HTTPS.
- Store secrets using the hosting provider's secret/environment-variable system.
- Do not log authentication cookies or tokens.
- Consider adding API-level authentication and rate limiting before exposing the service publicly.

---

## Deployment

The application is a standard Node.js/Fastify service and can be deployed to any platform that supports Node.js applications.

The production deployment must:

1. Run Node.js 20+.
2. Provide the required environment variables.
3. Expose the API over HTTPS.
4. Keep LinkedIn credentials securely managed by the deployment platform.

---

## Challenge Context

This project was implemented as a take-home engineering challenge with the following objective:

> Reverse engineer LinkedIn APIs and build a hosted API that accepts a LinkedIn profile URL and returns available profile information as structured JSON.

The implementation focuses on:

- Reverse engineering undocumented APIs
- Parsing RSC streams
- Concurrent data fetching
- Data normalization
- Runtime validation
- API design
- Production considerations
- Handling known limitations and failure modes
