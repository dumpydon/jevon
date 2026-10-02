import { THRESHOLDS } from '../config';
import type { DeterministicAction, OperationalSignal } from '../types';

/** Jev Score uses indices 0–4; retain precision until presentation. */
export function mapSatisfactionToRating(score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 4) {
    throw new RangeError('Satisfaction score must be between 0 and 4.');
  }
  return score + 1;
}

export function applyRules(signal: OperationalSignal): DeterministicAction[] {
  return [
    {
      id: 'escalate',
      label: 'Escalate to a person',
      triggered: signal.escalationProbability >= THRESHOLDS.escalation,
      rule: `escalation_need >= ${THRESHOLDS.escalation}`,
      value: signal.escalationProbability,
      threshold: THRESHOLDS.escalation,
    },
    {
      id: 'retention',
      label: 'Retention follow-up',
      triggered: signal.churnRisk >= THRESHOLDS.churnRisk,
      rule: `churn_risk >= ${THRESHOLDS.churnRisk} / 4`,
      value: signal.churnRisk,
      threshold: THRESHOLDS.churnRisk,
    },
    {
      id: 'urgent',
      label: 'Prioritize urgent review',
      triggered: signal.urgency >= THRESHOLDS.urgency,
      rule: `urgency >= ${THRESHOLDS.urgency} / 4`,
      value: signal.urgency,
      threshold: THRESHOLDS.urgency,
    },
  ];
}
