import { AlertCircle, ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Topic } from '../lib/types';
import { ASPECTS } from '../lib/types';

export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const duration = (value: number) =>
  value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
export const topicLabel = (topic: Topic) =>
  ASPECTS.find((aspect) => aspect.id === topic)?.label ?? 'Other';
export const plural = (count: number, singular: string, multiple = `${singular}s`) =>
  `${count} ${count === 1 ? singular : multiple}`;

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="header-extra">{children}</div>}
    </header>
  );
}

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: { message: string; requestId?: string } | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <AlertCircle size={17} />
      <div>
        <strong>Request could not be completed</strong>
        <p>{error.message}</p>
        {error.requestId && <span className="mono">Request {error.requestId}</span>}
      </div>
      {onDismiss && (
        <button className="text-button" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'positive' | 'negative' | 'warning';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyWorkspace({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-workspace">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

export function Running({ children }: { children: ReactNode }) {
  return (
    <span className="running">
      <LoaderCircle size={16} className="spinner" />
      {children}
    </span>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="external-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={13} />
    </a>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
