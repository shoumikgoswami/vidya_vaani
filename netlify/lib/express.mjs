// Lets an Express app answer a web Request, which is what a Netlify function receives.
import serverless from 'serverless-http';

export function expressHandler(app) {
  const run = serverless(app, {
    // Recordings and pictures must pass through as bytes, not text.
    binary: ['audio/*', 'image/png', 'image/jpeg', 'font/*', 'application/octet-stream'],
  });

  return async (request, context = {}) => {
    const url = new URL(request.url);
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : null;
    const headers = Object.fromEntries(request.headers);
    headers.host ||= url.host;
    headers['x-forwarded-proto'] ||= url.protocol.slice(0, -1);
    if (context.ip) headers['x-nf-client-connection-ip'] = context.ip;
    if (body) headers['content-length'] = String(body.length);

    const result = await run({
      httpMethod: request.method,
      path: url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: body && body.toString('base64'),
      isBase64Encoded: Boolean(body),
      requestContext: {},
    }, {});

    const out = new Headers();
    for (const [name, value] of Object.entries(result.headers || {})) out.set(name, String(value));
    // Several cookies arrive as a list and must stay separate headers.
    for (const [name, values] of Object.entries(result.multiValueHeaders || {})) {
      out.delete(name);
      for (const value of values) out.append(name, value);
    }
    const bytes = result.body ? Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8') : null;
    const empty = request.method === 'HEAD' || [204, 304].includes(result.statusCode);
    return new Response(empty ? null : bytes, { status: result.statusCode, headers: out });
  };
}
