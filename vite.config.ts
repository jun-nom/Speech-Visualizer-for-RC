import { defineConfig, type Plugin } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function findMiroIframePlugin(): Plugin {
  return {
    name: 'find-miro-iframe',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/find-miro-iframe', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', chunk => { body += String(chunk); });
        req.on('end', async () => {
          try {
            const { url } = JSON.parse(body);
            const fetchRes = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
            });
            if (!fetchRes.ok) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `HTTP ${fetchRes.status}` }));
              return;
            }
            const html = await fetchRes.text();
            const seen = new Set<string>();
            const miroUrls: string[] = [];
            const addUrl = (u: string) => { if (!seen.has(u)) { seen.add(u); miroUrls.push(u); } };
            let match: RegExpExecArray | null;
            const iframeRe = /<iframe[^>]+src=['"]([^'"]*miro\.com[^'"]*)['"]/gi;
            while ((match = iframeRe.exec(html)) !== null) addUrl(match[1]);
            const urlRe = /https?:\/\/(?:www\.)?miro\.com\/app\/(?:board|live-embed)\/[^?#'"\s<>]+/gi;
            while ((match = urlRe.exec(html)) !== null) addUrl(match[0]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ miroUrls }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    findMiroIframePlugin(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/app'),
    },
  },
  server: {
    proxy: {
      '/api/dictionary': 'https://speech-visualizer-for-rc.pages.dev',
    },
  },
})
