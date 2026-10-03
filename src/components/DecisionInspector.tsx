import { Check, ChevronDown, Copy, Layers3, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  AnalysisResult,
  AspectDecision,
  DecisionTrace,
  DeterministicAction,
} from '../lib/types';
import { Badge, duration, percent, topicLabel } from './ui';

function Trace({ trace }: { trace: DecisionTrace }) {
  const { decision } = trace;
  return (
    <article className="trace">
      <header className="inspector-technical-heading">
        <div>
          <span className="trace-type">
            {decision.type === 'noul' ? 'N' : decision.type === 'score' ? 'S' : 'C'}
          </span>
          <code>{trace.id}</code>
        </div>
        <span className="trace-summary">
          {decision.type === 'noul'
            ? decision.noul.toFixed(4)
            : decision.type === 'score'
              ? `${decision.score.toFixed(4)} / 4`
              : decision.choice}
        </span>
      </header>
      <div className="trace-body">
        <div className="trace-facts">
          <Badge>
            {decision.type === 'noul'
              ? 'Noul · probability'
              : decision.type === 'score'
                ? 'Score · ordered'
                : 'Choice · categorical'}
          </Badge>
          {decision.type !== 'noul' && (
            <span>
              Confidence <strong>{decision.confidence.toFixed(4)}</strong>
            </span>
          )}
          {trace.threshold !== undefined && (
            <span>
              Threshold <strong>{trace.threshold.toFixed(4)}</strong>
            </span>
          )}
          {trace.accepted !== undefined && (
            <span>
              Accepted{' '}
              <strong className={trace.accepted ? 'text-accent' : ''}>
                {String(trace.accepted)}
              </strong>
            </span>
          )}
          {trace.mappedRating !== undefined && (
            <span>
              Mapped rating <strong>{trace.mappedRating.toFixed(4)} / 5</strong>
            </span>
          )}
        </div>
        {decision.type === 'noul' ? (
          <div className="probability-row">
            <span>True probability</span>
            <div className="probability-track">
              <span style={{ width: percent(decision.noul) }} />
            </div>
            <code>{decision.noul.toFixed(4)}</code>
          </div>
        ) : (
          <div className="distribution">
            {Object.entries(decision.probabilities).map(([label, probability]) => (
              <div className="probability-row" key={label}>
                <span title={decision.type === 'score' ? decision.legend[label] : undefined}>
                  {decision.type === 'score'
                    ? `${label} · ${decision.legend[label] ?? 'Score'}`
                    : label.replaceAll('_', ' ')}
                </span>
                <div className="probability-track">
                  <span style={{ width: percent(probability) }} />
                </div>
                <code>{probability.toFixed(4)}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function AspectSummary({ aspect, traces }: { aspect: AspectDecision; traces: DecisionTrace[] }) {
  return (
    <article className={`inspector-aspect ${aspect.mentioned ? 'is-mentioned' : 'is-absent'}`}>
      <div className="inspector-aspect-heading">
        <h4>{aspect.label}</h4>
        <Badge tone={aspect.mentioned ? 'accent' : 'neutral'}>
          {aspect.mentioned ? 'Mentioned' : 'Not mentioned'}
        </Badge>
      </div>
      <div className="inspector-aspect-values">
        <div className="inspector-value">
          <span>Mention chance</span>
          <strong>{percent(aspect.mentionProbability)}</strong>
        </div>
        <div className="inspector-value">
          <span>Satisfaction</span>
          <strong>
            {aspect.rating === null ? '—' : aspect.rating.toFixed(1)}
            {aspect.rating !== null && <small> / 5</small>}
          </strong>
          {aspect.confidence !== null && <span>{percent(aspect.confidence)} confidence</span>}
        </div>
      </div>
      <p className={`inspector-gate ${aspect.mentioned ? 'text-accent' : ''}`}>
        {aspect.mentioned ? (
          <>
            <Check size={14} aria-hidden="true" /> Used in result
          </>
        ) : (
          'Rating hidden because this aspect is not mentioned.'
        )}
      </p>
      <details className="inspector-details">
        <summary>
          View details <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="traces">
          {traces.map((trace) => (
            <Trace key={trace.id} trace={trace} />
          ))}
        </div>
      </details>
    </article>
  );
}

function OperationalSummary({
  label,
  value,
  confidence,
  trace,
  action,
  noAction,
}: {
  label: string;
  value: string;
  confidence?: number;
  trace?: DecisionTrace;
  action?: DeterministicAction;
  noAction?: string;
}) {
  return (
    <article className="inspector-operation">
      <div className="inspector-operation-heading">
        <h4>{label}</h4>
        <div className="inspector-operation-value">
          <strong>{value}</strong>
          {confidence !== undefined && <span>{percent(confidence)} confidence</span>}
        </div>
      </div>
      {action && (
        <p className="inspector-operation-note">
          {action.triggered ? <Badge tone="warning">{action.label}</Badge> : noAction}
        </p>
      )}
      {trace && (
        <details className="inspector-details">
          <summary>
            View details <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <Trace trace={trace} />
          {action && (
            <div className="inspector-rule">
              <span>{action.triggered ? 'Action triggered' : 'Action not triggered'}</span>
              <code>{action.rule}</code>
              <span>
                Observed {action.value.toFixed(4)} · threshold {action.threshold.toFixed(4)}
              </span>
            </div>
          )}
        </details>
      )}
    </article>
  );
}

export function DecisionInspector({
  result,
  onClose,
}: {
  result: AnalysisResult;
  onClose: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const traceFor = (traceId: string) => result.traces.find((trace) => trace.id === traceId);
  const actionFor = (actionId: DeterministicAction['id']) =>
    result.actions.find((action) => action.id === actionId);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, a[href], summary, input, textarea, select, [tabindex="0"]',
        ) ?? [],
      ).filter((node) => !node.matches(':disabled') && node.getClientRects().length > 0);
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keyboard);
      previousFocus?.focus();
    };
  }, [onClose]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="inspector-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <header className="dialog-header">
          <div className="dialog-heading-icon">
            <Layers3 size={20} />
          </div>
          <div>
            <h2 id={id}>Decision Inspector</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            aria-label="Close Decision Inspector"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="dialog-content">
          <div className="inspector-overview">
            <span>
              {result.decisionCount} decisions · {duration(result.durationMs)}
            </span>
            <button className="button button-small button-secondary" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'JSON copied' : 'Copy JSON'}
            </button>
          </div>
          {copyError && (
            <p role="status" className="text-warning">
              Clipboard access is unavailable in this browser.
            </p>
          )}
          <section className="inspector-section">
            <div className="section-title">
              <h3>Aspect decisions</h3>
            </div>
            <div className="inspector-aspects">
              {result.aspects.map((aspect) => (
                <AspectSummary
                  key={aspect.id}
                  aspect={aspect}
                  traces={result.traces.filter(
                    (trace) =>
                      trace.id === `${aspect.id}_mentioned` ||
                      trace.id === `${aspect.id}_satisfaction`,
                  )}
                />
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <div className="section-title">
              <h3>Customer signal</h3>
            </div>
            <div className="inspector-operational">
              <OperationalSummary
                label="Sentiment"
                value={result.signal.sentiment}
                confidence={result.signal.sentimentConfidence}
                trace={traceFor('overall_sentiment')}
              />
              <OperationalSummary
                label="Main topic"
                value={topicLabel(result.signal.primaryTopic)}
                confidence={result.signal.topicConfidence}
                trace={traceFor('primary_topic')}
              />
              <OperationalSummary
                label="Urgency"
                value={`${result.signal.urgency.toFixed(1)} / 4`}
                confidence={result.signal.urgencyConfidence}
                trace={traceFor('urgency')}
                action={actionFor('urgent')}
                noAction="No urgent follow-up flagged."
              />
              <OperationalSummary
                label="Churn risk"
                value={`${result.signal.churnRisk.toFixed(1)} / 4`}
                confidence={result.signal.churnConfidence}
                trace={traceFor('churn_risk')}
                action={actionFor('retention')}
                noAction="No retention follow-up flagged."
              />
              <OperationalSummary
                label="Escalation chance"
                value={percent(result.signal.escalationProbability)}
                trace={traceFor('escalation_need')}
                action={actionFor('escalate')}
                noAction="No escalation flagged."
              />
            </div>
          </section>
          <section className="inspector-section">
            <details className="inspector-details inspector-feedback">
              <summary>
                Customer feedback <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <blockquote className="input-state">{result.review.reviewText}</blockquote>
              <dl className="metadata-grid">
                <div>
                  <dt>Review ID</dt>
                  <dd>{result.review.reviewId}</dd>
                </div>
                <div>
                  <dt>Product</dt>
                  <dd>{result.review.product}</dd>
                </div>
                {result.review.overallRating !== undefined && (
                  <div>
                    <dt>Original rating</dt>
                    <dd>{result.review.overallRating} / 5</dd>
                  </div>
                )}
              </dl>
            </details>
            <details className="inspector-details inspector-response">
              <summary>
                Response details <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <dl className="metadata-grid">
                <div>
                  <dt>Model</dt>
                  <dd>{result.model}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{result.source}</dd>
                </div>
                <div>
                  <dt>Request ID</dt>
                  <dd className="mono">{result.requestId}</dd>
                </div>
                <div>
                  <dt>Analyzed at</dt>
                  <dd>{new Date(result.analyzedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Input tokens</dt>
                  <dd>{result.usage.inputTokens}</dd>
                </div>
                <div>
                  <dt>Output tokens</dt>
                  <dd>{result.usage.outputTokens}</dd>
                </div>
              </dl>
            </details>
          </section>
        </div>
        <footer className="dialog-footer">
          <span>Decisions by Jev</span>
          <button className="button button-small button-secondary" onClick={onClose}>
            Close inspector
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
