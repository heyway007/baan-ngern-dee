# Worker Static Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Baan Ngern Dee React SPA and finance API from the same Cloudflare Worker URL.

**Architecture:** Cloudflare Static Assets serves the Vite output from `apps/web/dist`. Requests to `/health` and `/v1/*` run the Worker API first, while all other navigation routes use SPA fallback to `index.html`.

**Tech Stack:** Cloudflare Workers, Wrangler 4.114, Vite 7, React 19, Vitest 3.

## Global Constraints

- Keep the existing Worker name `baan-ngern-dee`.
- Keep API routes `/health` and `/v1/*` handled by `workers/api/src/index.ts`.
- Serve React Router routes such as `/overview` and `/installments` through SPA fallback.
- Do not expose or commit local `.dev.vars` values.
- Use the existing root build command so Cloudflare Builds produces `apps/web/dist` before deploy.

---

### Task 1: Add Worker asset routing with an integration test

**Files:**
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: Vite output directory `apps/web/dist`.
- Produces: Wrangler `assets` configuration with `directory`, `not_found_handling`, and `run_worker_first`.

- [ ] **Step 1: Build the current application and start Wrangler on port 8788**

```powershell
npm run build
npx wrangler dev -c wrangler.jsonc --ip=127.0.0.1 --port=8788
```

Expected: Wrangler reports `Ready on http://127.0.0.1:8788`.

- [ ] **Step 2: Verify RED through the observable HTTP behavior**

Run:

```powershell
curl.exe -i http://127.0.0.1:8788/
```

Expected: `404 Not Found`, proving that the current Worker does not serve the built SPA.

- [ ] **Step 3: Add the minimal Wrangler asset configuration**

Add this top-level block to `wrangler.jsonc`:

```json
"assets": {
  "directory": "./apps/web/dist",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/health", "/v1/*"]
}
```

- [ ] **Step 4: Run the configuration test and verify GREEN**

Restart Wrangler and run:

```powershell
curl.exe -i http://127.0.0.1:8788/
```

Expected: `200 OK`, `Content-Type: text/html`, and the Baan Ngern Dee application shell.

### Task 2: Verify the combined local Worker

**Files:**
- Verify: `apps/web/dist/index.html`
- Verify: `wrangler.jsonc`

**Interfaces:**
- Consumes: output from `npm run build`.
- Produces: one local server that serves both SPA and API routes.

- [ ] **Step 1: Build all workspaces**

Run:

```powershell
npm run build
```

Expected: Vite creates `apps/web/dist/index.html` and Wrangler dry-run succeeds.

- [ ] **Step 2: Start the combined Worker on port 8788**

Run:

```powershell
npx wrangler dev -c wrangler.jsonc --ip=127.0.0.1 --port=8788
```

Expected: Wrangler reports `Ready on http://127.0.0.1:8788`.

- [ ] **Step 3: Verify the SPA and API routes**

Run:

```powershell
curl.exe -I http://127.0.0.1:8788/
curl.exe -I http://127.0.0.1:8788/overview
curl.exe -I http://127.0.0.1:8788/installments
curl.exe -i http://127.0.0.1:8788/health
curl.exe -i http://127.0.0.1:8788/v1/workspaces
```

Expected:

- `/`, `/overview`, and `/installments` return HTML with status 200.
- `/health` returns JSON with status 200.
- `/v1/workspaces` reaches the API and returns 401 without an access token.

### Task 3: Regression verification and delivery

**Files:**
- Verify: all tracked project files.

**Interfaces:**
- Consumes: the completed Worker asset configuration.
- Produces: a pushed commit that triggers Cloudflare Builds.

- [ ] **Step 1: Run the full verification suite**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run build
git diff --check
```

Expected: tests, typecheck, build, and whitespace validation all pass.

- [ ] **Step 2: Commit the tested change**

Run:

```powershell
git add wrangler.jsonc docs/superpowers/plans/2026-07-27-worker-static-assets.md
git commit -m "feat: serve web app from Worker"
```

- [ ] **Step 3: Push the production branch**

Run:

```powershell
git push origin HEAD:main
```

Expected: GitHub accepts the commit and Cloudflare starts a deployment.

- [ ] **Step 4: Verify production**

Run:

```powershell
curl.exe -I https://baan-ngern-dee.newforico-9ea.workers.dev/
curl.exe -I https://baan-ngern-dee.newforico-9ea.workers.dev/overview
curl.exe -i https://baan-ngern-dee.newforico-9ea.workers.dev/health
```

Expected: root and `/overview` return the SPA with status 200; `/health` continues returning JSON with status 200.
