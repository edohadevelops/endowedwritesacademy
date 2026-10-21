// HS256 JWTs for the local stand-in (never use these anywhere real).
import { createHmac } from 'node:crypto';
export const JWT_SECRET = 'local-test-secret-that-is-at-least-32-characters-long';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function sign(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ iss: 'supabase-local', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400, ...payload });
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export const ANON_KEY = sign({ role: 'anon' });
export const SERVICE_KEY = sign({ role: 'service_role' });
if (process.argv[2] === 'print') console.log(JSON.stringify({ ANON_KEY, SERVICE_KEY }));
