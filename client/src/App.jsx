import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const STATUS_META = {
  applied: { label: 'Applied', color: '#3b82f6', icon: '📨' },
  assessment: { label: 'Assessment', color: '#a855f7', icon: '📝' },
  interview: { label: 'Interview', color: '#f59e0b', icon: '🎙️' },
  offer: { label: 'Offer', color: '#10b981', icon: '🎉' },
  rejected: { label: 'Rejected', color: '#ef4444', icon: '🚫' },
};
const STATUS_ORDER = ['applied', 'assessment', 'interview', 'offer', 'rejected'];

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const day = 86400000;
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (diff < day) return `${Math.round(diff / 3600000)}h ago`;
  const days = Math.round(diff / day);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: '#64748b', icon: '•' };
  return (
    <span className="badge" style={{ '--c': m.color }}>
      <span className="badge-dot" /> {m.label}
    </span>
  );
}

function StatCard({ status, count, active, onClick }) {
  const m = STATUS_META[status];
  return (
    <button
      className={`stat ${active ? 'stat-active' : ''}`}
      style={{ '--c': m.color }}
      onClick={onClick}
    >
      <div className="stat-icon">{m.icon}</div>
      <div className="stat-body">
        <div className="stat-count">{count}</div>
        <div className="stat-label">{m.label}</div>
      </div>
    </button>
  );
}

function Pipeline({ status }) {
  const stages = ['applied', 'assessment', 'interview', 'offer'];
  const rejected = status === 'rejected';
  const activeIdx = stages.indexOf(status);
  return (
    <div className="pipeline">
      {stages.map((s, i) => {
        const reached = !rejected && activeIdx >= i;
        return (
          <div
            key={s}
            className={`pip ${reached ? 'pip-on' : ''}`}
            style={{ '--c': STATUS_META[s].color }}
            title={STATUS_META[s].label}
          />
        );
      })}
      {rejected && <div className="pip pip-rejected" title="Rejected" />}
    </div>
  );
}

function JobDetail({ job, onClose }) {
  const [emails, setEmails] = useState(null);
  useEffect(() => {
    let alive = true;
    api.jobEmails(job.job_key).then((r) => alive && setEmails(r.emails));
    return () => {
      alive = false;
    };
  }, [job.job_key]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="drawer-company">{job.company}</div>
            {job.position && <div className="drawer-position">{job.position}</div>}
          </div>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-status">
          <StatusBadge status={job.status} />
          <Pipeline status={job.status} />
        </div>

        <div className="timeline-title">Email timeline ({emails ? emails.length : '…'})</div>
        <div className="timeline">
          {!emails && <div className="muted">Loading…</div>}
          {emails &&
            [...emails].reverse().map((e) => (
              <div className="tl-item" key={e.id}>
                <div className="tl-dot" style={{ '--c': (STATUS_META[e.status] || {}).color || '#64748b' }} />
                <div className="tl-content">
                  <div className="tl-row">
                    <span className="tl-subject">{e.subject || '(no subject)'}</span>
                    {e.status && <StatusBadge status={e.status} />}
                  </div>
                  <div className="tl-meta">
                    {e.from_name || e.from_email} · {fmtDate(e.received_at)}
                  </div>
                  <div className="tl-snippet">{e.snippet}</div>
                </div>
              </div>
            ))}
        </div>
      </aside>
    </>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [data, setData] = useState({ jobs: [], counts: {} });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = (msg, kind = 'info', duration = 4000) => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), duration);
  };

  const refresh = useCallback(async () => {
    const [s, j] = await Promise.all([api.status(), api.jobs()]);
    setStatus(s);
    setData(j);
  }, []);

  useEffect(() => {
    refresh().catch((e) => notify(e.message, 'error'));
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      notify('Gmail connected! Syncing your inbox…', 'success');
      window.history.replaceState({}, '', '/');
    } else if (params.get('auth') === 'error') {
      const reason = params.get('reason');
      notify(
        reason ? `Google sign-in failed: ${reason}` : 'Google sign-in failed. Check your OAuth setup.',
        'error',
        reason ? 12000 : 4000
      );
      window.history.replaceState({}, '', '/');
    }
  }, [refresh]);

  // Poll status while syncing so the UI updates live.
  useEffect(() => {
    if (!status?.syncing) return;
    const t = setInterval(() => refresh().catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [status?.syncing, refresh]);

  // While the dashboard is open and Gmail is connected, sync in the background
  // every few minutes. This keeps statuses fresh on Vercel, where a long-lived
  // server-side timer can't run — the browser drives the refresh instead.
  useEffect(() => {
    if (!status?.connected) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api
        .sync()
        .then(() => refresh())
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [status?.connected, refresh]);

  const doSync = async () => {
    setBusy(true);
    try {
      const r = await api.sync();
      await refresh();
      if (r && r.done === false) {
        notify(
          `Imported a batch (${r.remaining} emails left). Click Sync again to continue.`,
          'info',
          8000
        );
      } else {
        notify('Sync complete — your applications are up to date.', 'success');
      }
    } catch (e) {
      const msg = /timed out|aborted/i.test(e.message)
        ? 'Sync is taking a while on a large inbox. It keeps running in batches — click Sync now again to continue.'
        : e.message;
      notify(msg, 'error', 9000);
    } finally {
      setBusy(false);
    }
  };

  const doDemo = async () => {
    setBusy(true);
    try {
      await api.loadDemo();
      await refresh();
      notify('Loaded sample data.', 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      await api.reset();
      await refresh();
      notify('Cleared all data.', 'info');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDisconnect = async () => {
    await api.disconnect();
    await refresh();
    notify('Disconnected Gmail.', 'info');
  };

  const filtered = useMemo(() => {
    let jobs = data.jobs;
    if (filter !== 'all') jobs = jobs.filter((j) => j.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      jobs = jobs.filter(
        (j) =>
          (j.company || '').toLowerCase().includes(q) ||
          (j.position || '').toLowerCase().includes(q)
      );
    }
    return jobs;
  }, [data.jobs, filter, search]);

  const connected = status?.connected;
  const configured = status?.googleConfigured;
  const hasData = data.jobs.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <div>
            <div className="brand-title">Job Tracker</div>
            <div className="brand-sub">Your applications, straight from Gmail</div>
          </div>
        </div>
        <div className="topbar-actions">
          {connected ? (
            <>
              <div className="account">
                {status.profile?.picture && (
                  <img src={status.profile.picture} alt="" className="avatar" referrerPolicy="no-referrer" />
                )}
                <div className="account-text">
                  <div className="account-email">{status.profile?.email || 'Connected'}</div>
                  <div className="account-sub">
                    {status.syncing ? 'Syncing…' : `Last sync ${timeAgo(status.lastSync)}`}
                  </div>
                </div>
              </div>
              <button className="btn btn-primary" onClick={doSync} disabled={busy || status.syncing}>
                {busy || status.syncing ? 'Syncing…' : '↻ Sync now'}
              </button>
              <button className="btn btn-ghost" onClick={doDisconnect} disabled={busy}>
                Disconnect
              </button>
            </>
          ) : configured ? (
            <a className="btn btn-primary" href="/api/auth/google">
              Connect Gmail
            </a>
          ) : (
            <span className="pill pill-warn">Gmail not configured — see README</span>
          )}
        </div>
      </header>

      <main className="main">
        <section className="stats">
          <button
            className={`stat stat-total ${filter === 'all' ? 'stat-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <div className="stat-icon">📋</div>
            <div className="stat-body">
              <div className="stat-count">{data.counts.total || 0}</div>
              <div className="stat-label">All applications</div>
            </div>
          </button>
          {STATUS_ORDER.map((s) => (
            <StatCard
              key={s}
              status={s}
              count={data.counts[s] || 0}
              active={filter === s}
              onClick={() => setFilter(filter === s ? 'all' : s)}
            />
          ))}
        </section>

        <section className="toolbar">
          <div className="search">
            <span className="search-icon">🔍</span>
            <input
              placeholder="Search company or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-right">
            {!hasData && (
              <button className="btn btn-soft" onClick={doDemo} disabled={busy}>
                Load sample data
              </button>
            )}
            {hasData && (
              <button className="btn btn-ghost" onClick={doReset} disabled={busy}>
                Clear data
              </button>
            )}
          </div>
        </section>

        {!hasData ? (
          <EmptyState
            connected={connected}
            configured={configured}
            onDemo={doDemo}
            busy={busy}
          />
        ) : filtered.length === 0 ? (
          <div className="empty small">No applications match this filter.</div>
        ) : (
          <section className="job-list">
            <div className="job-head">
              <span>Company & Role</span>
              <span>Status</span>
              <span>Pipeline</span>
              <span>Emails</span>
              <span>Last update</span>
            </div>
            {filtered.map((job) => (
              <button className="job-row" key={job.job_key} onClick={() => setSelected(job)}>
                <div className="job-main">
                  <div className="job-logo" style={{ '--c': (STATUS_META[job.status] || {}).color }}>
                    {(job.company || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="job-company">{job.company || 'Unknown'}</div>
                    <div className="job-position">{job.position || 'Position not specified'}</div>
                  </div>
                </div>
                <div><StatusBadge status={job.status} /></div>
                <div><Pipeline status={job.status} /></div>
                <div className="job-count">{job.email_count}</div>
                <div className="job-time">{timeAgo(job.last_update)}</div>
              </button>
            ))}
          </section>
        )}
      </main>

      {selected && <JobDetail job={selected} onClose={() => setSelected(null)} />}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function EmptyState({ connected, configured, onDemo, busy }) {
  return (
    <div className="empty">
      <div className="empty-art">◆</div>
      <h2>Track every application automatically</h2>
      <p>
        Job Tracker reads your Gmail, finds recruiting emails, and sorts each application into
        <b> Applied</b>, <b>Assessment</b>, <b>Interview</b>, <b>Offer</b>, or <b>Rejected</b> —
        updating the moment a new email lands.
      </p>
      <div className="empty-actions">
        {connected ? (
          <span className="muted">Connected — run a sync to import your applications.</span>
        ) : configured ? (
          <a className="btn btn-primary btn-lg" href="/api/auth/google">
            Connect your Gmail
          </a>
        ) : (
          <span className="muted">Add Google OAuth credentials to <code>.env</code> to connect Gmail (see README).</span>
        )}
        <button className="btn btn-soft btn-lg" onClick={onDemo} disabled={busy}>
          {busy ? 'Loading…' : 'Explore with sample data'}
        </button>
      </div>
    </div>
  );
}
