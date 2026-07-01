async function req(path, options = {}) {
  const { timeoutMs = 90000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...rest,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
