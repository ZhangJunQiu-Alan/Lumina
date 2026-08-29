import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(),
      {
        name: 'lumina-mobile-fonts',
        transformIndexHtml(html) {
          return mode === 'mobile'
            ? html.replace(/<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/gs, '')
            : html;
        },
      },
      {
        name: 'lumina-strip-animal-island-fonts',
        enforce: 'pre',
        transform(code, id) {
          if (!id.includes('animal-island-ui/dist/index.css')) return null;
          return code.replace(/@font-face\{[^}]+\}/g, '');
        },
      },
      tailwindcss(),
    ],
    build: {
      target: mode === 'mobile' ? 'chrome111' : 'modules',
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
            'vendor-ui': ['motion/react', 'lucide-react', 'react-router-dom'],
            'vendor-db': ['@supabase/supabase-js'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: false,
      css: false,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
