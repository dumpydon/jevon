import type { AnalysisResult, EvaluationExample } from './types';

export interface FixtureAgreement {
  agreements: number;
  assertions: number;
}

/** Agreement is descriptive fixture matching, not a claim of general model accuracy. */
export function evaluateFixture(
  example: EvaluationExample,
  result: AnalysisResult,
): FixtureAgreement {
  let agreements = 0;
  let assertions = 0;
  const assert = (matches: boolean): void => {
    assertions += 1;
    if (matches) agreements += 1;
  };

  if (example.expected.sentiment !== undefined)
    assert(result.signal.sentiment === example.expected.sentiment);
  if (example.expected.topic !== undefined)
    assert(result.signal.primaryTopic === example.expected.topic);
  if (example.expected.mentioned) {
    for (const [aspectId, mentioned] of Object.entries(example.expected.mentioned)) {
      if (mentioned !== undefined)
        assert(result.aspects.find((aspect) => aspect.id === aspectId)?.mentioned === mentioned);
    }
  }
  return { agreements, assertions };
}
