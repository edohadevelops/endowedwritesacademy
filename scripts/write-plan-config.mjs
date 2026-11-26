// After the build, write dist/plan/config.js from the same Supabase settings the blog uses,
// so the planning form (/plan/) needs no manual setup. Only the public URL and publishable key are used.
import { writeFileSync, existsSync } from 'node:fs';

const url = process.env.VITE_SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
if (!existsSync('dist/plan')) process.exit(0);
if (!url || !key) {
  console.log('write-plan-config: Supabase variables not set, leaving dist/plan/config.js as is');
  process.exit(0);
}
writeFileSync('dist/plan/config.js', `window.PLAN_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_KEY: key })};\n`);
console.log('write-plan-config: wrote dist/plan/config.js');
