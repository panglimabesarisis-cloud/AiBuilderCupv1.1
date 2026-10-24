import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      {
        name: 'safe-vite-client-hmr-send',
        transform(code, id) {
          if (id.includes('vite/dist/client') || id.includes('@vite/client')) {
            return code
              .replace(/this\.transport\.send\(/g, 'this.transport?.send?.(')
              .replace(/transport\.send\(/g, 'transport?.send?.(');
          }
          return null;
        },
      },
      {
        name: 'riskcart-firestore-sandbox-alias',
        enforce: 'pre',
        resolveId(source, importer) {
          if (
            source === 'firebase/firestore' &&
            importer &&
            !importer.replace(/\\/g, '/').endsWith('src/utils/firestoreSandbox.ts') &&
            !importer.replace(/\\/g, '/').endsWith('src/firebase.ts') &&
            !importer.replace(/\\/g, '/').includes('node_modules')
          ) {
            return path.resolve(import.meta.dirname, 'src/utils/firestoreSandbox.ts');
          }
          return null;
        },
      },
      react(),
      tailwindcss(),
    ],
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const norm = id.replace(/\\/g, '/');
            if (norm.includes('node_modules')) {
              if (norm.includes('/firebase/') || norm.includes('/@firebase/')) {
                return 'vendor-firebase';
              }
              if (norm.includes('/recharts/') || norm.includes('/d3-')) {
                return 'vendor-charts';
              }
              if (norm.includes('/lucide-react/')) {
                return 'vendor-icons';
              }
              if (norm.includes('/react/') || norm.includes('/react-dom/') || norm.includes('/react-router')) {
                return 'vendor-react';
              }
              return 'vendor-misc';
            }
            if (norm.includes('/src/components/pwa/')) {
              return 'app-pwa';
            }
            if (norm.includes('/src/components/pos/')) {
              return 'app-pos';
            }
            if (norm.includes('/src/components/admin/')) {
              return 'app-admin';
            }
            if (norm.includes('/src/components/modules/AI')) {
              return 'app-ai-modules';
            }
            if (norm.includes('/src/components/modules/')) {
              return 'app-core-modules';
            }
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname || '.', '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
