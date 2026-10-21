// Copies code shared between the browser app and Supabase Edge Functions.
import { readFileSync, writeFileSync } from 'node:fs';

const header =
  '// GENERATED COPY of src/features/comments/moderation.ts. Do not edit here: run `npm run sync:shared`.\n' +
  '// A unit test fails if the two drift apart.\n';
const src = readFileSync('src/features/comments/moderation.ts', 'utf8');
writeFileSync('supabase/functions/_shared/moderation.ts', header + src);
console.log('Synced supabase/functions/_shared/moderation.ts');
