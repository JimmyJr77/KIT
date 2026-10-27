import fs from 'node:fs/promises';

// Generate the proxy at build time: Vercel JSON rewrites don't expand env vars.
const value = process.env.RENDER_API_URL;
if (!value) throw new Error('Set RENDER_API_URL to the Render service HTTPS origin before building.');
const backend = new URL(value);
if (backend.protocol !== 'https:' || backend.username || backend.password ||
    backend.pathname !== '/' || backend.search || backend.hash) {
  throw new Error('RENDER_API_URL must be an HTTPS origin without credentials, path, query, or fragment.');
}

const output = '.vercel/output';
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await fs.cp('dist', `${output}/static`, { recursive: true });
await fs.writeFile(`${output}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '/api', dest: `${backend.origin}/api`, headers: { 'Cache-Control': 'private, no-store' } },
    { src: '/api/(.*)', dest: `${backend.origin}/api/$1`, headers: { 'Cache-Control': 'private, no-store' } },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2) + '\n');
console.log('Vercel static output and Render API proxy generated.');
