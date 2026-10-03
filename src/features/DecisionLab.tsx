import { CircleDot, Command, Play, RotateCcw, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { AnalysisView } from '../components/AnalysisView';
import { DecisionInspector } from '../components/DecisionInspector';
import { PointCloudCube } from '../components/PointCloudCube';
import { ErrorBanner, PageHeader, Running } from '../components/ui';
import { analyzeReview, safeError } from '../lib/browser';
import { LIMITS } from '../lib/config';
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
        title="Make sense of customer feedback."
        description="Paste a review. See what matters."
      />
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <div className="lab-grid">
        <div className="input-column">
          <section className="panel feedback-panel">
            <div className="panel-heading">
              <div className="heading-with-icon">
                <Command size={17} />
                <h2>Customer feedback</h2>
              </div>
            </div>
            <div className="feedback-content">
              <div className="input-toolbar">
                <label htmlFor="example-review">Try an example</label>
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
                aria-keyshortcuts="Control+Enter Meta+Enter"
                placeholder="Paste customer feedback or choose an example…"
                maxLength={LIMITS.maxCharacters}
              />
              <div className="textarea-footer">
                <span>{sample ? 'Example · editable' : 'Customer review'}</span>
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
                <span className="keyboard-hint" title="Analyze with Command or Control + Enter">
                  ⌘ / Ctrl ↵
                </span>
              </div>
              {health && !ready && (
                <p className="configuration-note">
                  <CircleDot size={14} />
                  Analysis is unavailable. Check the server configuration.
                </p>
              )}
            </div>
          </section>
        </div>
        <div className="output-column">
          {running && (
            <div className="processing-banner" role="status">
              <Running>Analyzing feedback</Running>
            </div>
          )}
          {stale && !running && (
            <div className="stale-note">Feedback changed. Analyze again to update the result.</div>
          )}
          {result ? (
            <AnalysisView result={result} onInspect={() => setInspecting(true)} />
          ) : (
            <div className="panel result-placeholder">
              <div className="panel-heading">
                <div className="heading-with-icon">
                  <Sparkles size={17} />
                  <h2>Your result</h2>
                </div>
              </div>
              <div className="awaiting-visual" aria-hidden="true">
                <PointCloudCube loading={running} />
              </div>
              <div className="placeholder-copy lab-empty-copy">
                <h3>What stands out?</h3>
                <p>Analyze feedback to see its topic, sentiment and aspect ratings.</p>
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
