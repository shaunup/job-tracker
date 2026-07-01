async function req(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  status: () => req('/api/status'),
  jobs: () => req('/api/jobs'),
  jobEmails: (key) => req(`/api/jobs/${encodeURIComponent(key)}/emails`),
  sync: () => req('/api/sync', { method: 'POST' }),
  loadDemo: () => req('/api/demo', { method: 'POST' }),
  reset: () => req('/api/reset', { method: 'POST' }),
  disconnect: () => req('/api/auth/disconnect', { method: 'POST' }),
};
