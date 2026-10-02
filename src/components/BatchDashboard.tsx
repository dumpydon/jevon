import { AspectIcon } from './AnalysisView';
import { Badge, plural } from './ui';
import type { BatchAggregate } from '../lib/types';

export function BatchDashboard({ aggregate }: { aggregate: BatchAggregate }) {
  return (
    <div className="batch-dashboard">
      <section className="panel aggregate-aspects">
        <div className="panel-heading">
          <h2>Aspect satisfaction</h2>
          <span className="small muted">Average · 1–5</span>
        </div>
        <div className="aggregate-bars">
          {aggregate.aspects.map((aspect) => (
            <div key={aspect.id} className="aggregate-row">
              <div className="aggregate-label">
                <AspectIcon id={aspect.id} size={14} />
                <strong>{aspect.label}</strong>
              </div>
              <div className="aggregate-track">
                <span style={{ width: `${((aspect.averageRating ?? 0) / 5) * 100}%` }} />
              </div>
              <div className="aggregate-value">
                <strong>
                  {aspect.averageRating === null ? '—' : aspect.averageRating.toFixed(1)}
                </strong>
                <small>
                  {plural(aspect.mentionCount, 'review')} · {Math.round(aspect.mentionPercent)}%
                </small>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-note">
          Only mentioned aspects count. Percentages use{' '}
          {plural(aggregate.successful, 'successful review')}.
        </div>
      </section>
      <section className="panel aggregate-signal">
        <div className="panel-heading">
          <h2>Customer signal</h2>
          <Badge>{plural(aggregate.successful, 'review')}</Badge>
        </div>
        <div
          className="sentiment-chart"
          aria-label={`Sentiment: ${aggregate.sentimentCounts.positive} positive, ${aggregate.sentimentCounts.neutral} neutral, ${aggregate.sentimentCounts.negative} negative`}
        >
          {(['positive', 'neutral', 'negative'] as const).map(
            (sentiment) =>
              aggregate.sentimentCounts[sentiment] > 0 && (
                <span
                  className={`sentiment-${sentiment}`}
                  key={sentiment}
                  style={{
                    width: `${(aggregate.sentimentCounts[sentiment] / aggregate.successful) * 100}%`,
                  }}
                />
              ),
          )}
        </div>
        <div className="sentiment-legend">
          {(['positive', 'neutral', 'negative'] as const).map((sentiment) => (
            <div key={sentiment}>
              <span className={`legend-dot sentiment-${sentiment}`} />
              <span>{sentiment}</span>
              <strong>{aggregate.sentimentCounts[sentiment]}</strong>
            </div>
          ))}
        </div>
        <div className="aggregate-insights">
          <div>
            <span>Weakest aspect</span>
            <strong>{aggregate.weakestAspect ?? 'No aspect ratings'}</strong>
          </div>
          <div>
            <span>Strongest aspect</span>
            <strong>{aggregate.strongestAspect ?? 'No aspect ratings'}</strong>
          </div>
          <div>
            <span>High churn risk</span>
            <strong>
              {aggregate.highRiskCount}
              <small> {aggregate.highRiskCount === 1 ? 'review' : 'reviews'}</small>
            </strong>
          </div>
          <div>
            <span>Escalation candidates</span>
            <strong>
              {aggregate.escalationCount}
              <small> {aggregate.escalationCount === 1 ? 'review' : 'reviews'}</small>
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}
