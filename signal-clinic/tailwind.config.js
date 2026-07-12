/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#101215',       // app background
        panel: '#1A1D22',      // module rack surface
        'panel-raised': '#22262D', // hovered/focused module surface
        hairline: '#2E333C',   // borders/dividers
        ink: '#EDEAE3',        // primary text (warm off-white)
        'ink-muted': '#82868F',// secondary text
        signal: '#4FD8C4',     // active/processing accent (oscilloscope teal)
        bypass: '#E8A33D',     // bypassed-module accent (LED amber)
        clip: '#E1503D',       // clip/error accent
        ml: '#9D7FE8',         // ML-dependent / offline-only badge accent
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        body: ['"Inter"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
