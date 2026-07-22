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
