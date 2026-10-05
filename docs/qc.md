# Final QC — October 5, 2026

Verdict: **ready for deployment configuration**. Local source, contracts, tests,
browser flows, secret handling, and the static-assets configuration were verified.
Public deployment was not performed. The actual Render URL, Cloudflare origin,
and hosted server credential must be configured when deploying.

## Defects corrected

- Batch scheduling could launch an extra analysis when a success and a fatal
  provider error finished together. All completed tasks are now examined before
  refilling either concurrency slot. A regression test reproduced the unwanted
  third call before the fix.
- The API HTTP exception handler converted both wrong-method requests and
  invalid JSON encoding into 404 responses. These now return safe 405 and 400
  responses respectively; the `Allow` header is preserved.
- Formatted the particle-data file so the repository formatting gate passes.
- Removed only unused CSS for the old braces/NSC empty-state illustration.

The UI, theme, particle geometry/motion, architecture, SDK, thresholds, batch
limits, and benchmark dimensions were intentionally retained. Existing Inspector
and Benchmark disclosures provide help; no additional manual UI was added.

## Model and contracts

- Inspected the actual definitions and SDK request: **8 Noul + 9 Score + 2 Choice
  = 19**, unique IDs, one shared review state, model `jev-1.13.0`.
- Tested mention probabilities 0, 0.4999, 0.5, 0.5001, and 1. The existing gate is
  `>= 0.5`; rejected aspect ratings/confidence remain null, with raw traces available.
- Satisfaction maps ordered scores from 0–4 to 1–5 by adding 1. Tested endpoints,
  fractional 2.5/2.6, and nearest-label rounding. Invalid values are rejected.
- Tested both Choice winners/distributions, including invalid and losing winners;
  malformed results produce safe errors without invented categories.
- Verified request validation, camelCase JSON, safe failures, missing configuration,
  timeout, retry bounds, request IDs, and socket-disconnect cancellation.
- Seven example profiles were exercised through the actual routes and official SDK
  with mocked transport; short and maximum-length inputs were also tested.

## Execution and browser evidence

- **95 Python tests passed**; Python compilation and `pip check` passed.
- **30 frontend tests passed**; typecheck, lint, formatting, and production build passed.
- Cloudflare static-assets `wrangler deploy --dry-run` passed with no backend bindings.
- One real mixed-review Jev verification passed: 19 decisions, 747 ms, 4/4 specified
  fixture expectations. This is integration evidence, not a model accuracy claim.
  All other inference used mocks; no real batch or benchmark runs were submitted.
- Batch limits: 1,048,576-byte CSV, 50 reviews, at most 2 simultaneous analyses.
  Tests cover exact byte/row boundaries, malformed input, duplicate IDs, partial
  failures, fatal provider errors, ordered results, and cancellation.
- Browser batch runs: one review succeeded; four reviews retained three successes
  and one failure; 50 reviews produced 950 decisions; cancellation retained four
  completed reviews while stopping pending/queued work.
- Benchmark uses measured durations and specified fixture assertions. A mixed
  success/failure run showed unavailable latency for failure; the LLM baseline
  stayed `Not configured` without speedup/cost claims.
- Inspector: seven aspect groups, five signal groups, all 19 traces, 0.5 gate,
  distributions/legends, JSON copy, keyboard closing, and focus restoration verified.
- Decision Lab, Batch, Benchmark, and Inspector inspected at **1440×900,
  1280×720, 390×844, and 320×700**. No horizontal page overflow or footer overlap;
  mobile tables scroll inside their containers. Success, loading, error, absent
  aspects, example selection, empty/whitespace input, and cancellation were exercised.
- Decorative canvas stayed stable in layout, changed no DOM attributes during its
  animation, and sampled 67 animation frames over about 1.1 s (largest gap 17 ms).
  It pauses offscreen. Reduced motion yields a static cube and no status pulse.
  The footer reaches the viewport bottom on short pages and follows long content.
  Its clock matched explicit `Asia/Kolkata` formatting and updated during QC.
- Browser checks found no application console errors. Logs contain safe metadata,
  without credentials or full review text.

## Security and deployment

- Secret audit passed against publishable source and production assets. A separate
  scan of Git history found no configured key or key prefix. **Tracked secrets: none.**
- `.env.local` remains present and ignored; `.env.example` has one placeholder.
  No credential enters health/results/exported JSON or the frontend bundle.
- `VITE_API_BASE_URL` controls the public frontend API URL; local development uses
  the Vite proxy. The built frontend has no hard-coded local API URL.
- `FRONTEND_ORIGIN` supports exact production origins. Allowed-origin preflight
  returned 200; tests reject other origins. Credentials/cookies are not enabled.
- README now explicitly documents primitive totals, all canonical IDs and options,
  and `PYTHON_VERSION=3.14.3` for the verified Render runtime.
- No obsolete Hono/TypeSafe JavaScript backend or unused runtime dependency was found.

QC changes are local and uncommitted. Screenshots, temporary fixtures, and local
test runners stayed outside the repository. **No commit, push, or deployment.**
