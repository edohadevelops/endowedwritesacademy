import type { SiteSettings } from '@/lib/types';

// Starting values only. The owner edits all of this in Admin → Settings.
export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'The Endowed Academy',
  tagline: 'Helping young people bring out their endowment',
  logoMediaId: null,
  accentColor: '#6A3D9A', // silky purple; white button text on it is 7.6:1 (WCAG AA needs 4.5)
  typePreset: 'editorial',
  heroTitle: 'Bring out what you have been given.',
  heroIntro:
    'Study guides, learning strategies and honest reflections from the Endowed Academy, written to help young learners grow their gifts and reach their full potential.',
  // Academy pages are planned for later phases; they open a "coming soon" page for now.
  navLinks: [
    { label: 'About', url: '/about' },
    { label: 'Courses', url: '/courses' },
    { label: 'Blog', url: '/blog' },
    { label: 'Contact', url: '/contact' },
  ],
  socialLinks: [],
  footerText: 'All rights reserved.',
  contactEmail: '',
  defaultAuthorName: 'The Endowed Academy',
  cta: {
    title: 'Learn with the Endowed Academy',
    text: 'Find out how the academy can support you or your child’s learning journey.',
    label: 'Learn about the academy',
    href: '/about',
  },
  showDropCap: true,
  comments: {
    enabled: true,
    moderation: 'all',
    blockedTerms: [],
  },
  seo: {
    siteUrl: '',
    defaultDescription:
      'Study guides, learning strategies and reflections from the Endowed Academy for young learners growing their gifts.',
  },
};

export const DEFAULT_CATEGORIES = [
  { name: 'Study Tips', description: 'Practical ways to study better.' },
  { name: 'Academic Success', description: 'Exams, grades and building strong habits.' },
  { name: 'Wellbeing', description: 'Looking after your mind while you learn.' },
  { name: 'Career Guidance', description: 'Thinking ahead to work and purpose.' },
  { name: 'Self Development', description: 'Identity, growth and becoming who you are meant to be.' },
  { name: 'Faith', description: 'Reflections on faith and purpose.' },
];

export const PAGE_SIZE = 9;
export const ADMIN_PAGE_SIZE = 15;
export const REVISION_LIMIT = 30;
export const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;
