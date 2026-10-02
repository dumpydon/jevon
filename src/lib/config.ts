export const THRESHOLDS = {
  aspectMention: 0.5,
  escalation: 0.75,
  churnRisk: 3,
  urgency: 3,
} as const;
export const LIMITS = {
  maxCharacters: 8000,
  maxReviews: 50,
  maxCsvBytes: 1_048_576,
  concurrency: 2,
  timeoutMs: 20000,
  totalTimeoutMs: 45000,
  benchmarkDefault: 3,
  benchmarkMax: 5,
} as const;
export const JEV_MODEL = 'jev-1.13.0';
export const DECISION_COUNT = 19;
