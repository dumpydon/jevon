import {
  ArrowDown,
  ArrowRight,
  Braces,
  CircleDot,
  Command,
  Layers3,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { AnalysisView } from '../components/AnalysisView';
import { DecisionInspector } from '../components/DecisionInspector';
import { Badge, ErrorBanner, PageHeader, Running } from '../components/ui';
import { analyzeReview, safeError } from '../lib/browser';
import { DECISION_COUNT, LIMITS } from '../lib/config';
import { EVALUATION_EXAMPLES } from '../lib/fixtures';
import type { AnalysisResult, HealthStatus } from '../lib/types';

export function DecisionLab({ health }: { health: HealthStatus | null }) {
  const mixed = EVALUATION_EXAMPLES.find((example) => example.id === 'mixed')!;
  const [text, setText] = useState(mixed.text);
  const [sample, setSample] = useState('mixed');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const requestRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ready = health?.jevConfigured === true;
  const stale = result !== null && result.review.reviewText.trim() !== text.trim();
  async function analyze() {
    if (requestRef.current || !ready || !text.trim() || text.length > LIMITS.maxCharacters) return;
    requestRef.current = true;
    setRunning(true);
    setError(null);
    try {
      setResult(await analyzeReview(text));
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setRunning(false);
      requestRef.current = false;
    }
  }
  const onInputKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void analyze();
    }
  };
  function clear() {
    setText('');
    setSample('');
    setError(null);
    setResult(null);
    inputRef.current?.focus();
  }
  return (
    <>
      <PageHeader
        eyebrow="Workspace / Decision Lab"
        title="Feedback in. Decisions out."
        description="Turn customer feedback into typed, confidence-aware operational signals."
      >
        <Badge>
          <span className="status-dot" />
          Jev System-One
        </Badge>
      </PageHeader>
      <div className="technical-strip">
        <span>
          <Braces size={14} />
          {DECISION_COUNT} typed decisions
        </span>
        <span>
          <Layers3 size={14} />
          One shared state
        </span>
        <span>
          <ShieldCheck size={14} />
          Inspectable application rules
        </span>
      </div>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <div className="lab-grid">
        <div className="input-column">
          <section className="panel feedback-panel">
            <div className="panel-heading">
              <div className="heading-with-icon">
                <Command size={17} />
                <h2>Customer feedback</h2>
              </div>
              <span className="step-label">01 / Input</span>
            </div>
            <div className="feedback-content">
              <div className="input-toolbar">
                <label htmlFor="example-review">Start with an example</label>
                <select
                  id="example-review"
                  value={sample}
                  disabled={running}
                  onChange={(event) => {
                    const example = EVALUATION_EXAMPLES.find(
                      (item) => item.id === event.target.value,
                    );
                    setSample(event.target.value);
                    if (example) {
                      setText(example.text);
                      setError(null);
                    }
                  }}
                >
                  <option value="">Custom feedback</option>
                  {EVALUATION_EXAMPLES.map((example) => (
                    <option key={example.id} value={example.id}>
                      {example.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="sr-only" htmlFor="feedback">
                Customer feedback
              </label>
              <textarea
                id="feedback"
                ref={inputRef}
                value={text}
                disabled={running}
                onChange={(event) => {
                  setText(event.target.value);
                  setSample('');
                }}
                onKeyDown={onInputKey}
                placeholder="The battery barely lasts until evening, but the camera is fantastic and performance is smooth…"
                maxLength={LIMITS.maxCharacters}
              />
              <div className="textarea-footer">
                <span>{sample ? 'Sample text · editable' : 'Sent to Jev only on analysis'}</span>
                <span className="mono">
                  {text.length.toLocaleString()} / {LIMITS.maxCharacters.toLocaleString()}
                </span>
              </div>
              <div className="input-actions">
                <button
                  className="button button-primary"
                  disabled={running || !ready || !text.trim()}
                  onClick={() => void analyze()}
                >
                  {running ? (
                    <Running>Waiting for Jev</Running>
                  ) : (
                    <>
                      <Play size={14} fill="currentColor" />
                      Analyze with Jev
                    </>
                  )}
                </button>
                <button
                  className="button button-ghost"
                  disabled={running || !text.length}
                  onClick={clear}
                >
                  <RotateCcw size={14} />
                  Clear
                </button>
                <span className="keyboard-hint">⌘ / Ctrl ↵</span>
              </div>
              <p className="request-note">
                Feedback is sent to Jev on analysis. {DECISION_COUNT} typed decisions per review.
              </p>
              {health && !ready && (
                <p className="configuration-note">
                  <CircleDot size={14} />
                  Jev is not configured. Add TYPESAFE_API_KEY to the server environment to analyze
                  feedback.
                </p>
              )}
            </div>
          </section>
          <section className="decision-flow" aria-label="How analysis works">
            <div className="section-title">
              <h3>A small, inspectable pipeline</h3>
              <Badge>System-One</Badge>
            </div>
            <div className="flow-stages">
              <div>
                <span className="flow-number">1</span>
                <strong>Shared state</strong>
                <small>Your review text</small>
              </div>
              <ArrowRight size={16} />
              <div className={running ? 'flow-evaluating' : ''}>
                <span className="flow-number">2</span>
                <strong>Typed decisions</strong>
                <small>Noul · Score · Choice</small>
              </div>
              <ArrowRight size={16} />
              <div>
                <span className="flow-number">3</span>
                <strong>Explicit rules</strong>
                <small>Gates & actions</small>
              </div>
            </div>
            <p>
              Jev makes semantic judgments. Jevon applies the thresholds that turn them into action.
            </p>
          </section>
          <div className="schema-note">
            <Braces size={19} />
            <div>
              <strong>Bounded output, by design.</strong>
              <p>
                7 mention probabilities + 7 satisfaction scores + 5 operational signals, evaluated
                over the same feedback.
              </p>
            </div>
          </div>
        </div>
        <div className="output-column">
          {running && (
            <div className="processing-banner" role="status">
              <Running>Evaluating {DECISION_COUNT} decisions with Jev</Running>
              <span>Results appear when the server responds.</span>
            </div>
          )}
          {stale && !running && (
            <div className="stale-note">
              Showing the previous review. Analyze your edited feedback to update these results.
            </div>
          )}
          {result ? (
            <AnalysisView result={result} onInspect={() => setInspecting(true)} />
          ) : (
            <div className="panel result-placeholder">
              <div className="panel-heading">
                <div className="heading-with-icon">
                  <Sparkles size={17} />
                  <h2>Decision workspace</h2>
                </div>
                <span className="step-label">02 / Output</span>
              </div>
              <div className="awaiting-visual" aria-hidden="true">
                <div className="visual-node">
                  <Braces size={23} />
                </div>
                <div className="connector-line" />
                <div className="visual-decisions">
                  <span>N</span>
                  <span>S</span>
                  <span>C</span>
                </div>
                <div className="connector-line" />
                <div className="visual-signal">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div className="placeholder-copy">
                <Badge>Awaiting analysis</Badge>
                <h3>The signal is in the details.</h3>
                <p>
                  See what the customer cares about, how strongly they feel, and which actions meet
                  your rules.
                </p>
              </div>
              <div className="output-preview">
                <div>
                  <span className="preview-number">01</span>
                  <div>
                    <strong>Customer signal</strong>
                    <small>Sentiment, topic, urgency & risk</small>
                  </div>
                  <CircleDot size={15} />
                </div>
                <div>
                  <span className="preview-number">02</span>
                  <div>
                    <strong>Aspect analysis</strong>
                    <small>7 confidence-gated product aspects</small>
                  </div>
                  <CircleDot size={15} />
                </div>
                <div>
                  <span className="preview-number">03</span>
                  <div>
                    <strong>Decision trace</strong>
                    <small>Real probabilities, scores & rules</small>
                  </div>
                  <CircleDot size={15} />
                </div>
              </div>
              <div className="placeholder-foot">
                <ArrowDown size={14} />
                <span>Choose an example and analyze to explore.</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {inspecting && result && (
        <DecisionInspector result={result} onClose={() => setInspecting(false)} />
      )}
    </>
  );
}
