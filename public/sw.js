// CSS ticket page: lets ticket.html open with no signal (the MacHall basement drops cellular and eduroam).
// Network first: with a connection the page is always the newest one. Without one (or if the network takes more than
// 3 seconds) the last copy this phone saw is used. It never touches the API (that is another address), so tickets,
// scans and the sheet are never answered from here.

const CACHE = "css-ticket-shell-v1";
const SHELL = [
  "ticket.html", "ticket.js", "strings.js", "config.js", "panda.js", "public.css",
  "assets/top_panda.png", "assets/bottom_panda.png", "assets/css-logo.png"
];
const QR_LIB = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs\//;
const NETWORK_WAIT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

function networkFirst(request, cacheKey) {
  return new Promise((resolve) => {
    let settled = false;
    const useCopy = () => caches.open(CACHE).then((c) => c.match(cacheKey, { ignoreSearch: true })).then((copy) => { if (copy && !settled) { settled = true; resolve(copy); } });
    const timer = setTimeout(useCopy, NETWORK_WAIT_MS);
    fetch(request).then((response) => {
      clearTimeout(timer);
      if (response && (response.ok || response.type === "opaque")) caches.open(CACHE).then((c) => c.put(cacheKey, response.clone()));
      if (!settled) { settled = true; resolve(response); }
    }).catch(() => {
      clearTimeout(timer);
      useCopy().then(() => { if (!settled) { settled = true; resolve(Response.error()); } });
    });
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (QR_LIB.test(request.url)) return event.respondWith(networkFirst(request, request.url));
  if (url.origin !== self.location.origin) return;
  const file = url.pathname.split("/").pop();
  // Any ticket link (…/ticket.html?t=SECRET) shares one saved page; the ticket itself comes from the API or the phone's copy
  if (file === "ticket.html") return event.respondWith(networkFirst(request, "ticket.html"));
  const path = url.pathname.replace(/^\//, "");
  if (SHELL.indexOf(path) !== -1) event.respondWith(networkFirst(request, path));
});
