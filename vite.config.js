import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // API_PORT runs this stack's API on another port (as PORT does for the server) when 3001 is taken.
    proxy: { '/api': `http://localhost:${process.env.API_PORT || 3001}` },
  },
});
