import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base is relative so a build can be deployed under any subpath
// (e.g. GitHub Pages project sites) without a rebuild.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
