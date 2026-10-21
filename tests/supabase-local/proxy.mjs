// Serves the local stand-in under Supabase's URL layout on one port:
//   /auth/v1/*        -> GoTrue (Supabase Auth)
//   /rest/v1/*        -> PostgREST
//   /functions/v1/submit-comment -> the real Edge Function, run in Node
//   /storage/v1/*     -> in-memory Storage stand-in (admin check via is_admin())
// Start with: node --import ./tests/supabase-local/register.mjs tests/supabase-local/proxy.mjs
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, SERVICE_KEY } from './keys.mjs';

const PORT = Number(process.env.PROXY_PORT ?? 54321);
const REST = process.env.REST_URL ?? 'http://127.0.0.1:3000';
const AUTH = process.env.AUTH_URL ?? 'http://127.0.0.1:9999';
const SELF = `http://localhost:${PORT}`;

process.env.SUPABASE_URL = SELF;
// New-style key variable, as provided to Edge Functions on current Supabase projects.
process.env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: SERVICE_KEY });
process.env.COMMENT_IP_SALT ??= 'test-salt';
await import(process.env.FUNCTION_FILE ? new URL(process.env.FUNCTION_FILE, `file://${process.cwd()}/`).href : '../../supabase/functions/submit-comment/index.ts');
const commentHandler = globalThis.__denoHandler;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-upsert, prefer, range, accept-profile, content-profile, x-supabase-api-version, cache-control',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, x-total-count',
};

const objects = new Map(); // "bucket/path" -> { body: Buffer, type }

async function isAdmin(authHeader) {
  if (!authHeader) return false;
  const r = await fetch(`${REST}/rpc/is_admin`, { method: 'POST', headers: { authorization: authHeader, 'content-type': 'application/json' }, body: '{}' });
  return r.ok && (await r.json()) === true;
}

async function storage(req, path, body) {
  const pub = /^\/object\/public\/([^/]+)\/(.+)$/.exec(path);
  if (pub && req.method === 'GET') {
    const o = objects.get(`${pub[1]}/${decodeURIComponent(pub[2])}`);
    return o ? new Response(o.body, { headers: { 'content-type': o.type, 'cache-control': 'public, max-age=60' } }) : new Response('not found', { status: 404 });
  }
  if (!(await isAdmin(req.headers.authorization))) return Response.json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, { status: 403 });
  const obj = /^\/object\/([^/]+)\/(.+)$/.exec(path);
  if (obj && (req.method === 'POST' || req.method === 'PUT')) {
    const key = `${obj[1]}/${decodeURIComponent(obj[2])}`;
    if (req.method === 'POST' && objects.has(key) && req.headers['x-upsert'] !== 'true') return Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 409 });
    const ct = req.headers['content-type'] ?? '';
    let data = body;
    let type = ct;
    if (ct.startsWith('multipart/form-data')) {
      const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': ct }, body }).formData();
      const file = [...form.values()].find((v) => typeof v !== 'string');
      data = Buffer.from(await file.arrayBuffer());
      type = file.type || 'application/octet-stream';
    }
    objects.set(key, { body: data, type });
    return Response.json({ Key: key, Id: randomUUID() });
  }
  const del = /^\/object\/([^/]+)$/.exec(path);
  if (del && req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse(body.toString() || '{}');
    prefixes.forEach((p) => objects.delete(`${del[1]}/${p}`));
    return Response.json(prefixes.map((name) => ({ name })));
  }
  return Response.json({ error: 'not implemented in stand-in' }, { status: 501 });
}

async function forward(target, req, body) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  if (headers.apikey && !headers.authorization) headers.authorization = `Bearer ${headers.apikey}`;
  return fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, redirect: 'manual' });
}

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, SELF);
    let out;
    if (url.pathname.startsWith('/rest/v1')) out = await forward(REST + url.pathname.slice(8) + url.search, req, body);
    else if (url.pathname.startsWith('/auth/v1')) out = await forward(AUTH + url.pathname.slice(8) + url.search, req, body);
    else if (url.pathname.startsWith('/storage/v1')) out = await storage(req, url.pathname.slice(11), body);
    else if (url.pathname === '/functions/v1/submit-comment') {
      out = await commentHandler(new Request(SELF + url.pathname, { method: req.method, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1' }, body: req.method === 'POST' ? body : undefined }));
    } else out = new Response('not found', { status: 404 });
    const headers = Object.fromEntries(out.headers);
    delete headers['content-encoding'];
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    res.writeHead(out.status, { ...headers, ...cors });
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, cors);
    res.end(String(e));
  }
}).listen(PORT, () => console.log(`supabase stand-in on ${SELF} (anon key ${ANON_KEY.slice(0, 16)}…)`));
