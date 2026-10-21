// Step-by-step tours for each admin page. Each step points at an element
// marked with data-tour="…". Steps whose element isn't on screen (empty
// lists, hidden on phones) are skipped automatically.

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export type TourId =
  | 'dashboard' | 'posts' | 'editor' | 'comments' | 'media' | 'categories' | 'settings' | 'import' | 'preview';

export const TOURS: Record<TourId, { title: string; steps: TourStep[] }> = {
  dashboard: {
    title: 'Welcome to your writing desk',
    steps: [
      { target: 'admin-nav', title: 'Everything lives in this menu', body: 'Write articles, answer comments, manage images and change how the blog looks. Each page has its own short tour the first time you open it.' },
      { target: 'new-article', title: 'Start writing', body: 'Opens a fresh article. It saves itself as you type, so you can stop and come back any time.' },
      { target: 'stats', title: 'Your blog at a glance', body: 'Published, drafts, scheduled and comments waiting for you. Click any number to jump straight to that list.' },
      { target: 'recent', title: 'Pick up where you left off', body: 'The articles you edited most recently. Click one to keep working on it.' },
      { target: 'activity', title: 'What changed', body: 'A log of publishing and editing, so you always know what happened and when.' },
      { target: 'view-blog', title: 'See it as readers do', body: 'Opens the public blog in a new tab.' },
      { target: 'page-help', title: 'Need this again?', body: 'Press the question mark on any page to replay its tour. You can turn the hover tips off in Settings → Account.' },
    ],
  },
  posts: {
    title: 'Managing articles',
    steps: [
      { target: 'status-tabs', title: 'Filter by status', body: 'Drafts are private. Scheduled articles go live on their own at the time you set. Trash keeps deleted articles so you can restore them.' },
      { target: 'post-search', title: 'Find an article', body: 'Search by title, web address or summary. Use the menus beside it to filter by category or change the order.' },
      { target: 'select-all', title: 'Work on many at once', body: 'Tick articles to publish, unpublish, archive or trash them together.' },
      { target: 'row-actions', title: 'More actions', body: 'Each article has a menu: edit, preview, feature it on the blog home, duplicate it, or move it to the trash.' },
      { target: 'bulk-import', title: 'Bring in older articles', body: 'Upload many articles at once from Word, Markdown, a spreadsheet or a Blogger backup.' },
    ],
  },
  editor: {
    title: 'Writing an article',
    steps: [
      { target: 'title', title: 'Give it a title', body: 'The web address fills in from the title automatically. Press Enter to jump into the article text.' },
      { target: 'toolbar', title: 'Format as you write', body: 'Headings, bold, lists, quotes and links. Hover over any button to see what it does. Ctrl+B, Ctrl+I and Ctrl+K work too.' },
      { target: 'block-type', title: 'Headings build the contents list', body: 'Use Heading and Subheading for sections. Long articles get a clickable “In this article” list from them.' },
      { target: 'insert-image', title: 'Add images', body: 'Pick from your library or upload a new one. Always describe the image in the alt text for readers who can’t see it.' },
      { target: 'insert-math', title: 'Equations', body: 'Write LaTeX like \\frac{a}{b} and it appears as a properly typeset equation.' },
      { target: 'insert-cta', title: 'Invite readers in', body: 'Adds a call-to-action box, for example pointing readers to the academy. Edit its text right below the toolbar once it’s selected.' },
      { target: 'move-block', title: 'Reorder', body: 'Move the paragraph, image or table your cursor is in up or down.' },
      { target: 'save-state', title: 'Saving is automatic', body: 'Drafts save a moment after you stop typing. If something fails, your work stays safe in this browser and saving retries.' },
      { target: 'preview', title: 'Preview privately', body: 'See exactly what readers will see. Only you can open the preview.' },
      { target: 'settings-toggle', title: 'Article settings', body: 'On a phone, the publishing options, image, category and summary live behind this button.' },
      { target: 'publish-panel', title: 'Publish or schedule', body: 'Publish now, or pick a date and time to go live later. Once live, edits wait until you press Update.' },
      { target: 'slug', title: 'Web address', body: 'Keep it short and readable. If you change it after publishing, the old link keeps working.' },
      { target: 'featured-image', title: 'Featured image', body: 'Shown on the blog home and in link previews on WhatsApp, X and Facebook.' },
      { target: 'organise', title: 'Category and tags', body: 'Categories are the main topics readers browse. Tags are smaller labels that help link related articles.' },
      { target: 'excerpt', title: 'Summary', body: 'One or two sentences shown under the title and on article cards.' },
      { target: 'seo', title: 'Search and sharing', body: 'Optional. Change how the article appears in Google results and shared links.' },
      { target: 'revisions', title: 'Go back in time', body: 'Earlier versions are kept automatically. Preview any of them and restore it in one click.' },
    ],
  },
  comments: {
    title: 'Looking after comments',
    steps: [
      { target: 'comment-tabs', title: 'Nothing appears without you', body: 'New comments wait here until you approve them. Spam and rejected comments stay hidden from readers.' },
      { target: 'comment-filter', title: 'One article at a time', body: 'Narrow the list to a single article.' },
      { target: 'comment-card', title: 'Approve, reject or mark as spam', body: 'Approved comments show under the article straight away. Delete removes a comment for good.' },
      { target: 'comment-flags', title: 'Automatic checks', body: 'Suspicious comments are flagged with the reason, like too many links or a blocked word. You still decide.' },
    ],
  },
  media: {
    title: 'Your image library',
    steps: [
      { target: 'media-upload', title: 'Upload images', body: 'JPG, PNG, WebP, AVIF or GIF up to 8 MB. Images are resized and cleaned of hidden location data automatically. You can also drag files onto the page.' },
      { target: 'media-search', title: 'Find an image', body: 'Search by file name or description.' },
      { target: 'media-grid', title: 'Edit details', body: 'Click an image to add alt text, see where it’s used, swap the file everywhere at once, or delete it if it’s unused.' },
    ],
  },
  categories: {
    title: 'Organising topics',
    steps: [
      { target: 'cat-list', title: 'Categories', body: 'The main topics on the blog. Readers can filter by them, and each one gets its own page.' },
      { target: 'cat-reorder', title: 'Set the order', body: 'Use the arrows to choose the order topics appear in on the blog.' },
      { target: 'cat-form', title: 'Add or rename', body: 'Give each category a short name and an optional description that appears on its page.' },
      { target: 'tag-list', title: 'Tags', body: 'Tags are created while you write. Remove ones you no longer need here.' },
    ],
  },
  settings: {
    title: 'Making the blog yours',
    steps: [
      { target: 'settings-tabs', title: 'Everything is grouped', body: 'Brand, blog home text, menus and footer, comment rules, search settings and your account.' },
      { target: 'settings-brand', title: 'Brand', body: 'Change the name, logo, accent colour and text style. The colour checker makes sure buttons stay readable.' },
      { target: 'settings-save', title: 'Save when ready', body: 'Nothing changes on the live blog until you save. Discard undoes everything since your last save.' },
    ],
  },
  import: {
    title: 'Bringing in many articles',
    steps: [
      { target: 'import-drop', title: 'Drop your files here', body: 'Word documents, Markdown, HTML, a spreadsheet (CSV), a Blogger backup or an import bundle. Add any images the articles use too.' },
      { target: 'import-template', title: 'Using a spreadsheet?', body: 'Download the template to see which columns are understood.' },
      { target: 'import-defaults', title: 'Choose the defaults', body: 'Decide whether imported articles start as drafts or published, and which category they go into if the file doesn’t say.' },
    ],
  },
  preview: {
    title: 'Preview',
    steps: [
      { target: 'preview-banner', title: 'Only you can see this', body: 'This is exactly how the article will look to readers. Go back to editing when you’re ready.' },
    ],
  },
};
