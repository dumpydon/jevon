# Local verification

Verified on October 2, 2026. This records development evidence, not a provider performance or accuracy claim.

- Installed and inspected `@typesafe-ai/sdk` 0.6.0; real responses reported `jev-1.13.0`.
- Five small real analyses in total: mixed feedback through the opt-in SDK script; battery/camera/performance feedback through the visible Decision Lab; one positive sample through streamed batch processing; packaging-only feedback through Benchmark; a safety/escalation review through the local Cloudflare Worker.
- Every successful analysis returned 19 decisions and passed runtime normalization. Packaging-only feedback gated out all seven aspect ratings. The safety review triggered all three configured actions. No production fixture fallback exists.
- Real batch results, aspect aggregates, sentiment chart, search/filter empty states, and row inspection were exercised. Benchmark latency and schema/fixture agreement came from the actual request; its LLM baseline stayed unconfigured.
- Inspector distributions and raw fractional scores were inspected; keyboard focus wrapping and Escape dismissal were exercised.
- Browser checks covered effective CSS viewports of 1440 × 900, 1280 × 719, 389 × 844 and 321 × 700. A hidden table label caused mobile page overflow; positioning the scroll container fixed it. No page overflow remained. The primary Analyze button fit the shorter laptop viewport.
- Development and local Worker browser sessions rendered without console errors. Production assets and `/api/health` returned successfully in the Worker runtime.
- Unit/API tests use mocked inference. Typecheck, lint, formatting, production build and Cloudflare dry run passed. The secret audit checked publishable files and the browser bundle against the ignored local credential; no matching value or prefix was found.
- The CSV file chooser opened, but selecting a local CSV was rejected by browser approval review. That specific browser-upload action remains unverified. CSV validation, including malformed/oversized files and aliases, passed automated tests; the sample workflow was verified in the browser.
- No public deployment, GitHub push or commit was performed. Benchmark and analysis history are session memory and clear on refresh.

The repeatable paid path remains opt-in: `JEV_VERIFY_REAL=1 npm run test:jev`. Do not run it in normal CI.
