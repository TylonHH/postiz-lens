const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PostizError extends Error {
  constructor(status, message) { super(`HTTP ${status}: ${message}`); this.status = status; }
}

/** Minimal read-only client for the Postiz public API. The API key never leaves this object. */
export function createClient({ apiUrl, apiKey }) {
  const root = apiUrl.replace(/\/+$/, '');
  const headers = { Authorization: apiKey };

  async function get(path, { retries = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(root + path, { headers });
      if (res.ok) return res.json();
      if (res.status === 429 && attempt < retries) {
        await sleep((Number(res.headers.get('retry-after')) || 30) * 1000);
        continue;
      }
      throw new PostizError(res.status, (await res.text()).slice(0, 300));
    }
  }

  return {
    integrations: () => get('/public/v1/integrations'),
    posts: async (start, end) => (await get(`/public/v1/posts?startDate=${start.toISOString()}&endDate=${end.toISOString()}`)).posts ?? [],
    // Not part of the documented OpenAPI spec, but returns the whole group (media + comments).
    group: (postId) => get(`/public/posts/${encodeURIComponent(postId)}`),
    postAnalytics: (postId, days) => get(`/public/v1/analytics/post/${encodeURIComponent(postId)}?date=${days}`),
    async head(url) {
      const res = await fetch(url, { method: 'HEAD' });
      return res.ok ? Number(res.headers.get('content-length')) || null : null;
    },
  };
}
