import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: { port: 3100 },
  resolve: {
    alias: {
      'bw-board': resolve('../bw-board/src'),
    },
  },
  // Allow importing from sibling directory (bw-board)
  server: {
    port: 3100,
    fs: { allow: ['..'] },
  },
});
