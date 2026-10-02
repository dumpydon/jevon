import {
  ArrowUpRight,
  Braces,
  ChevronRight,
  Command,
  ExternalLink,
  FileSpreadsheet,
  FlaskConical,
  Code2,
  Menu,
  Radio,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { getHealth } from './lib/browser';
import { JEV_MODEL } from './lib/config';
import type { HealthStatus } from './lib/types';
import { BatchAnalyzer } from './features/BatchAnalyzer';
import { Benchmark } from './features/Benchmark';
import { DecisionLab } from './features/DecisionLab';

type Page = 'lab' | 'batch' | 'benchmark';
const navigation = [
  { id: 'lab', label: 'Decision Lab', icon: Command },
  { id: 'batch', label: 'Batch Analyzer', icon: FileSpreadsheet },
  { id: 'benchmark', label: 'Benchmark', icon: FlaskConical },
] as const;
function pageFromHash(): Page {
  const page = window.location.hash.slice(1);
  return page === 'batch' || page === 'benchmark' ? page : 'lab';
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="brand-mark" aria-hidden="true">
      <path
        d="M7 8h10l8 8-8 8H7l8-8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M7 8v16M15 16h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then(setHealth)
      .catch(() => {
        if (!controller.signal.aborted) setHealthFailed(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      setMobileOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [mobileOpen]);
  const state = health?.jevConfigured
    ? 'Jev configured'
    : health
      ? 'Jev not configured'
      : healthFailed
        ? 'Server unavailable'
        : 'Checking connection';
  function navigate(next: Page) {
    setPage(next);
    setMobileOpen(false);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return (
    <div className="app-shell">
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to workspace
      </a>
      <div className="mobile-header">
        <a
          href="#lab"
          className="mobile-brand"
          onClick={(event) => {
            event.preventDefault();
            navigate('lab');
          }}
        >
          <Logo />
          <strong>Jevon</strong>
        </a>
        <span className="mobile-page-name">
          {navigation.find((item) => item.id === page)?.label}
        </span>
        <button
          className="icon-button"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          aria-controls="sidebar"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside id="sidebar" className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <a
          className="brand"
          href="#lab"
          onClick={(event) => {
            event.preventDefault();
            navigate('lab');
          }}
        >
          <Logo />
          <div>
            <strong>Jevon</strong>
            <span>Decision Intelligence</span>
          </div>
          <span className="version-pill">v1</span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">
            <Braces size={14} />
          </span>
          <div>
            <strong>Feedback engine</strong>
            <span>Local workspace</span>
          </div>
          <ChevronRight size={13} />
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <div className="nav-label">Workspace</div>
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav-link ${page === id ? 'nav-link-active' : ''}`}
              aria-current={page === id ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(id);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
              {page === id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-principle">
          <div className="principle-icon">
            <ShieldCheck size={18} />
          </div>
          <strong>Decisions you can inspect.</strong>
          <p>
            Typed model outputs.
            <br />
            Explicit application rules.
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className={`system-status ${health?.jevConfigured ? 'system-ready' : ''}`}>
            <div>
              <Radio size={15} />
              <span>System status</span>
            </div>
            <strong>
              <span
                className={`status-dot ${healthFailed || (health && !health.jevConfigured) ? 'status-warning' : !health ? 'status-pending' : ''}`}
              />
              {state}
            </strong>
            <code>{health?.model ?? JEV_MODEL}</code>
          </div>
          <a
            className="github-link"
            href="https://github.com/dumpydon/jevon"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={16} />
            View source
            <ArrowUpRight size={14} />
          </a>
          <div className="sidebar-footer">
            <span>Built around Jev System-One</span>
            <a
              href="https://www.typesafe.ai/"
              aria-label="TypeSafe AI website"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <div className="breadcrumb">
            <span>Jevon</span>
            <ChevronRight size={12} />
            <strong>{navigation.find((item) => item.id === page)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="privacy-note">
              <ShieldCheck size={13} />
              Server-side inference
            </span>
            <span className={`connection-indicator ${health?.jevConfigured ? 'connected' : ''}`}>
              <span
                className={`status-dot ${healthFailed || (health && !health.jevConfigured) ? 'status-warning' : !health ? 'status-pending' : ''}`}
              />
              {health?.jevConfigured
                ? 'Ready'
                : health
                  ? 'Needs configuration'
                  : healthFailed
                    ? 'Offline'
                    : 'Connecting'}
            </span>
          </div>
        </div>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <div hidden={page !== 'lab'}>
            <DecisionLab health={health} />
          </div>
          <div hidden={page !== 'batch'}>
            <BatchAnalyzer health={health} />
          </div>
          <div hidden={page !== 'benchmark'}>
            <Benchmark health={health} />
          </div>
          <footer className="workspace-footer">
            <span>AI Decision Engine for Customer Feedback</span>
            <span>Semantic judgment. Deterministic action.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
