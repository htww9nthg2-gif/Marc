// Garde les fichiers de l'application en cache pour qu'elle s'ouvre même sans réseau.
// Changer ce numéro à chaque nouvelle version force la mise à jour du cache.
const CACHE = 'visite-chantier-v3';

const FICHIERS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icones/apple-touch-icon.png',
  'icones/icone-192.png',
  'icones/icone-512.png'
];

self.addEventListener('install', evenement => {
  evenement.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener('activate', evenement => {
  evenement.waitUntil(
    caches.keys().then(noms => Promise.all(
      noms.filter(nom => nom.startsWith('visite-chantier-') && nom !== CACHE).map(nom => caches.delete(nom))
    ))
  );
  self.clients.claim();
});

// D'abord le réseau (dernière version), sinon la copie en cache
self.addEventListener('fetch', evenement => {
  const requete = evenement.request;
  if (requete.method !== 'GET' || new URL(requete.url).origin !== location.origin) return;
  evenement.respondWith(
    fetch(requete)
      .then(reponse => {
        const copie = reponse.clone();
        caches.open(CACHE).then(cache => cache.put(requete, copie));
        return reponse;
      })
      .catch(() => caches.match(requete))
  );
});
