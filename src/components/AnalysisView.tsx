import {
  ArrowUpRight,
  BatteryMedium,
  Braces,
  Camera,
  CircleCheck,
  CircleMinus,
  Cpu,
  Diamond,
  DollarSign,
  Fingerprint,
  Layers3,
  ShieldCheck,
  Smartphone,
  Star,
  Timer,
  Zap,
} from 'lucide-react';
import type { AnalysisResult, AspectId } from '../lib/types';
import { THRESHOLDS } from '../lib/config';
import { Badge, duration, percent, topicLabel } from './ui';

const aspectIcons = {
  camera: Camera,
  battery: BatteryMedium,
  display: Smartphone,
  design: Diamond,
  performance: Cpu,
  build_quality: ShieldCheck,
  value_for_money: DollarSign,
};

export function AspectIcon({ id, size = 17 }: { id: AspectId; size?: number }) {
  const Icon = aspectIcons[id];
  return <Icon size={size} />;
}

export function AnalysisView({
  result,
  onInspect,
}: {
  result: AnalysisResult;
  onInspect: () => void;
}) {
  const { signal } = result;
  const activeActions = result.actions.filter((action) => action.triggered);
  return (
    <div className="analysis-view appear">
      <span className="sr-only" role="status">
        Analysis complete. {result.decisionCount} real Jev decisions returned.
      </span>
      <section className="panel signal-panel">
        <div className="panel-heading">
          <div className="heading-with-icon">
            <Fingerprint size={17} />
            <h2>Customer signal</h2>
          </div>
          <Badge key={result.requestId} tone="positive">
            <CircleCheck size={12} aria-hidden="true" />
            Analyzed
          </Badge>
        </div>
        <div className="signal-headline">
          <div>
            <span className="field-label">Primary topic</span>
            <strong>{topicLabel(signal.primaryTopic)}</strong>
            <small>{percent(signal.topicConfidence)} choice confidence</small>
          </div>
          <Badge
            tone={
              signal.sentiment === 'negative'
                ? 'negative'
                : signal.sentiment === 'positive'
                  ? 'positive'
                  : 'neutral'
            }
          >
            {signal.sentiment}
          </Badge>
        </div>
        <div className="operational-grid">
          <div>
            <span>Urgency</span>
            <strong>
              {signal.urgency.toFixed(1)}
              <small> / 4</small>
            </strong>
            <div className="mini-meter">
              <span
                className={signal.urgency >= THRESHOLDS.urgency ? 'warning' : ''}
                style={{ width: `${(signal.urgency / 4) * 100}%` }}
              />
            </div>
          </div>
          <div>
            <span>Churn risk</span>
            <strong>
              {signal.churnRisk.toFixed(1)}
              <small> / 4</small>
            </strong>
            <div className="mini-meter">
              <span
                className={signal.churnRisk >= THRESHOLDS.churnRisk ? 'warning' : ''}
                style={{ width: `${(signal.churnRisk / 4) * 100}%` }}
              />
            </div>
          </div>
          <div>
            <span>Escalation</span>
            <strong>{percent(signal.escalationProbability)}</strong>
            <div className="mini-meter">
              <span
                className={signal.escalationProbability >= THRESHOLDS.escalation ? 'warning' : ''}
                style={{ width: percent(signal.escalationProbability) }}
              />
            </div>
          </div>
        </div>
        <div className={`action-strip ${activeActions.length ? 'action-active' : ''}`}>
          {activeActions.length ? <Zap size={15} /> : <CircleCheck size={15} />}
          <span>
            {activeActions.length
              ? activeActions.map((action) => action.label).join(' · ')
              : 'No operational action triggered'}
          </span>
        </div>
      </section>
      <section className="panel aspects-panel">
        <div className="panel-heading">
          <div className="heading-with-icon">
            <Layers3 size={17} />
            <h2>Aspect analysis</h2>
          </div>
          <span className="muted small">
            {result.aspects.filter((aspect) => aspect.mentioned).length} of 7 mentioned
          </span>
        </div>
        <div className="aspect-list">
          {result.aspects.map((aspect) => (
            <div
              key={aspect.id}
              className={`aspect-row ${!aspect.mentioned ? 'aspect-unmentioned' : ''}`}
            >
              <div className="aspect-name">
                <AspectIcon id={aspect.id} />
                <div>
                  <strong>{aspect.label}</strong>
                  <small>{percent(aspect.mentionProbability)} mention probability</small>
                </div>
              </div>
              {aspect.mentioned && aspect.rating !== null ? (
                <div className="aspect-result">
                  <div className="rating">
                    <Star size={12} fill="currentColor" />
                    <strong>{aspect.rating.toFixed(1)}</strong>
                    <span>/ 5</span>
                  </div>
                  <small>
                    {aspect.satisfactionLabel}
                    {aspect.confidence !== null && (
                      <span className="aspect-score-confidence">
                        {' '}
                        · {percent(aspect.confidence)} confidence
                      </span>
                    )}
                  </small>
                </div>
              ) : (
                <div className="not-mentioned">
                  <CircleMinus size={13} />
                  Not mentioned
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="panel-note">
          Ratings shown when mention probability ≥ {THRESHOLDS.aspectMention.toFixed(2)}.
        </div>
      </section>
      <div className="result-footer">
        <div className="inference-status" role="group" aria-label="Analysis execution details">
          <span className="inference-state">
            <span className="status-dot" aria-hidden="true" />
            Analysis complete
          </span>
          <span className="inference-metric" title="Typed decisions returned">
            <strong>{result.decisionCount}</strong>
            <span>decisions</span>
          </span>
          <span className="inference-metric inference-time" title="Measured analysis duration">
            <Timer size={11} aria-hidden="true" />
            <strong>{duration(result.durationMs)}</strong>
          </span>
        </div>
        <button className="button button-small button-secondary inspect-button" onClick={onInspect}>
          <Braces size={13} className="inspect-icon" aria-hidden="true" />
          Inspect decisions
          <ArrowUpRight size={13} className="inspect-arrow" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
