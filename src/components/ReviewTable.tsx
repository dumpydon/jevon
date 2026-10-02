import { ArrowUpRight, Search, X } from 'lucide-react';
import { useState } from 'react';
import { THRESHOLDS } from '../lib/config';
import type { AnalysisResult, BatchItem } from '../lib/types';
import { Badge, topicLabel } from './ui';

export function ReviewTable({
  items,
  running,
  onInspect,
}: {
  items: BatchItem[];
  running: boolean;
  onInspect: (result: AnalysisResult) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const visibleItems = items.filter((item) => {
    const matchesSearch = `${item.review.reviewId} ${item.review.product} ${item.review.reviewText}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesFilter =
      filter === 'all' ||
      filter === item.status ||
      (item.status === 'success' &&
        (filter === item.result.signal.sentiment ||
          (filter === 'high-risk' && item.result.signal.churnRisk >= THRESHOLDS.churnRisk)));
    return matchesSearch && matchesFilter;
  });
  return (
    <section className="panel review-table-panel">
      <div className="panel-heading">
        <h2>Review decisions</h2>
        <span className="small muted">{visibleItems.length} shown</span>
      </div>
      <div className="table-toolbar">
        <div className="search-input">
          <Search size={15} />
          <label className="sr-only" htmlFor="review-search">
            Search analyzed reviews
          </label>
          <input
            id="review-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ID, product or feedback…"
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear review search"
              onClick={() => setSearch('')}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <label className="sr-only" htmlFor="review-filter">
          Filter reviews
        </label>
        <select
          id="review-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All results</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
          <option value="high-risk">High churn risk</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Review</th>
              <th>Product</th>
              <th>Sentiment</th>
              <th>Primary topic</th>
              <th>Churn risk</th>
              <th>Escalation</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Inspect</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr
                key={item.review.reviewId}
                onClick={item.status === 'success' ? () => onInspect(item.result) : undefined}
                className={item.status === 'success' ? 'inspectable-row' : ''}
              >
                <td className="mono">{item.review.reviewId}</td>
                <td>{item.review.product}</td>
                {item.status === 'success' ? (
                  <>
                    <td>
                      <Badge
                        tone={
                          item.result.signal.sentiment === 'positive'
                            ? 'positive'
                            : item.result.signal.sentiment === 'negative'
                              ? 'negative'
                              : 'neutral'
                        }
                      >
                        {item.result.signal.sentiment}
                      </Badge>
                    </td>
                    <td>{topicLabel(item.result.signal.primaryTopic)}</td>
                    <td>{item.result.signal.churnRisk.toFixed(1)} / 4</td>
                    <td>
                      {item.result.signal.escalationProbability >= THRESHOLDS.escalation ? (
                        <Badge tone="warning">Candidate</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className="table-status">
                        <span className="status-dot" />
                        Complete
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Inspect decisions for ${item.review.reviewId}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onInspect(item.result);
                        }}
                      >
                        <ArrowUpRight size={15} />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td colSpan={4}>
                      <span className="table-error">{item.error.message}</span>
                    </td>
                    <td>
                      <Badge tone="negative">Failed</Badge>
                    </td>
                    <td>—</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visibleItems.length === 0 && (
        <div className="table-empty">
          {running && items.length === 0
            ? 'Waiting for the first completed review.'
            : 'No reviews match these filters.'}
        </div>
      )}
    </section>
  );
}
