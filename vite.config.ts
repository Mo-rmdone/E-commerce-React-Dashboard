import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json — both have to agree or
    // the editor resolves imports the bundler cannot.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5180, open: false },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
