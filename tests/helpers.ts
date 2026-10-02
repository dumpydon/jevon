import { normalizeJevResult } from '../src/lib/jev/normalize';
import type { ReviewInput } from '../src/lib/types';
import { makeRawJevFixture } from './jev-fixture';

export function makeRawResponse() {
  const raw = makeRawJevFixture();
  raw.answers.battery_mentioned = { type: 'noul', noul: 0.8 };
  raw.answers.overall_sentiment = {
    type: 'choice',
    choice: 'neutral',
    confidence: 0.9,
    probabilities: { negative: 0, neutral: 1, positive: 0 },
  };
  return raw;
}
export function makeResult(
  review: ReviewInput = {
    reviewId: 'test',
    product: 'Test smartphone',
    reviewText: 'The battery is okay.',
  },
  requestId = 'test-request',
) {
  return normalizeJevResult(makeRawResponse(), review, { requestId, durationMs: 120 });
}
