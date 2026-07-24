import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  // Tauri uses a specific root for the frontend
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    // Tauri requires specific rollup options
    rollupOptions: {
      output: {
        // Prevent code splitting to ensure all code is in one file
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Required for Tauri dev mode
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  // Clear screen during build
  clearScreen: false,
  // Env variables
  envPrefix: ['VITE_', 'TAURI_'],
  // Optimize deps
  optimizeDeps: {
    include: ['react', 'react-dom', 'monaco-editor'],
  },
});
