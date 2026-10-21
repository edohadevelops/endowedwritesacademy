// Which data adapter the app uses. This file points at the local (browser)
// adapter; vite.config.ts swaps it for ./supabase when VITE_SUPABASE_URL is
// set, so only one adapter is ever bundled.
export * from './local';
