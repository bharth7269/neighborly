/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: '#EEF3EF',
        ink: { DEFAULT: '#14231C', soft: '#4A5D53' },
        line: '#CFDCD3',
        leaf: { DEFAULT: '#1F7A4D', edge: '#145536', tint: '#DDEFE4' },
        marigold: { DEFAULT: '#F2B233', edge: '#B97E0B', tint: '#FCEFD0' },
        brick: { DEFAULT: '#B23A26', edge: '#7E2516', tint: '#F8DDD7' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'system-ui', 'sans-serif'],
        sans: ['"Figtree Variable"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // The "3D" look: a solid offset edge instead of a blurry drop shadow.
        tile: '0 4px 0 0 #CFDCD3',
        'tile-lg': '0 6px 0 0 #CFDCD3, 0 14px 24px -12px rgba(20,35,28,.18)',
        'key-leaf': '0 4px 0 0 #145536',
        'key-marigold': '0 4px 0 0 #B97E0B',
        'key-brick': '0 4px 0 0 #7E2516',
        'key-plain': '0 4px 0 0 #B8C9BE',
      },
      borderRadius: { tag: '18px' },
    },
  },
  plugins: [],
}
