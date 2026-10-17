// Garde les fichiers de l'application en cache pour qu'elle s'ouvre vite.
// Les données, elles, viennent toujours du serveur (Supabase).
// Changer ce numéro à chaque nouvelle version force la mise à jour du cache.
const CACHE = 'entreposage-v2';

const FICHIERS = [
  './',
  'index.html',
  'style.css',
  'config.js',
  'calculs.js',
  'donnees.js',
  'app.js',
  'vendor/supabase.js',
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
      noms.filter(nom => nom.startsWith('entreposage-') && nom !== CACHE).map(nom => caches.delete(nom))
    ))
  );
  self.clients.claim();
});

// Uniquement les fichiers de l'application : d'abord le réseau, sinon la copie en cache
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
