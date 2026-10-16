# CircleChat

A responsive, real-time messenger built with React, TypeScript, Express, Socket.IO, PostgreSQL, Neon Auth, private S3-compatible media storage, and WebRTC audio.

[Open the live app](https://circlechat-alexprixman.onrender.com)

## What works

- Email/password accounts, session restoration, email verification and password recovery screens.
- Direct conversations and named groups of up to nine people.
- Live messages, typing indicators, online status, unread counts and read receipts.
- Persistent message history with cursor pagination; idempotent sending prevents duplicate retries.
- Photo sharing (JPEG, PNG, WebP, up to 5 MB). Images are decoded, stripped of metadata, resized and re-encoded. Only conversation members can download attached photos.
- Voice notes (up to 60 seconds and 5 MB) recorded in the browser, stored privately, and playable only by members who can see the attached message. Supported browser formats: WebM, Ogg, MP4 audio.
- Direct and group voice calls with microphone mute, join/decline/leave controls, and authenticated Socket.IO signaling. Audio is peer-to-peer through WebRTC.
- Delete a chat for yourself: it disappears from your list, and you cannot view or download its earlier messages or media. Other members retain their history. A new message brings the chat back with only the new history visible to you.
- Editable profiles, case-insensitive unique handles, people search, blocking, own-message removal and message reporting. Moderator report review is available through the API.
- Desktop and mobile layouts, keyboard controls and focus-contained dialogs.

This is a portfolio demo, not a replacement for a production messaging platform. Chats are access-controlled, **not end-to-end encrypted**. Do not share sensitive information. Group membership is fixed when a group is created. Blocking pauses sending and ends active calls in shared conversations but does not erase existing history. Removing a message hides its attached media from the application; it does not physically purge the storage object. Deleting a chat for yourself leaves the stored messages and media available to other members. No video calls, push notifications or account deletion workflow are included.

## Development

Use Node 24 and PostgreSQL 18. Run `npm ci`, copy `.env.example` to `.env`, and configure your own Neon authentication and private bucket credentials. Register your application origin in Neon Auth's trusted domains. The app proxies supported authentication routes through `/api/auth`, so browser sessions use first-party cookies. Then run `npm run dev` and open http://localhost:5173.

The server applies the version-controlled, additive schema in `server/schema.js` at startup. Never point test tools at the live database. Back up your database before future schema changes.

## Tests

```sh
npm ci
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/circlechat_test
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Tests create uniquely named temporary schemas and remove only those schemas on completion. GitHub Actions runs the suite against PostgreSQL 18, builds the frontend, exercises desktop/mobile browser flows, audits production dependencies and builds the Docker image. The browser suite uses an isolated test identity provider, in-memory media adapter and fake microphones; it does not send emails or create real accounts. Real managed authentication and storage must also be verified after deployment.

When PostgreSQL cannot run locally, `USE_PGLITE=1 npm test` and `USE_PGLITE=1 npm run test:e2e` use an embedded PostgreSQL engine. This is supplementary verification; CI still requires the real PostgreSQL service. The test-only auth server is a separate entry point and refuses production mode.

## Deployment

Deploy the `master` branch as a **free Node web service** on Render. Build: `npm ci --include=dev && npm run build`. Start: `npm start`. Set `NODE_ENV=production`, `NODE_VERSION=24`, and the variables in `.env.example`. Set `PUBLIC_APP_URL` to the actual HTTPS service origin, with no trailing slash. Use Neon for PostgreSQL and the private `chat-photos` bucket so records and images survive Render restarts. Set the health-check path to `/api/health`.

Database and storage secrets stay server-side. Restrict storage credentials to read/write storage scopes. Never commit `.env` files. Production startup rejects missing database, auth, HTTPS or storage configuration. The browser uses the same-origin auth proxy; no build-time credentials are needed.

Signing out invalidates all previously issued access tokens for that account and disconnects their sockets. Other signed-in browsers may need to reload to obtain a fresh token. The revocation cutoff is stored in PostgreSQL and survives server restarts. A new sign-in remains available after logout.

Use one application instance: Socket.IO presence, delivery and call signaling currently run in memory. Multiple instances require a shared Socket.IO adapter and coordinated call state. PostgreSQL transactions serialize critical message/media operations. Combined photo and voice storage limits are 25 MB per user/day and 200 MB total; failed/abandoned uploads require operator cleanup. The conversation list currently shows the 50 most recently active conversations.

Calls require microphone permission and HTTPS (localhost works during development). A STUN server is configured by default. For reliable calls between restrictive networks, configure your own TURN relay with `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL`. Without TURN, some networks will not establish a call. Group audio uses a peer connection per participant and is intended for small groups (up to nine members). Calls are ephemeral and end when the server restarts; no audio is recorded or stored.

Free hosting can sleep when idle. Email delivery uses the provider's configured SMTP; a commercial rollout needs its production email setup, monitoring, backups, abuse controls and a retention policy.

## API overview

Authenticated routes require a signed Neon JWT in `Authorization: Bearer ...`. Socket.IO uses `auth.token`. Both transports enforce membership on the server.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / PATCH | `/api/me` | Read/edit profile |
| GET | `/api/people?q=` | Find unblocked people |
| GET / POST | `/api/conversations` | List/create direct or group chats |
| DELETE | `/api/conversations/:id` | Clear your own earlier chat history and hide chat until a new message |
| GET / POST | `/api/conversations/:id/messages` | Paginated history / send |
| POST | `/api/conversations/:id/photos` | Upload multipart `photo` |
| GET | `/api/photos/:id` | Membership-checked image download |
| POST | `/api/conversations/:id/voice` | Upload multipart `voice` and `durationMs` |
| GET | `/api/voice/:id` | Visible-message-checked voice download |
| GET | `/api/conversations/:id/call` | Current active call state |
| GET | `/api/call-config` | ICE server configuration for authenticated clients |
| POST | `/api/conversations/:id/read` | Advance read position |
| GET | `/api/conversations/:id/receipts` | Member read positions |
| GET | `/api/conversations/:id/presence` | Online members |
| DELETE | `/api/messages/:id` | Remove your own message |
| GET | `/api/blocks` | Blocked people |
| PUT / DELETE | `/api/blocks/:id` | Block/unblock |
| POST | `/api/reports` | Report a conversation message |
| GET / PATCH | `/api/reports`, `/api/reports/:id` | Moderator review |
| POST | `/api/logout` | Revoke previously issued account JWTs and disconnect their sockets |

Socket events: `message:send` (acknowledged, idempotent), `message:new`, `message:updated`, `message:read`, `typing`, `presence:changed`, `conversations:changed`, `profile:updated`, `auth:expired`. Authenticated call actions are `call:start`, `call:join`, `call:signal`, `call:decline`, `call:leave`; notifications include `call:invite`, `call:changed`, `call:participant-left`, `call:ended`. Reconnecting clients refetch persisted message history; sockets are not the source of truth for messages.
