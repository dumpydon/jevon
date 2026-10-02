import { THRESHOLDS } from '../config';
import { ASPECTS, type BatchAggregate, type BatchItem } from '../types';

/** Failed reviews never enter a model-result denominator or average. */
export function aggregateResults(items: BatchItem[]): BatchAggregate {
  const results = items.flatMap((item) => (item.status === 'success' ? [item.result] : []));
  const aspects = ASPECTS.map((aspect) => {
    const ratings = results.flatMap((result) => {
      const decision = result.aspects.find((candidate) => candidate.id === aspect.id);
      return decision?.mentioned && decision.rating !== null ? [decision.rating] : [];
    });
    return {
      id: aspect.id,
      label: aspect.label,
      averageRating: ratings.length
        ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
        : null,
      mentionCount: ratings.length,
      mentionPercent: results.length ? (ratings.length / results.length) * 100 : 0,
    };
  });
  const ranked = aspects
    .filter((aspect) => aspect.averageRating !== null)
    .sort((a, b) => (a.averageRating ?? 0) - (b.averageRating ?? 0));
  const sentimentCounts: BatchAggregate['sentimentCounts'] = {
    negative: 0,
    neutral: 0,
    positive: 0,
  };
  for (const result of results) sentimentCounts[result.signal.sentiment] += 1;

  return {
    successful: results.length,
    failed: items.length - results.length,
    totalDecisions: results.reduce((sum, result) => sum + result.decisionCount, 0),
    sentimentCounts,
    aspects,
    weakestAspect: ranked[0]?.label ?? null,
    strongestAspect: ranked[ranked.length - 1]?.label ?? null,
    highRiskCount: results.filter((result) => result.signal.churnRisk >= THRESHOLDS.churnRisk)
      .length,
    escalationCount: results.filter(
      (result) => result.signal.escalationProbability >= THRESHOLDS.escalation,
    ).length,
  };
}
