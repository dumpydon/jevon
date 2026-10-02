import { choice, noul, score, type Questions } from '@typesafe-ai/sdk';
import { ASPECTS, SATISFACTION_LABELS } from '../types';

export const URGENCY_LEVELS = [
  'No immediate action needed; general opinion or praise',
  'Minor inconvenience; can be handled routinely',
  'Meaningful problem; prompt follow-up is appropriate',
  'Time-sensitive or major loss of product function; urgent attention needed',
  'Immediate danger, safety issue, or critical harm',
] as const;

export const CHURN_LEVELS = [
  'No sign of leaving; satisfied or likely to buy again',
  'Minor dissatisfaction without any intent to leave',
  'Uncertain future purchase, regret, or substantial dissatisfaction',
  'Likely to stop using, return, switch, or avoid buying again',
  'Explicit decision to leave, switch brands, or never buy again',
] as const;

/** All questions see the same review; no question depends on another answer. */
export function buildQuestions(): Questions {
  const questions: Questions = {};

  for (const aspect of ASPECTS) {
    questions[`${aspect.id}_mentioned`] = noul(
      `Does the reviewer express an opinion or describe an experience about ${aspect.label.toLowerCase()} (${aspect.description})? Mere product ownership or unrelated packaging does not count.`,
      {
        true: 'A substantive aspect-specific opinion or experience is stated.',
        false: 'The aspect is absent, only named without an opinion, or unsupported by the review.',
      },
    );
    questions[`${aspect.id}_satisfaction`] = score(
      `How satisfied is the reviewer with ${aspect.label.toLowerCase()} (${aspect.description})? Evaluate only this aspect, not the overall review. If it is not discussed, use neutral; application code will discard its score.`,
      SATISFACTION_LABELS,
    );
  }

  questions.overall_sentiment = choice(
    'What is the overall customer sentiment? Treat balanced mixed or unclear feedback as neutral.',
    {
      negative: 'Predominantly dissatisfied, disappointed, or critical',
      neutral: 'Neutral, ambiguous, or balanced positive and negative feedback',
      positive: 'Predominantly satisfied, enthusiastic, or recommending the product',
    },
  );
  questions.primary_topic = choice(
    'Which single product aspect is the main focus or principal reason for the customer feedback? Choose other for feedback outside these aspects or with no clear aspect focus.',
    {
      ...Object.fromEntries(ASPECTS.map((aspect) => [aspect.id, aspect.description])),
      other: 'Packaging, delivery, service, unrelated feedback, or no clear product-aspect focus',
    },
  );
  questions.urgency = score(
    'How urgently does this feedback need operational attention? Distinguish strong negative opinion from genuine time sensitivity or safety concerns.',
    URGENCY_LEVELS,
  );
  questions.churn_risk = score(
    'How much evidence is there that this customer will stop using, return, switch away from, or avoid buying the product again? Do not infer intent to leave from a minor complaint alone.',
    CHURN_LEVELS,
  );
  questions.escalation_need = noul(
    'Should a person review this feedback because it describes a safety problem, a severe product failure, unresolved repeated support attempts, or an explicit urgent request? Ordinary praise or a routine minor complaint does not require escalation.',
    {
      true: 'Human attention is justified by a serious or unresolved problem.',
      false: 'Routine feedback can be handled without escalation.',
    },
  );

  return questions;
}
