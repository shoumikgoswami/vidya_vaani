// JSON over a cookie session, with the CSRF cookie echoed in a header.

export class ApiError extends Error {
  constructor(status, code, data) {
    super(code);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export class OfflineError extends Error {}

const cookie = (name) =>
  document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || '';

export async function api(path, { method = 'GET', body, form, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (method !== 'GET') init.headers['X-CSRF-Token'] = decodeURIComponent(cookie('vv_csrf'));
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new OfflineError('offline');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || 'server_error', data);
  return data;
}

export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });
