import {
  ArrowUpRight,
  Check,
  CircleMinus,
  FlaskConical,
  History,
  Play,
  Timer,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { DecisionInspector } from '../components/DecisionInspector';
import {
  Badge,
  duration,
  EmptyWorkspace,
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
        eyebrow="Engineering / Benchmark"
        title="Measure what actually happened."
        description="Evaluate Jev on a small, explicit fixture. Keep the evidence close to the claim."
      >
        <Badge>
          <FlaskConical size={12} />
          Evaluation workspace
        </Badge>
      </PageHeader>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <div className="benchmark-setup">
        <section className="panel fixture-panel">
          <div className="panel-heading">
            <div className="heading-with-icon">
              <FlaskConical size={17} />
              <h2>Evaluation set</h2>
            </div>
            <span className="small muted">
              {selected.length} / {LIMITS.benchmarkMax} selected
            </span>
          </div>
          <p className="fixture-intro">
            Choose up to {LIMITS.benchmarkMax} examples. Each sends one real analysis, with at most
            one retry for a transient upstream failure.
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
              <strong>{plural(selected.length, 'review analysis', 'review analyses')}</strong>
              <span>
                {selected.length * DECISION_COUNT} typed decisions · one transient retry at most
              </span>
            </div>
            <button
              className="button button-primary"
              disabled={running || !health?.jevConfigured || !selected.length}
              onClick={() => void start()}
            >
              {running ? (
                <Running>Benchmark running</Running>
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
              Jev is not configured. Configure the server API key to run measurements.
            </p>
          )}
        </section>
        <div className="benchmark-sidebar">
          <section className="panel methodology-panel">
            <div className="panel-heading">
              <h2>What we measure</h2>
              <Timer size={16} />
            </div>
            <div className="methodology-list">
              <div>
                <strong>Request latency</strong>
                <p>Observed end-to-end time for each Jev analysis.</p>
              </div>
              <div>
                <strong>Schema validity</strong>
                <p>Whether the adapter accepted a valid, typed model response.</p>
              </div>
              <div>
                <strong>Fixture agreement</strong>
                <p>Matches against explicitly defined sentiment, topic and mention labels.</p>
              </div>
            </div>
            <div className="panel-note">
              A tiny fixture is a regression check. It does not establish general model accuracy.
            </div>
          </section>
          <section className="panel baseline-panel">
            <div className="panel-heading">
              <h2>LLM baseline</h2>
              <Badge>Not configured</Badge>
            </div>
            <div className="baseline-empty">
              <CircleMinus size={24} />
              <p>
                {run?.baseline.reason ??
                  'No conventional LLM provider is connected. Jev measurements run independently.'}
              </p>
            </div>
            <div className="panel-note">
              No comparative speed or cost claims without a measured baseline.
            </div>
          </section>
          <div className="evaluation-model">
            <span className="status-dot" />
            <span>
              Model: <code>{health?.model ?? JEV_MODEL}</code>
            </span>
          </div>
        </div>
      </div>
      {running && (
        <div className="processing-banner benchmark-processing" role="status">
          <Running>
            Waiting for {plural(selected.length, 'measured Jev analysis', 'measured Jev analyses')}
          </Running>
          <span>Measurements appear when this run completes.</span>
        </div>
      )}
      {run ? (
        <div className="benchmark-results appear">
          <div className="section-title">
            <h2>Measured results</h2>
            <span className="small muted">
              {new Date(run.createdAt).toLocaleTimeString()} · {duration(run.durationMs)} total
            </span>
          </div>
          <div className="metric-grid benchmark-metrics">
            <Metric
              label="Mean request latency"
              value={averageLatency === null ? '—' : duration(averageLatency)}
              detail={plural(latencies.length, 'measured request')}
            />
            <Metric
              label="Valid response schemas"
              value={`${successes.filter((item) => item.schemaValid).length} / ${run.measurements.length}`}
            />
            <Metric
              label="Fixture agreement"
              value={assertions ? `${agreements} / ${assertions}` : '—'}
              detail="Matched explicit assertions"
            />
            <Metric
              label="Failed requests"
              value={run.measurements.length - successes.length}
              tone={successes.length < run.measurements.length ? 'warning' : undefined}
            />
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Individual measurements</h2>
              <Badge>{run.model}</Badge>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Evaluation example</th>
                    <th>Latency</th>
                    <th>Schema</th>
                    <th>Fixture agreement</th>
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
                          ? `${measurement.agreements} / ${measurement.assertions} assertions`
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
                            className="icon-button"
                            aria-label={`Inspect ${measurement.name}`}
                            onClick={() => setInspected(measurement.result ?? null)}
                          >
                            <ArrowUpRight size={15} />
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
      ) : (
        <EmptyWorkspace
          icon={<FlaskConical size={25} />}
          title="Evidence before comparisons."
          description="Run the selected examples to measure actual latency, validate response schemas, and inspect fixture agreement. No benchmark numbers are prefilled."
        />
      )}
      {history.length > 0 && (
        <section className="panel benchmark-history">
          <div className="panel-heading">
            <div className="heading-with-icon">
              <History size={16} />
              <h2>Session history</h2>
            </div>
            <span className="small muted">In memory · clears on refresh</span>
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
