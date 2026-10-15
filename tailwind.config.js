/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        coral: {
          DEFAULT: '#E24E42',
          dark: '#C13E34',
          light: '#F5756B',
        },
        teal: {
          DEFAULT: '#1D809F',
          dark: '#166680',
          light: '#2BA3C9',
        },
        'brand-gray': '#A7A7A7',
        'dark-bg': {
          DEFAULT: '#1A1A1A',
          light: '#2D2D2D',
        },
      },
      fontFamily: {
        sans: ['var(--font-rubik)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
