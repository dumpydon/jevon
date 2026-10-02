import {
  ArrowUpRight,
  Check,
  Download,
  FileSpreadsheet,
  Inbox,
  Square,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BatchDashboard } from '../components/BatchDashboard';
import { ReviewTable } from '../components/ReviewTable';
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
import { analyzeBatch, safeError } from '../lib/browser';
import { LIMITS } from '../lib/config';
import { parseReviewCsv } from '../lib/csv';
import { aggregateResults } from '../lib/decisions/aggregation';
import { SAMPLE_REVIEWS } from '../lib/fixtures';
import type {
  AnalysisResult,
  BatchItem,
  BatchResult,
  HealthStatus,
  ReviewInput,
} from '../lib/types';

function downloadSample() {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [
    'review_id,product,overall_rating,review_text',
    ...SAMPLE_REVIEWS.map((review) =>
      [review.reviewId, review.product, '', review.reviewText].map(quote).join(','),
    ),
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jevon-sample-reviews.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export function BatchAnalyzer({ health }: { health: HealthStatus | null }) {
  const [reviews, setReviews] = useState<ReviewInput[]>([]);
  const [source, setSource] = useState('');
  const [quantity, setQuantity] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [inspected, setInspected] = useState<AnalysisResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const currentItems = useRef<BatchItem[]>([]);
  const requestRef = useRef(false);
  const aggregate = result?.aggregate ?? aggregateResults(items);
  useEffect(() => () => abortRef.current?.abort(), []);
  function prepare(next: ReviewInput[], name: string) {
    setReviews(next);
    setSource(name);
    setQuantity(Math.min(3, next.length));
    setItems([]);
    setResult(null);
    setTotal(0);
    setCancelled(false);
    setError(null);
  }
  async function loadFile(file?: File) {
    if (!file || running || loadingFile) return;
    setError(null);
    setLoadingFile(true);
    try {
      if (file.size > LIMITS.maxCsvBytes)
        throw new Error(`CSV files must be ${LIMITS.maxCsvBytes / (1024 * 1024)} MB or smaller.`);
      if (!file.name.toLowerCase().endsWith('.csv'))
        throw new Error('Please choose a .csv file with a review_text column.');
      prepare(parseReviewCsv(await file.text()), file.name);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : 'The CSV could not be read.' });
    } finally {
      setLoadingFile(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function run() {
    if (requestRef.current || !health?.jevConfigured || !reviews.length) return;
    requestRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const selected = reviews.slice(0, quantity);
    currentItems.current = [];
    setItems([]);
    setResult(null);
    setTotal(selected.length);
    setCancelled(false);
    setError(null);
    setRunning(true);
    try {
      await analyzeBatch(
        selected,
        (event) => {
          if (event.type === 'start') setTotal(event.total);
          if (event.type === 'progress') {
            currentItems.current = [...currentItems.current, event.item];
            setItems(currentItems.current);
          }
          if (event.type === 'complete') {
            setResult(event.result);
            setItems(event.result.items);
            setCancelled(event.result.cancelled);
          }
        },
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) {
        setCancelled(true);
        setItems(currentItems.current);
      } else setError(safeError(cause));
    } finally {
      setRunning(false);
      requestRef.current = false;
      abortRef.current = null;
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Workspace / Batch Analyzer"
        title="Many reviews. One clear signal."
        description="Validate a small dataset, analyze it with Jev, and inspect the aggregate."
      >
        <button className="button button-secondary button-small" onClick={downloadSample}>
          <Download size={14} />
          Sample CSV
        </button>
      </PageHeader>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <section className="panel dataset-panel">
        <div className="panel-heading">
          <div className="heading-with-icon">
            <FileSpreadsheet size={17} />
            <h2>Review dataset</h2>
          </div>
          <Badge>Up to {LIMITS.maxReviews} reviews</Badge>
        </div>
        <div className="dataset-content">
          <div
            className={`dropzone ${dragging ? 'dropzone-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!running) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void loadFile(event.dataTransfer.files[0]);
            }}
          >
            <div className="upload-icon">
              <UploadCloud size={23} />
            </div>
            <div>
              <h3>{source || 'Drop a CSV file here'}</h3>
              <p>
                {reviews.length
                  ? `${plural(reviews.length, 'validated review')} · ready to preview`
                  : `Comma-separated · ${LIMITS.maxCsvBytes / (1024 * 1024)} MB maximum`}
              </p>
            </div>
            <button
              className="button button-secondary button-small"
              disabled={running || loadingFile}
              onClick={() => fileRef.current?.click()}
            >
              {loadingFile ? (
                <Running>Reading file</Running>
              ) : reviews.length ? (
                'Replace file'
              ) : (
                'Choose file'
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-label="Upload review CSV"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
          </div>
          <div className="dataset-schema">
            <span>
              <code>review_text</code> required
            </span>
            <span>
              <code>review_id</code>
              <code>product</code>
              <code>overall_rating</code> optional
            </span>
            <button
              className="text-button"
              disabled={running || loadingFile}
              onClick={() => prepare(SAMPLE_REVIEWS, 'Bundled sample dataset')}
            >
              Load sample dataset
              <ArrowUpRight size={13} />
            </button>
          </div>
          {reviews.length > 0 && (
            <div className="dataset-preview appear">
              <div className="section-title">
                <h3>Preview & request budget</h3>
                <Badge tone="accent">
                  <Check size={11} />
                  Validated
                </Badge>
              </div>
              <div className="review-preview-list">
                {reviews.slice(0, quantity).map((review, index) => (
                  <div key={review.reviewId} className="review-preview">
                    <span className="preview-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>
                        {review.reviewId}
                        <span>{review.product}</span>
                      </strong>
                      <p>{review.reviewText}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="batch-run-actions">
                <div className="batch-quantity">
                  <label htmlFor="batch-quantity">Analyze first</label>
                  <select
                    id="batch-quantity"
                    value={quantity}
                    disabled={running}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                  >
                    {reviews.map((_, index) => (
                      <option key={index + 1} value={index + 1}>
                        {index + 1} review{index === 0 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                  <span>of {reviews.length}</span>
                </div>
                <div>
                  <span className="small muted">
                    {plural(quantity, 'review analysis', 'review analyses')} · concurrency{' '}
                    {LIMITS.concurrency}
                  </span>
                  <button
                    className="button button-primary"
                    disabled={running || !health?.jevConfigured}
                    onClick={() => void run()}
                  >
                    {running ? (
                      <Running>Analyzing batch</Running>
                    ) : (
                      <>
                        Analyze {plural(quantity, 'review')}
                        <ArrowUpRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="request-note">
                At most one retry per review for transient upstream errors.
              </p>
              {health && !health.jevConfigured && (
                <p className="configuration-note">
                  Jev is not configured. The dataset can be previewed; analysis needs the server API
                  key.
                </p>
              )}
            </div>
          )}
        </div>
      </section>
      {running || items.length > 0 || cancelled || total > 0 ? (
        <div className="batch-results appear">
          {running && (
            <div className="batch-progress" role="status">
              <div>
                <Running>Processing review decisions</Running>
                <span>
                  {items.length} / {total} complete
                </span>
                <button
                  className="button button-small button-secondary"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square size={11} />
                  Cancel batch
                </button>
              </div>
              <progress
                value={items.length}
                max={total || 1}
                aria-label="Completed batch reviews"
              />
              <p>
                Up to {LIMITS.concurrency} requests at a time. Completed results are retained on
                cancellation.
              </p>
            </div>
          )}
          {cancelled && (
            <div className="cancelled-note" role="status">
              <Square size={13} />
              Batch cancelled. {plural(items.length, 'completed review')} retained. In-flight
              requests may already have been processed.
            </div>
          )}
          <div className="metric-grid batch-metrics">
            <Metric label="Completed reviews" value={`${items.length} / ${total}`} />
            <Metric label="Successful" value={aggregate.successful} tone="accent" />
            <Metric
              label="Failed"
              value={aggregate.failed}
              tone={aggregate.failed ? 'warning' : undefined}
            />
            <Metric label="Typed decisions" value={aggregate.totalDecisions} />
            <Metric
              label="Processing time"
              value={result ? duration(result.durationMs) : running ? 'Running' : '—'}
            />
          </div>
          {aggregate.successful > 0 && <BatchDashboard aggregate={aggregate} />}
          <ReviewTable items={items} running={running} onInspect={setInspected} />
        </div>
      ) : (
        <EmptyWorkspace
          icon={<Inbox size={26} />}
          title="Your dataset, made actionable."
          description="Upload a CSV or load the bundled sample. Preview the reviews and choose how many to analyze before any Jev requests are sent."
        >
          <div className="empty-badges">
            <Badge>{LIMITS.maxReviews}-review limit</Badge>
            <Badge>Partial failures handled</Badge>
            <Badge>Inspectable results</Badge>
          </div>
        </EmptyWorkspace>
      )}
      {inspected && <DecisionInspector result={inspected} onClose={() => setInspected(null)} />}
    </>
  );
}
