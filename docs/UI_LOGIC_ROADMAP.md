# UI/Logic Improvement Roadmap

This roadmap consolidates frontend UX, logic, and maintainability improvements for `singbox-manager`.

## Baseline (as of February 27, 2026)

- Frontend lint status: `114` issues (`106` errors, `8` warnings).
- Main hotspots:
  - oversized global Zustand store
  - heavy pages with mixed responsibilities (Dashboard, Settings, Rules, Subscriptions)
  - inconsistent confirmation flows (`window.confirm`)
  - weak API typing (`any` usage in multiple layers)
  - effect dependency and state-in-effect issues

## Target Outcomes

- Stable and predictable UI behavior under load.
- Consistent UX for destructive actions and long-running operations.
- Strong TypeScript contracts between UI/store/API.
- Reduced re-render and request noise in monitoring-heavy screens.
- Lower onboarding and change risk for contributors.

## Phase 0: Fast Stabilization (2-3 days)

### Scope

- Fix highest-risk frontend issues before feature work.

### Tasks

1. Resolve lint blockers that can cause behavioral bugs:
   - `react-hooks/set-state-in-effect`
   - `react-hooks/purity`
   - `react-hooks/exhaustive-deps` on key screens
2. Fix initial dark theme application on first render (not only on toggle).
3. Remove obviously unused params/vars and dead hook usage.
4. Replace direct `window.location.reload()` after DB import with controlled data refresh path.

### Exit Criteria

- `npm run lint` has `0` errors in core pages/components touched in this phase.
- No forced full-page reload after DB import.

## Phase 1: Type Safety and Store Cleanup (4-6 days)

### Scope

- Make state/API interactions explicit and testable.

### Tasks

1. Introduce strict API DTO types for all endpoints used by store.
2. Eliminate broad `any` usage in:
   - `web/src/api/index.ts`
   - `web/src/store/index.ts`
   - node modals/forms/hooks
3. Split global store into domain slices:
   - `nodes`
   - `rules`
   - `settings`
   - `monitoring`
4. Add small shared error-normalization helper for toast messages.

### Exit Criteria

- No `any` in API/store public surface.
- Store file size reduced via slices with clear boundaries.
- All domain actions have typed request/response shapes.

## Phase 2: UX Consistency and Interaction Quality (4-5 days)

### Scope

- Improve day-to-day usability without changing product scope.

### Tasks

1. Replace native `confirm()` with reusable confirmation modal:
   - destructive label, context text, loading state
2. Standardize long-running action UI:
   - disable buttons while in-flight
   - progress/status feedback where available
3. Unify UI language (single locale policy for labels).
4. Improve accessibility:
   - `aria-label` for icon-only controls
   - keyboard focus visibility on major actions

### Exit Criteria

- No native confirm dialogs in app flows.
- Consistent action feedback pattern across Settings/Rules/Nodes.
- Basic accessibility checks pass for navigation and action buttons.

## Phase 3: Data Flow and Performance Hardening (5-7 days)

### Scope

- Reduce request overhead and prevent duplicated real-time logic.

### Tasks

1. Consolidate polling + websocket logic on Dashboard/Monitoring.
2. Introduce shared real-time hook utilities (reconnect/backoff/parser guard).
3. Add request deduplication/caching strategy (e.g. React Query/SWR or equivalent).
4. Optimize bulk node actions:
   - batch delete/promote/archive
   - avoid sequential per-item API loops where possible

### Exit Criteria

- Fewer duplicate network calls on dashboard-level screens.
- Real-time handlers are centralized and parser-safe.
- Bulk operations do not trigger N serial UI refreshes.

## Phase 4: Backend/Operational Safety Alignment (2-3 days)

### Scope

- Tighten API operational defaults that impact UI deployments.

### Tasks

1. Restrict permissive CORS default (`*`) for non-dev modes.
2. Align frontend error states with backend error envelopes.
3. Add smoke checks for key flows:
   - add/update/delete node/subscription/rule
   - service start/stop/restart
   - database import/export

### Exit Criteria

- Production-safe CORS strategy documented and implemented.
- Smoke checklist reproducible in CI or scripted local run.

## Suggested Delivery Plan

- Week 1: Phase 0 + Phase 1 (stability + typing foundation)
- Week 2: Phase 2 + Phase 3 (UX + performance)
- Week 3 (short): Phase 4 + final cleanup

## Progress Tracking Template

- [ ] Phase 0 complete
- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Final lint/build + smoke run
