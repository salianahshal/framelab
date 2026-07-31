/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./pages/**/*.{ts,tsx,js,jsx}', './components/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#6e56cf',
          light: '#8b72e8',
          dark: '#4a3a8a',
        },
        surface: {
          DEFAULT: '#0c0c0e',
          1: '#111114',
          2: '#18181d',
        },
        accent: '#3dd68c',
        // Cool neutral ramp — the workhorse for text, seams, and panels.
        offgray: {
          50: '#e3e4e7',
          100: '#ced1d6',
          200: '#c0c3ca',
          300: '#abafb8',
          400: '#878e9b',
          500: '#757c89',
          600: '#626976',
          700: '#535964',
          800: '#474c55',
          900: '#35383f',
          950: '#212328',
          1000: '#0d0d0f',
        },
        // Warm ramp, used sparingly against the cool neutrals.
        cream: {
          50: '#f5f4f3',
          100: '#d1cfc8',
          200: '#b9b5ab',
          300: '#aaa599',
          700: '#5c574a',
          900: '#38352d',
        },
        // ember fills carry BLACK text (5.13:1, 6.80:1 on hover);
        // ember-light is the on-dark text tint (7.54:1).
        ember: {
          DEFAULT: '#e0490d',
          bright: '#ff5c1a',
          light: '#ff7a3d',
        },
      },
      fontFamily: {
        // Wordmark only — chamfered letterforms echo the icon's 45° cut corners.
        display: ['"Chakra Petch"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
      },
      spacing: {
        gutter: '1.75rem',
      },
      boxShadow: {
        card: '0 4px 24px rgba(0, 0, 0, 0.35)',
      },
    },
  },
  plugins: [],
};
