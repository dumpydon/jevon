export const ASPECTS = [
  { id: 'camera', label: 'Camera', description: 'photo and video quality, camera features' },
  { id: 'battery', label: 'Battery', description: 'battery life, charging speed and reliability' },
  { id: 'display', label: 'Display', description: 'screen quality, brightness and refresh rate' },
  { id: 'design', label: 'Design', description: 'appearance, ergonomics and form factor' },
  {
    id: 'performance',
    label: 'Performance',
    description: 'speed, responsiveness, gaming and software stability',
  },
  {
    id: 'build_quality',
    label: 'Build quality',
    description: 'durability, materials and construction',
  },
  {
    id: 'value_for_money',
    label: 'Value for money',
    description: 'price, affordability and value relative to cost',
  },
] as const;

export type AspectId = (typeof ASPECTS)[number]['id'];
export type Sentiment = 'negative' | 'neutral' | 'positive';
export type Topic = AspectId | 'other';
export const SATISFACTION_LABELS = [
  'Very dissatisfied',
  'Dissatisfied',
  'Neutral / mixed',
  'Satisfied',
  'Very satisfied',
] as const;

export interface ReviewInput {
  reviewId: string;
  product: string;
  reviewText: string;
  overallRating?: number;
}
export interface NoulDecision {
  type: 'noul';
  noul: number;
}
export interface ChoiceDecision {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface ScoreDecision {
  type: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}
export type TypedDecision = NoulDecision | ChoiceDecision | ScoreDecision;
export interface DecisionTrace {
  id: string;
  decision: TypedDecision;
  threshold?: number;
  accepted?: boolean;
  mappedRating?: number;
}
export interface AspectDecision {
  id: AspectId;
  label: string;
  mentionProbability: number;
  mentioned: boolean;
  rating: number | null;
  satisfactionLabel: string | null;
  confidence: number | null;
}
export interface OperationalSignal {
  sentiment: Sentiment;
  sentimentConfidence: number;
  primaryTopic: Topic;
  topicConfidence: number;
  urgency: number;
  urgencyConfidence: number;
  churnRisk: number;
  churnConfidence: number;
  escalationProbability: number;
}
export interface DeterministicAction {
  id: 'escalate' | 'retention' | 'urgent';
  label: string;
  triggered: boolean;
  rule: string;
  value: number;
  threshold: number;
}
export interface AnalysisResult {
  requestId: string;
  review: ReviewInput;
  model: string;
  source: 'jev';
  analyzedAt: string;
  durationMs: number;
  decisionCount: number;
  usage: { inputTokens: number; outputTokens: number };
  aspects: AspectDecision[];
  signal: OperationalSignal;
  actions: DeterministicAction[];
  traces: DecisionTrace[];
}
export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}
export type BatchItem =
  | { review: ReviewInput; status: 'success'; result: AnalysisResult }
  | { review: ReviewInput; status: 'failed'; error: ApiError };
export interface AspectAggregate {
  id: AspectId;
  label: string;
  averageRating: number | null;
  mentionCount: number;
  mentionPercent: number;
}
export interface BatchAggregate {
  successful: number;
  failed: number;
  totalDecisions: number;
  sentimentCounts: Record<Sentiment, number>;
  aspects: AspectAggregate[];
  weakestAspect: string | null;
  strongestAspect: string | null;
  highRiskCount: number;
  escalationCount: number;
}
export interface BatchResult {
  requestId: string;
  items: BatchItem[];
  aggregate: BatchAggregate;
  durationMs: number;
  cancelled: boolean;
}
export type BatchEvent =
  | { type: 'start'; total: number; requestId: string }
  | { type: 'progress'; completed: number; total: number; item: BatchItem }
  | { type: 'complete'; result: BatchResult }
  | { type: 'error'; error: ApiError };
export interface BenchmarkExpectation {
  sentiment?: Sentiment;
  topic?: Topic;
  mentioned?: Partial<Record<AspectId, boolean>>;
}
export interface EvaluationExample {
  id: string;
  name: string;
  text: string;
  expected: BenchmarkExpectation;
}
export interface BenchmarkMeasurement {
  id: string;
  name: string;
  status: 'success' | 'failed';
  latencyMs: number | null;
  schemaValid: boolean;
  agreements: number;
  assertions: number;
  result?: AnalysisResult;
  error?: ApiError;
}
export interface BenchmarkRun {
  id: string;
  createdAt: string;
  model: string;
  measurements: BenchmarkMeasurement[];
  durationMs: number;
  baseline: { status: 'not_configured'; reason: string };
}
export interface HealthStatus {
  status: 'ok';
  jevConfigured: boolean;
  model: string;
  decisionCount: number;
  limits: { maxReviews: number; concurrency: number; maxCharacters: number };
  baselineConfigured: false;
}
