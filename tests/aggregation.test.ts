import { describe, expect, it } from 'vitest';
import contract from '../backend/tests/fixtures/legacy.json';
import examples from '../backend/evaluation.json';
import { aggregateResults } from '../src/lib/decisions/aggregation';
import { EVALUATION_EXAMPLES } from '../src/lib/fixtures';
import type { AnalysisResult, BatchItem } from '../src/lib/types';

describe('frontend compatibility with the Python backend', () => {
  it('keeps partial and cancelled result aggregates equal to the captured backend contract', () => {
    const items: BatchItem[] = contract.cases.map((entry) => ({
      review: entry.review,
      status: 'success',
      result: entry.expected as AnalysisResult,
    }));
    items.push({
      review: items[0].review,
      status: 'failed',
      error: { code: 'UPSTREAM_ERROR', message: 'Jev is temporarily unavailable.' },
    });
    expect(aggregateResults(items)).toEqual(contract.aggregate);
  });

  it('keeps frontend and backend evaluation inputs identical', () => {
    expect(EVALUATION_EXAMPLES).toEqual(examples);
  });

  it('does not invent aggregate ratings for an empty or wholly failed batch', () => {
    expect(aggregateResults([])).toMatchObject({
      successful: 0,
      failed: 0,
      totalDecisions: 0,
      weakestAspect: null,
      strongestAspect: null,
    });
    const failed: BatchItem = {
      review: contract.cases[0].review,
      status: 'failed',
      error: { code: 'TIMEOUT', message: 'The Jev request timed out.' },
    };
    const result = aggregateResults([failed]);
    expect(result).toMatchObject({
      successful: 0,
      failed: 1,
      highRiskCount: 0,
      escalationCount: 0,
    });
    expect(
      result.aspects.every(
        (aspect) => aspect.averageRating === null && aspect.mentionPercent === 0,
      ),
    ).toBe(true);
  });
});
