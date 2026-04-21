/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy:  { DEFAULT: '#0D1B2A', mid: '#1A2F45', light: '#243B55' },
        teal:  { DEFAULT: '#00C9A7', dark: '#009D82' },
        accent: '#FFD166',
        slate:  '#475569',
      },
    },
  },
  plugins: [],
};
