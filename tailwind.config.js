/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#f5f5f0', foreground: '#172923',
        card: { DEFAULT: '#ffffff', foreground: '#172923' },
        primary: { DEFAULT: '#176b50', foreground: '#ffffff' },
        secondary: { DEFAULT: '#e5eee7', foreground: '#176b50' },
        muted: { DEFAULT: '#edece5', foreground: '#66736d' },
        accent: { DEFAULT: '#e5eee7', foreground: '#172923' },
        destructive: { DEFAULT: '#b63e36', foreground: '#ffffff' },
        border: '#dedfd6', input: '#dedfd6', ring: '#176b50',
      },
    },
  },
};
