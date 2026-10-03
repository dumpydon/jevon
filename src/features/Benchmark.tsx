import { ArrowUpRight, Check, ChevronDown, FlaskConical, History, Play, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { DecisionInspector } from '../components/DecisionInspector';
import {
  Badge,
  duration,
  ErrorBanner,
  Metric,
  PageHeader,
  plural,
  Running,
} from '../components/ui';
import { runBenchmark, safeError } from '../lib/browser';
import { DECISION_COUNT, JEV_MODEL, LIMITS } from '../lib/config';
import { EVALUATION_EXAMPLES } from '../lib/fixtures';
import type { AnalysisResult, BenchmarkRun, HealthStatus } from '../lib/types';

export function Benchmark({ health }: { health: HealthStatus | null }) {
  const [selected, setSelected] = useState(
    EVALUATION_EXAMPLES.slice(0, LIMITS.benchmarkDefault).map((example) => example.id),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [history, setHistory] = useState<BenchmarkRun[]>([]);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [inspected, setInspected] = useState<AnalysisResult | null>(null);
  const requestRef = useRef(false);
  const run = history.find((item) => item.id === activeRun) ?? null;
  const successes = run?.measurements.filter((item) => item.status === 'success') ?? [];
  const assertions = successes.reduce((sum, item) => sum + item.assertions, 0);
  const agreements = successes.reduce((sum, item) => sum + item.agreements, 0);
  const latencies = successes.flatMap((item) => (item.latencyMs === null ? [] : [item.latencyMs]));
  const averageLatency = latencies.length
    ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
    : null;
  function toggle(id: string) {
    setSelected((values) =>
      values.includes(id)
        ? values.filter((value) => value !== id)
        : values.length < LIMITS.benchmarkMax
          ? [...values, id]
          : values,
    );
  }
  async function start() {
    if (requestRef.current || !health?.jevConfigured || !selected.length) return;
    requestRef.current = true;
    setRunning(true);
    setError(null);
    try {
      const next = await runBenchmark(selected);
      setHistory((values) => [next, ...values].slice(0, 10));
      setActiveRun(next.id);
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setRunning(false);
      requestRef.current = false;
    }
  }
  return (
    <>
      <PageHeader
        title="Benchmark"
        description="Check speed and results on a few example reviews."
      />
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <div className="benchmark-setup benchmark-setup-simple">
        <section className="panel fixture-panel">
          <div className="panel-heading">
            <div className="heading-with-icon">
              <FlaskConical size={17} />
              <h2>Choose examples</h2>
            </div>
            <span className="small muted">
              {selected.length} / {LIMITS.benchmarkMax} selected
            </span>
          </div>
          <p className="fixture-intro">
            Choose up to {LIMITS.benchmarkMax}. Each example sends one Jev request.
          </p>
          <div className="fixture-list">
            {EVALUATION_EXAMPLES.map((example, index) => (
              <label
                key={example.id}
                className={`fixture-option ${selected.includes(example.id) ? 'fixture-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(example.id)}
                  disabled={
                    running ||
                    (!selected.includes(example.id) && selected.length >= LIMITS.benchmarkMax)
                  }
                  onChange={() => toggle(example.id)}
                />
                <span className="fixture-index">{String(index + 1).padStart(2, '0')}</span>
                <span>
                  <strong>{example.name}</strong>
                  <small>{example.text}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="benchmark-start">
            <div>
              <strong>{plural(selected.length, 'Jev request')}</strong>
              <span>{selected.length * DECISION_COUNT} decisions</span>
            </div>
            <button
              className="button button-primary"
              disabled={running || !health?.jevConfigured || !selected.length}
              onClick={() => void start()}
            >
              {running ? (
                <Running>Running benchmark</Running>
              ) : (
                <>
                  <Play size={14} fill="currentColor" />
                  Run benchmark
                </>
              )}
            </button>
          </div>
          {health && !health.jevConfigured && (
            <p className="configuration-note fixture-config">
              Connect Jev on the server to run the benchmark.
            </p>
          )}
          <details className="product-details benchmark-details">
            <summary>
              How this benchmark works
              <ChevronDown size={14} />
            </summary>
            <div className="product-details-content">
              <dl className="benchmark-methodology">
                <div>
                  <dt>Duration</dt>
                  <dd>Observed end-to-end time for each analysis.</dd>
                </div>
                <div>
                  <dt>Valid responses</dt>
                  <dd>Whether Jev returned all decisions in the expected format.</dd>
                </div>
                <div>
                  <dt>Label matches</dt>
                  <dd>Matches against the examples’ sentiment, topic and mention labels.</dd>
                </div>
              </dl>
              <p>
                These few examples are a quick check, not a measure of general accuracy. Each
                request has at most one retry for a temporary upstream error.
              </p>
              <div className="benchmark-baseline">
                <strong>LLM comparison</strong>
                <Badge>Not configured</Badge>
                <p>
                  {run?.baseline.reason ??
                    'No conventional LLM provider is connected. Jev measurements run independently.'}
                </p>
                <p>Speed and cost comparisons need a measured baseline.</p>
              </div>
              <p className="evaluation-model">
                Model: <code>{health?.model ?? JEV_MODEL}</code>
              </p>
            </div>
          </details>
        </section>
      </div>
      {running && (
        <div className="processing-banner benchmark-processing" role="status">
          <Running>Analyzing {plural(selected.length, 'example')}</Running>
          <span>Results appear when the run completes.</span>
        </div>
      )}
      {run ? (
        <div className="benchmark-results appear">
          <div className="section-title">
            <h2>Results</h2>
            <span className="small muted">
              {new Date(run.createdAt).toLocaleTimeString()} · {duration(run.durationMs)} total
            </span>
          </div>
          <div className="metric-grid benchmark-metrics">
            <Metric
              label="Average duration"
              value={averageLatency === null ? '—' : duration(averageLatency)}
              detail={plural(latencies.length, 'request')}
            />
            <Metric
              label="Valid responses"
              value={`${successes.filter((item) => item.schemaValid).length} / ${run.measurements.length}`}
            />
            <Metric
              label="Label matches"
              value={assertions ? `${agreements} / ${assertions}` : '—'}
              detail="Compared with example labels"
            />
            <Metric
              label="Failed"
              value={run.measurements.length - successes.length}
              tone={successes.length < run.measurements.length ? 'warning' : undefined}
            />
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>By example</h2>
              <Badge>{run.model}</Badge>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Example</th>
                    <th>Duration</th>
                    <th>Response</th>
                    <th>Label matches</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Inspect</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {run.measurements.map((measurement) => (
                    <tr key={measurement.id}>
                      <td>
                        <strong>{measurement.name}</strong>
                        {measurement.error && (
                          <small className="table-error block">{measurement.error.message}</small>
                        )}
                      </td>
                      <td className="mono">
                        {measurement.latencyMs === null ? '—' : duration(measurement.latencyMs)}
                      </td>
                      <td>
                        {measurement.schemaValid ? (
                          <span className="schema-valid">
                            <Check size={13} />
                            Valid
                          </span>
                        ) : (
                          <span className="text-warning">
                            <X size={13} />
                            Unavailable
                          </span>
                        )}
                      </td>
                      <td>
                        {measurement.status === 'success'
                          ? `${measurement.agreements} / ${measurement.assertions}`
                          : '—'}
                      </td>
                      <td>
                        <Badge tone={measurement.status === 'success' ? 'positive' : 'negative'}>
                          {measurement.status === 'success' ? 'Complete' : 'Failed'}
                        </Badge>
                      </td>
                      <td>
                        {measurement.result && (
                          <button
                            className="text-button review-table-action"
                            aria-label={`Inspect ${measurement.name}`}
                            onClick={() => setInspected(measurement.result ?? null)}
                          >
                            Inspect
                            <ArrowUpRight size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
      {history.length > 0 && (
        <section className="panel benchmark-history">
          <div className="panel-heading">
            <div className="heading-with-icon">
              <History size={16} />
              <h2>This session</h2>
            </div>
            <span className="small muted">Clears on refresh</span>
          </div>
          <div className="history-list">
            {history.map((entry, index) => (
              <button
                key={entry.id}
                className={`history-entry ${entry.id === activeRun ? 'history-active' : ''}`}
                onClick={() => setActiveRun(entry.id)}
              >
                <span>
                  Run {history.length - index}
                  <small>{new Date(entry.createdAt).toLocaleTimeString()}</small>
                </span>
                <span>{plural(entry.measurements.length, 'example')}</span>
                <span>{duration(entry.durationMs)}</span>
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
      {inspected && <DecisionInspector result={inspected} onClose={() => setInspected(null)} />}
    </>
  );
}
