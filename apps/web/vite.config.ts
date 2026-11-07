import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo la API corre en el host (CAMPO_API_PORT); en el VPS, el nginx de la imagen web
// sirve todo desde el mismo origen, así que la web siempre llama a rutas relativas.
const api = `http://127.0.0.1:${process.env['CAMPO_API_PORT'] ?? '3100'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': api },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
});
