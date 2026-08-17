/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const hasPackage = (id: string, pkg: string) => id.includes(`/node_modules/${pkg}/`) || id.includes(`\\node_modules\\${pkg}\\`)
const localBackendTarget = 'http://localhost:8000'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (hasPackage(id, 'exceljs')) return 'exports';
            if (hasPackage(id, 'react-markdown') || hasPackage(id, 'remark-gfm')) return 'markdown';
            if (hasPackage(id, 'react') || hasPackage(id, 'react-dom') || hasPackage(id, 'react-router-dom')) return 'vendor';
            if (hasPackage(id, 'axios') || hasPackage(id, 'zustand')) return 'core';
            if (hasPackage(id, 'lucide-react') || hasPackage(id, 'tailwind-merge') || hasPackage(id, 'clsx')) return 'ui';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: localBackendTarget,
        changeOrigin: true,
      },
      '/static': {
        target: localBackendTarget,
        changeOrigin: true,
      },
    },
  },
})
