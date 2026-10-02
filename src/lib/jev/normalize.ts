import { z } from 'zod';
import { DECISION_COUNT, THRESHOLDS } from '../config';
import { applyRules, mapSatisfactionToRating } from '../decisions/rules';
import {
  ASPECTS,
  SATISFACTION_LABELS,
  type AnalysisResult,
  type ChoiceDecision,
  type DecisionTrace,
  type NoulDecision,
  type OperationalSignal,
  type ReviewInput,
  type ScoreDecision,
  type Sentiment,
  type Topic,
} from '../types';
import { buildQuestions } from './questions';

const probability = z.number().finite().min(0).max(1);
const probabilities = z.record(z.string(), probability);
const decisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: probability }).strict(),
  z
    .object({
      type: z.literal('choice'),
      choice: z.string(),
      confidence: probability,
      probabilities,
    })
    .strict(),
  z
    .object({
      type: z.literal('score'),
      score: z.number().finite().min(0),
      confidence: probability,
      probabilities,
      legend: z.record(z.string(), z.string()),
    })
    .strict(),
]);
const responseSchema = z
  .object({
    model: z.string().min(1).max(128),
    answers: z.record(z.string(), decisionSchema),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export class MalformedJevResponseError extends Error {
  constructor() {
    super('Jev returned an unexpected decision response.');
    this.name = 'MalformedJevResponseError';
  }
}

function requireValid(condition: boolean): asserts condition {
  if (!condition) throw new MalformedJevResponseError();
}

function sameKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(record, key));
}

export function normalizeJevResult(
  raw: unknown,
  review: ReviewInput,
  metadata: { requestId: string; durationMs: number },
): AnalysisResult {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new MalformedJevResponseError();
  const response = parsed.data;
  const definitions = buildQuestions();
  requireValid(sameKeys(response.answers, Object.keys(definitions)));

  for (const [id, definition] of Object.entries(definitions)) {
    const answer = response.answers[id];
    requireValid(answer.type === definition.type);
    if (answer.type === 'noul' || definition.type === 'noul') continue;

    const keys =
      definition.type === 'choice'
        ? Object.keys(definition.criteria)
        : definition.criteria.map((_, index) => String(index));
    requireValid(sameKeys(answer.probabilities, keys));
    const sum = Object.values(answer.probabilities).reduce((total, value) => total + value, 0);
    // A small tolerance permits numeric rounding without inventing or renormalizing values.
    requireValid(Math.abs(sum - 1) <= 0.01 + Number.EPSILON);

    if (answer.type === 'choice' && definition.type === 'choice') {
      requireValid(keys.includes(answer.choice));
      requireValid(
        answer.probabilities[answer.choice] >=
          Math.max(...Object.values(answer.probabilities)) - 0.001,
      );
    } else if (answer.type === 'score' && definition.type === 'score') {
      requireValid(answer.score <= definition.criteria.length - 1);
      requireValid(sameKeys(answer.legend, keys));
      requireValid(keys.every((key, index) => answer.legend[key] === definition.criteria[index]));
      const weightedScore = keys.reduce(
        (total, key) => total + Number(key) * answer.probabilities[key],
        0,
      );
      requireValid(Math.abs(answer.score - weightedScore) <= 0.05);
    } else {
      throw new MalformedJevResponseError();
    }
  }

  // These narrowing helpers follow validation against every named definition above.
  const noul = (id: string): NoulDecision => {
    const answer = response.answers[id];
    if (answer.type !== 'noul') throw new MalformedJevResponseError();
    return answer;
  };
  const score = (id: string): ScoreDecision => {
    const answer = response.answers[id];
    if (answer.type !== 'score') throw new MalformedJevResponseError();
    return answer;
  };
  const choice = (id: string): ChoiceDecision => {
    const answer = response.answers[id];
    if (answer.type !== 'choice') throw new MalformedJevResponseError();
    return answer;
  };
  const aspects = ASPECTS.map((aspect) => {
    const mentionProbability = noul(`${aspect.id}_mentioned`).noul;
    const satisfaction = score(`${aspect.id}_satisfaction`);
    const mentioned = mentionProbability >= THRESHOLDS.aspectMention;
    return {
      id: aspect.id,
      label: aspect.label,
      mentionProbability,
      mentioned,
      rating: mentioned ? mapSatisfactionToRating(satisfaction.score) : null,
      satisfactionLabel: mentioned ? SATISFACTION_LABELS[Math.round(satisfaction.score)] : null,
      confidence: mentioned ? satisfaction.confidence : null,
    };
  });
  const sentiment = choice('overall_sentiment');
  const topic = choice('primary_topic');
  const urgency = score('urgency');
  const churn = score('churn_risk');
  const signal: OperationalSignal = {
    sentiment: sentiment.choice as Sentiment,
    sentimentConfidence: sentiment.confidence,
    primaryTopic: topic.choice as Topic,
    topicConfidence: topic.confidence,
    urgency: urgency.score,
    urgencyConfidence: urgency.confidence,
    churnRisk: churn.score,
    churnConfidence: churn.confidence,
    escalationProbability: noul('escalation_need').noul,
  };
  const traces: DecisionTrace[] = Object.entries(response.answers).map(([id, decision]) => {
    const aspect = aspects.find(
      (candidate) => id === `${candidate.id}_mentioned` || id === `${candidate.id}_satisfaction`,
    );
    if (id.endsWith('_mentioned') && aspect)
      return { id, decision, threshold: THRESHOLDS.aspectMention, accepted: aspect.mentioned };
    if (id.endsWith('_satisfaction') && aspect)
      return {
        id,
        decision,
        accepted: aspect.mentioned,
        ...(aspect.rating !== null ? { mappedRating: aspect.rating } : {}),
      };
    const threshold =
      id === 'escalation_need'
        ? THRESHOLDS.escalation
        : id === 'churn_risk'
          ? THRESHOLDS.churnRisk
          : id === 'urgency'
            ? THRESHOLDS.urgency
            : undefined;
    return {
      id,
      decision,
      ...(threshold !== undefined
        ? {
            threshold,
            accepted:
              (decision.type === 'noul'
                ? decision.noul
                : decision.type === 'score'
                  ? decision.score
                  : 0) >= threshold,
          }
        : {}),
    };
  });

  return {
    requestId: metadata.requestId,
    review,
    model: response.model,
    source: 'jev',
    analyzedAt: new Date().toISOString(),
    durationMs: metadata.durationMs,
    decisionCount: DECISION_COUNT,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    aspects,
    signal,
    actions: applyRules(signal),
    traces,
  };
}
