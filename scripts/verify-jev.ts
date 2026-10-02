import { config } from 'dotenv';
import assert from 'node:assert/strict';
import { analyzeWithJev } from '../src/lib/jev/client';
import { EVALUATION_EXAMPLES } from '../src/lib/fixtures';
import { evaluateFixture } from '../src/lib/benchmark';

config({ path: '.env.local', quiet: true });
if (process.env.JEV_VERIFY_REAL !== '1') {
  console.info('Opt-in required: JEV_VERIFY_REAL=1 npm run test:jev (one paid Jev request).');
  process.exit(0);
}
const apiKey = process.env.TYPESAFE_API_KEY;
assert(apiKey, 'Set TYPESAFE_API_KEY in .env.local first.');
const fixture = EVALUATION_EXAMPLES.find(
  (example) => example.id === (process.env.JEV_VERIFY_EXAMPLE ?? 'mixed'),
);
assert(fixture, 'Unknown JEV_VERIFY_EXAMPLE.');
const result = await analyzeWithJev(
  { reviewId: fixture.id, product: 'Manual integration verification', reviewText: fixture.text },
  {
    apiKey,
    requestId: crypto.randomUUID(),
  },
);
assert.equal(result.source, 'jev');
assert.equal(result.decisionCount, 19);
assert.equal(result.traces.length, 19);
assert(!JSON.stringify(result).includes(apiKey), 'A secret reached the response.');
for (const aspect of result.aspects) if (!aspect.mentioned) assert.equal(aspect.rating, null);
console.info(
  JSON.stringify(
    {
      verified: true,
      model: result.model,
      decisions: result.decisionCount,
      durationMs: result.durationMs,
      mentionedAspects: result.aspects
        .filter((aspect) => aspect.mentioned)
        .map((aspect) => aspect.id),
      fixtureAgreement: evaluateFixture(fixture, result),
      note: 'Agreement on a tiny fixture is diagnostic, not a model accuracy claim.',
    },
    null,
    2,
  ),
);
