# Splint stage A — integration contract

This repository implements a new test application. It contains no legacy user data. Real payments, Creator, user publication and the editor remain disabled.

## Layout

- `apps/api`: Fastify 5 / TypeScript API, PostgreSQL persistence and Telegram integration.
- `apps/miniapp`: React / Vite / TypeScript frontend, compiled into `apps/miniapp/dist` and served by API.
- `packages/shared`: dependency-free shared types and original deterministic pixel artworks.
- `infra`: Docker and deployment material.

Use npm workspaces. Each workspace builds with its own tsconfig. All source is ESM. Shared package name `@splint/shared` exports types and the demo catalog. Root owns package manifests and shared files. Agents must coordinate dependencies before installing.

## HTTP contract

Base URL `/api/v1`. JSON errors: `{error:{code:string,message:string}}`. A request ID can also be returned. Authentication uses a server session. Frontend requests send `credentials: include` and `X-CSRF-Token` from the session response for mutations. Response may include a short-lived `accessToken` for Telegram Web cookie fallback, which the client keeps in memory and sends as Bearer. Never store credentials in localStorage.

- `POST /auth/telegram {initData, bootstrapRequestId}` -> SessionResponse.
- `POST /auth/dev {}` -> SessionResponse, ONLY if explicit development auth is enabled AND environment is not production; fixed server-chosen demo user.
- `GET /me` -> SessionResponse for an existing session.
- `POST /auth/logout` -> `{ok:true}`.
- `POST /me/consent {version:"test-v1"}` -> SessionResponse.
- `GET /catalog?q=&size=&sort=curated|new` -> `{items: ArtworkSummary[]}`.
- `GET /works/:id` -> `{work:ArtworkSummary}`.
- `POST /works/:id/start {}` -> `{run:RunState,grid:PixelGrid}`; grants free access and returns current run; completed run is returned unchanged until explicit restart.
- `GET /runs/:id` -> `{run:RunState,grid:PixelGrid}`; only owner, active rights/content checked.
- `PATCH /runs/:id/progress {mutationId,cells:Array<{index:number,color:number}>}` -> `{run:RunState}`. The server validates target colors, unions accepted cells and confirms completion.
- `POST /runs/:id/restart {}` -> `{run:RunState,grid:PixelGrid}`; creates fresh run under same subject lock. Explicit client confirmation required.
- `GET /me/library` -> `{available: ArtworkSummary[],inProgress: LibraryItem[],collection:LibraryItem[]}`. One collection entry per work version.
- `POST /runs/:id/share {}` -> `{url:string,preparedMessageId?:string}`; only server-confirmed completed results; no automatic sending.
- `GET /runs/:id/export` -> PNG with attribution, only completed result owner and permitted content.
- `POST /support {kind:"help"|"content_report"|"deletion",message:string,workId?:string}` -> `{id:string,status:"open"}`.
- `PATCH /me/preferences {notifications:boolean,shareName:boolean}` -> SessionResponse.
- `GET /health/live` and `/health/ready` outside API prefix for Render.
- Telegram webhook `/integrations/telegram/test/updates`, authenticated by webhook secret. Durable inbox, no automatic webhook switch on boot.

Stage A catalog is original Splint seed art. Immutable canonical grids are stored in private R2 for deployed configuration; explicit local storage mode is allowed for local development. Preview endpoint `/api/v1/media/:workId/preview.png` may expose only approved, unrestricted catalog previews. No user photos in stage A. In local demo, `BOT_USERNAME` may be absent; return no fabricated Telegram share destination and enable image export.

## Types (root creates `@splint/shared`)

`PixelGrid`: `{width:number,height:number,palette:string[],cells:number[],mask:boolean[]}`; palette colors are hex. Index is `y*width+x`. Color index is zero-based; displayed number is index+1. Mask false cells are excluded.

`ArtworkSummary`: `{id:string,versionId:string,title:string,description:string,author:string,width:number,height:number,colorCount:number,previewUrl:string,category:string,status:"available"|"in_progress"|"completed",progress:number,runId?:string,featured:boolean,publishedAt:string}`. All stage A work is free. `progress` is percentage 0..100; only server-complete gets 100 (otherwise cap 99.9).

`RunState`: `{id:string,workId:string,versionId:string,status:"active"|"completed"|"interrupted",filled:number[],total:number,progress:number,revision:number,completedAt:string|null}`. `filled` contains confirmed indices. Frontend's unconfirmed cells remain separate until response.

`LibraryItem`: `{work:ArtworkSummary,run:RunState}`.

`SessionResponse`: `{user:{id:string,displayName:string,username:string|null,avatarUrl:string|null,notifications:boolean,shareName:boolean},csrfToken:string,accessToken?:string,consentRequired:boolean,mode:"telegram"|"demo"}`.

## Configuration

Canonical env names `DATABASE_URL`, `BOT_TOKEN`; compatibility aliases `postgres`, `bot_token` for existing Render settings, with no secret logging. `APP_ORIGIN`, `BOT_USERNAME`, `WEBHOOK_SECRET`, `SESSION_ENCRYPTION_KEY`. Cloud storage `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Credentials are never committed. Local demo requires explicit `ALLOW_DEV_AUTH=true`; production must reject it. No automatic seeding/overwriting on service boot; explicit migrate and seed commands.

The real Render database is PostgreSQL 18. Target migrations must work on supported PostgreSQL 17 and 18. Empty repository is linked to a test Render service; do not assume Running means application functionality exists.

## Tests

Backend: HMAC tamper/expiry, owner checks, free access without collection, wrong color, partial progress <100, union saves, idempotent completion, restart races, old-run saves, session replay, dev auth disabled in production. Database tests must use PostgreSQL semantics, not a mocked repository.

Frontend: responsive real browser smoke, palette/canvas coloring, completion and library navigation, persistence after reload, isolated local pending storage by user/run and clear save states. Test using local demo mode only. Production cannot grant identity through a query parameter.

Admin capability is restricted to explicit staff authorization. Test stage A may use documented CLI management of curated catalog and support review; a public launch still requires OIDC/MFA, real approved terms, backups and an operations owner.
