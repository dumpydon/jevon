import {
  ArrowUpRight,
  BatteryMedium,
  Braces,
  Camera,
  CircleCheck,
  Cpu,
  Diamond,
  DollarSign,
  Fingerprint,
  Layers3,
  ShieldCheck,
  Smartphone,
  Star,
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
  const mentionedAspects = result.aspects.filter((aspect) => aspect.mentioned);
  const absentAspects = result.aspects.filter((aspect) => !aspect.mentioned);
  return (
    <div className="analysis-view appear">
      <section className="analysis-summary" aria-label="Analysis summary" role="status">
        <div className="analysis-summary-state">
          <CircleCheck size={18} aria-hidden="true" />
          <span>Analysis complete</span>
        </div>
        <div className="analysis-summary-metrics">
          <div className="analysis-summary-metric">
            <strong>{result.decisionCount}</strong>
            <span>decisions</span>
          </div>
          <div className="analysis-summary-metric">
            <strong>{duration(result.durationMs)}</strong>
            <span>duration</span>
          </div>
        </div>
      </section>
      <section className="panel signal-panel">
        <div className="panel-heading">
          <div className="heading-with-icon">
            <Fingerprint size={17} />
            <h2>Customer signal</h2>
          </div>
        </div>
        <div className="signal-headline">
          <div>
            <span className="field-label">Primary topic</span>
            <strong title={`${percent(signal.topicConfidence)} confidence`}>
              {topicLabel(signal.primaryTopic)}
            </strong>
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
              : 'No action triggered'}
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
            {mentionedAspects.length} of {result.aspects.length} mentioned
          </span>
        </div>
        <div className="aspect-list">
          {mentionedAspects.map((aspect) => (
            <div key={aspect.id} className="aspect-row aspect-mentioned">
              <div className="aspect-name">
                <AspectIcon id={aspect.id} />
                <div>
                  <strong>{aspect.label}</strong>
                </div>
              </div>
              {aspect.rating !== null ? (
                <div className="aspect-result">
                  <div className="rating">
                    <Star size={12} fill="currentColor" />
                    <strong>{aspect.rating.toFixed(1)}</strong>
                    <span>/ 5</span>
                  </div>
                  <small>{aspect.satisfactionLabel}</small>
                </div>
              ) : (
                <span className="muted">Rating unavailable</span>
              )}
            </div>
          ))}
        </div>
        {absentAspects.length > 0 && (
          <div className="aspect-absent-list" role="group" aria-label="Not mentioned">
            <span className="aspect-absent-heading">Not mentioned</span>
            <div className="aspect-absent-items">
              {absentAspects.map((aspect) => (
                <span className="aspect-absent-item" key={aspect.id}>
                  <AspectIcon id={aspect.id} size={15} />
                  <span>{aspect.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <details className="aspect-detail-disclosure">
          <summary>View probabilities</summary>
          <dl className="aspect-detail-list">
            {result.aspects.map((aspect) => (
              <div key={aspect.id}>
                <dt>{aspect.label}</dt>
                <dd>
                  <span>{percent(aspect.mentionProbability)} mentioned</span>
                  {aspect.confidence !== null && (
                    <span>{percent(aspect.confidence)} rating confidence</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
      <div className="result-footer">
        <button className="button button-small button-secondary inspect-button" onClick={onInspect}>
          <Braces size={13} className="inspect-icon" aria-hidden="true" />
          Inspect decisions
          <ArrowUpRight size={13} className="inspect-arrow" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
