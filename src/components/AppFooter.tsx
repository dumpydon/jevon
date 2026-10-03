import { useEffect, useState } from 'react';

const indiaTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

export function AppFooter() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="footer-signature">
          <span className="footer-copyright">© 2026 Dumpydon</span>
          <span className="footer-separator" aria-hidden="true">
            ·
          </span>
          <span>
            Built in India <span aria-hidden="true">🇮🇳</span>
          </span>
        </div>
        <div className="footer-clock" title="Indian Standard Time · Asia/Kolkata" aria-live="off">
          <span className="footer-clock-dot" aria-hidden="true" />
          <span>
            IST <span aria-hidden="true">·</span>
          </span>
          <time dateTime={now.toISOString()}>{indiaTime.format(now)}</time>
        </div>
      </div>
    </footer>
  );
}
