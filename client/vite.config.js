import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the Vite dev server (port 5173) proxies API + auth calls
// to the Express server (port 4000). In production the Express server serves
// the built files directly, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
