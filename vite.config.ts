import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRecognitionRequest } from './api/recognize';

/**
 * Serves `api/recognize.ts` from the Vite dev/preview server, so recognition
 * works locally exactly as it does on Vercel. Server-only variables
 * (MYSCRIPT_*) are read from .env.local here and never exposed to the browser:
 * Vite only exposes variables prefixed with VITE_.
 */
function recognitionApi(env: Record<string, string>): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api/recognize', (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (v === undefined) continue;
            headers.set(k, Array.isArray(v) ? v.join(', ') : v);
          }
          const method = req.method ?? 'GET';
          const request = new Request(`http://${req.headers.host ?? 'localhost'}/api/recognize`, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });
          const response = await handleRecognitionRequest(request, { ...process.env, ...env });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'dev_proxy', message: String((e as Error)?.message ?? e) } }));
        }
      })();
    });
  };
  return { name: 'inkflow-recognition-api', configureServer: mount, configurePreviewServer: mount };
}

/** Emits precache-manifest.json listing every build output, used by public/sw.js. */
function precacheManifest(): Plugin {
  return {
    name: 'inkflow-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && f !== 'precache-manifest.json')
        .map((f) => `/${f}`);
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify({ version: Date.now().toString(36), files }, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), recognitionApi(env), precacheManifest()],
    server: { port: 5173, open: true },
    preview: { port: 4173 },
    build: { target: ['es2020', 'safari15'], sourcemap: false },
  };
});
