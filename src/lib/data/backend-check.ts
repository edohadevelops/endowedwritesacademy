// Compile-time check that both adapters expose the same API. If an export or
// a method is added to one adapter but not the other, `npm run typecheck` fails.
import type * as Local from './local';
import type * as Supa from './supabase';

type L = typeof Local;
type S = typeof Supa;
type Shared = 'auth' | 'settings' | 'taxonomy' | 'publicApi' | 'adminPosts' | 'adminComments' | 'adminMedia' | 'dashboard' | 'importer';
type MissingExports = Exclude<keyof L, keyof S>;
type MissingMethods = { [K in Shared]: Exclude<keyof L[K], keyof S[K]> | Exclude<keyof S[K], keyof L[K]> }[Shared];

const none = <T extends never>(): T | undefined => undefined;
export const exportsMatch = none<MissingExports>();
export const methodsMatch = none<MissingMethods>();
