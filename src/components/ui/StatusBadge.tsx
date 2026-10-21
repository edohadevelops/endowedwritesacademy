import type { DisplayStatus, CommentStatus } from '@/lib/types';

const styles: Record<DisplayStatus | CommentStatus, string> = {
  published: 'bg-success/10 text-success',
  approved: 'bg-success/10 text-success',
  scheduled: 'bg-accent/10 text-accent-strong',
  draft: 'bg-ink/[0.07] text-stone',
  pending: 'bg-warn/15 text-warn',
  archived: 'bg-ink/[0.07] text-stone',
  trashed: 'bg-danger/10 text-danger',
  rejected: 'bg-ink/[0.07] text-stone',
  spam: 'bg-danger/10 text-danger',
};
const labels: Record<DisplayStatus | CommentStatus, string> = {
  published: 'Published', approved: 'Approved', scheduled: 'Scheduled', draft: 'Draft', pending: 'Waiting',
  archived: 'Archived', trashed: 'In trash', rejected: 'Rejected', spam: 'Spam',
};

export function StatusBadge({ status }: { status: DisplayStatus | CommentStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}
