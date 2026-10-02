import { buildQuestions } from '../src/lib/jev/questions';
import type { TypedDecision } from '../src/lib/types';

export function makeScoreFixture(value: number, legend: readonly unknown[]): TypedDecision {
  const probabilities: Record<string, number> = Object.fromEntries(
    legend.map((_, index) => [String(index), 0]),
  );
  const lower = Math.floor(value);
  probabilities[String(lower)] = 1 - (value - lower);
  if (value !== lower) probabilities[String(lower + 1)] = value - lower;
  return {
    type: 'score',
    score: value,
    confidence: 0.8,
    probabilities,
    legend: Object.fromEntries(legend.map((level, index) => [String(index), String(level)])),
  };
}

/** Explicit test-only provider response. Never used by the application. */
export function makeRawJevFixture() {
  const answers: Record<string, TypedDecision> = {};
  for (const [id, definition] of Object.entries(buildQuestions())) {
    if (definition.type === 'noul') answers[id] = { type: 'noul', noul: 0.2 };
    else if (definition.type === 'score') answers[id] = makeScoreFixture(2, definition.criteria);
    else {
      const selected = id === 'primary_topic' ? 'battery' : 'negative';
      answers[id] = {
        type: 'choice',
        choice: selected,
        confidence: 1,
        probabilities: Object.fromEntries(
          Object.keys(definition.criteria).map((key) => [key, key === selected ? 1 : 0]),
        ),
      };
    }
  }
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 20 } };
}
