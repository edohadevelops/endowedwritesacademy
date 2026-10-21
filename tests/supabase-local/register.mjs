// Lets Node load the Deno Edge Function: maps `npm:pkg@ver` imports to the
// installed package and provides the small part of the Deno API it uses.
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const m = /^npm:(@?[^@]+)(?:@[^/]*)?(\\/.*)?$/.exec(spec);
  return next(m ? m[1] + (m[2] ?? '') : spec, ctx);
}`));
globalThis.Deno = {
  env: { get: (k) => process.env[k] },
  serve: (handler) => { globalThis.__denoHandler = handler; },
};
