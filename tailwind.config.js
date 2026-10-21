/** @type {import('tailwindcss').Config} */
// Design tokens live as CSS variables in src/index.css so the owner's
// brand settings (accent colour, type preset) can change them at runtime.
// Tailwind only maps names onto those variables.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '480px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1440px' },
    extend: {
      colors: {
        obsidian: v('obsidian'),
        charcoal: v('charcoal'),
        accent: v('accent'),
        'accent-strong': v('accent-strong'),
        copper: v('copper'),
        ivory: v('ivory'),
        paper: v('paper'),
        ink: v('ink'),
        stone: v('stone'),
        line: v('line'),
        mist: v('mist'),
        success: v('success'),
        danger: v('danger'),
        warn: v('warn'),
      },
      fontFamily: {
        serif: ['var(--font-serif)'],
        sans: ['var(--font-sans)'],
        read: ['var(--font-read)'],
      },
      fontSize: {
        // Modular scale, ratio ~1.25 with a dramatic display step.
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.875rem', { lineHeight: '1.35rem' }],
        base: ['1rem', { lineHeight: '1.6rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.3rem', { lineHeight: '1.8rem' }],
        '2xl': ['1.6rem', { lineHeight: '2rem' }],
        '3xl': ['2rem', { lineHeight: '2.35rem' }],
        '4xl': ['2.6rem', { lineHeight: '2.85rem' }],
        '5xl': ['3.4rem', { lineHeight: '3.5rem' }],
        '6xl': ['4.4rem', { lineHeight: '4.35rem' }],
      },
      borderRadius: { sm: '3px', DEFAULT: '5px', md: '8px', lg: '12px' },
      boxShadow: {
        lift: '0 1px 2px rgb(20 17 19 / 0.06), 0 8px 24px -12px rgb(20 17 19 / 0.25)',
        cover: '0 30px 60px -30px rgb(20 17 19 / 0.55)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
      maxWidth: { read: '42rem', site: '76rem' },
    },
  },
  plugins: [],
};
