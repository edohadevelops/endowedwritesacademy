// The single entry point pages use for data. `./backend` is the local adapter
// by default and the Supabase adapter when VITE_SUPABASE_URL is configured
// (see vite.config.ts). Both export exactly the same names.
export {
  auth, settings, taxonomy, publicApi, adminPosts, adminComments, adminMedia, dashboard, importer,
  displayStatus, isPubliclyVisible, resolveDocMedia, backend,
} from './backend';
export type { PostSummary, AdminPostRow, AdminCommentRow, StatusFilter, SortKey } from './shared';
export { subscribe } from './events';
export { AppError, userMessage } from './errors';
