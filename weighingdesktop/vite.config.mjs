import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths: the built UI is opened from disk by Electron
// (file://…/dist/index.html), not served from a web root.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // One local bundle read from disk — download size is not a concern.
    chunkSizeWarningLimit: 2000,
  },
});
