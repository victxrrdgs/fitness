// Service worker: guarda os arquivos do app para abrir rápido e offline.
// Os dados ficam no cache offline do próprio Firestore.
const V = '0.5';
const CACHE = 'folego-' + V;
const ARQUIVOS = ['./', 'index.html', `styles.css?v=${V}`, `app.js?v=${V}`, `store.js?v=${V}`, `calc.js?v=${V}`, 'firebase-config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// "Compartilhar" do celular (Samsung Health, galeria...): guarda as fotos e o texto e abre o check-in.
async function receberCompartilhado(req) {
  const fd = await req.formData();
  const c = await caches.open('folego-compartilhado');
  for (const k of await c.keys()) await c.delete(k);
  let i = 0;
  for (const f of fd.getAll('arquivos')) {
    if (f && typeof f === 'object' && f.size) await c.put(`compartilhado/${i++}`, new Response(f, { headers: { 'content-type': f.type || 'image/jpeg' } }));
  }
  const texto = { title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '' };
  await c.put('compartilhado/texto', new Response(JSON.stringify(texto), { headers: { 'content-type': 'application/json' } }));
  return Response.redirect(new URL('./?acao=checkin&compartilhado=1', self.registration.scope).href, 303);
}

// Rede primeiro (para receber atualizações), cache se estiver offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/compartilhar')) {
    e.respondWith(receberCompartilhado(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
