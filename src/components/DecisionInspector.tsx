import { Check, ChevronDown, Copy, Layers3, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import type { AnalysisResult, DecisionTrace } from '../lib/types';
import { Badge, duration, percent } from './ui';

function Trace({ trace }: { trace: DecisionTrace }) {
  const { decision } = trace;
  return (
    <details className="trace" open>
      <summary>
        <div>
          <span className="trace-type">
            {decision.type === 'noul' ? 'N' : decision.type === 'score' ? 'S' : 'C'}
          </span>
          <code>{trace.id}</code>
        </div>
        <span className="trace-summary">
          {decision.type === 'noul'
            ? percent(decision.noul)
            : decision.type === 'score'
              ? `${decision.score.toFixed(2)} / 4`
              : decision.choice}
          <ChevronDown size={14} />
        </span>
      </summary>
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
              Confidence <strong>{percent(decision.confidence)}</strong>
            </span>
          )}
          {trace.threshold !== undefined && (
            <span>
              Threshold <strong>{trace.threshold.toFixed(2)}</strong>
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
              Mapped rating <strong>{trace.mappedRating.toFixed(2)} / 5</strong>
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
    </details>
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
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, a[href], summary, input, textarea, select, [tabindex="0"]',
      );
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
            <div className="eyebrow">Model judgment → application rules</div>
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
          <div className="inspector-metadata">
            <Badge tone="accent">Real Jev response</Badge>
            <span>{result.model}</span>
            <span>{result.decisionCount} decisions</span>
            <span>{duration(result.durationMs)}</span>
          </div>
          <section className="inspector-section">
            <div className="section-title">
              <h3>Input state</h3>
              <span className="mono">reviewText</span>
            </div>
            <blockquote className="input-state">{result.review.reviewText}</blockquote>
            <p className="section-note">All decisions evaluate this one shared semantic state.</p>
          </section>
          <section className="inspector-section">
            <div className="section-title">
              <h3>Typed decisions</h3>
              <span className="muted">{result.traces.length} returned</span>
            </div>
            <p className="section-note">
              Noul returns a probability. Score uses 0–4; satisfaction maps to 1–5 by adding 1.
              Distributions below are returned by Jev.
            </p>
            <div className="traces">
              {result.traces.map((trace) => (
                <Trace key={trace.id} trace={trace} />
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <div className="section-title">
              <h3>Deterministic actions</h3>
              <Badge>Application layer</Badge>
            </div>
            <div className="inspector-actions">
              {result.actions.map((action) => (
                <div key={action.id}>
                  <div>
                    <strong>{action.label}</strong>
                    <Badge tone={action.triggered ? 'warning' : 'neutral'}>
                      {action.triggered ? 'Triggered' : 'Not triggered'}
                    </Badge>
                  </div>
                  <code>{action.rule}</code>
                  <p>
                    Observed {action.value.toFixed(2)} · threshold {action.threshold.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <div className="section-title">
              <h3>Response metadata</h3>
              <button className="button button-small button-secondary" onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'JSON copied' : 'Copy response JSON'}
              </button>
            </div>
            {copyError && (
              <p role="status" className="text-warning">
                Clipboard access is unavailable in this browser.
              </p>
            )}
            <dl className="metadata-grid">
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
          </section>
        </div>
        <footer className="dialog-footer">
          <span>Semantic decisions by Jev. Actions by explicit rules.</span>
          <button className="button button-small button-secondary" onClick={onClose}>
            Close inspector
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
