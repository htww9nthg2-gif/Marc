'use strict';

// =====================================================================
// Petits outils
// =====================================================================
const e = texte => String(texte ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatArgent = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
const argent = n => formatArgent.format(n || 0);
const nombre = n => new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 3 }).format(n || 0);
const pourcent = t => `${Math.round(t * 100)} %`;
const aujourdhui = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const moisCourant = () => aujourdhui().slice(0, 7);
const dateCourte = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const jourMois = iso => new Date(iso + 'T12:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
const nomMois = mois => new Date(mois + '-15T12:00').toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
const joursDepuis = iso => Math.max(0, Math.round((Date.parse(aujourdhui()) - Date.parse(iso)) / 86400000));

// Réduit les photos (1600 px, JPEG) avant l'envoi
function compresserPhoto(fichier, cote = 1600) {
  return new Promise((ok, ko) => {
    const image = new Image();
    const adresse = URL.createObjectURL(fichier);
    image.onload = () => {
      const ratio = Math.min(1, cote / Math.max(image.width, image.height));
      const toile = document.createElement('canvas');
      toile.width = Math.round(image.width * ratio);
      toile.height = Math.round(image.height * ratio);
      toile.getContext('2d').drawImage(image, 0, 0, toile.width, toile.height);
      URL.revokeObjectURL(adresse);
      toile.toBlob(ok, 'image/jpeg', 0.75);
    };
    image.onerror = ko;
    image.src = adresse;
  });
}

// =====================================================================
// État de l'application
// =====================================================================
let profil = null;
let reglages = null;
let entrepots = [];
let zones = [];
let clients = [];
let stock = [];
let sortis = [];
let etat = { vue: 'occupation', lotId: null, texte: '', zone: '', voirSortis: false, mois: moisCourant(), clientId: null };
let brouillon = nouveauBrouillon();
let sortie = null;
let facturationCourante = { mois: null, factures: [], emises: [] };
let occupe = false;

const app = document.getElementById('app');
const titre = document.getElementById('titre');
const barre = document.getElementById('barre');
const zoneMessage = document.getElementById('message');

const estAdmin = () => profil?.role === 'admin';
const zoneDe = id => zones.find(z => z.id === id);
const clientDe = id => clients.find(c => c.id === id);
function libelleZone(id) {
  const zone = zoneDe(id);
  if (!zone) return '—';
  const entrepot = entrepots.find(x => x.id === zone.entrepot_id);
  return `${entrepot ? entrepot.nom + ' · ' : ''}${zone.nom}`;
}
function libreDans(zoneId) {
  const zone = zoneDe(zoneId);
  if (!zone) return 0;
  return zone.superficie - stock.filter(l => l.zone_id === zoneId).reduce((s, l) => s + Number(l.superficie), 0);
}

function nouveauBrouillon() {
  return { client_id: '', nouveauClient: '', description: '', morceaux: '', longueur: '', largeur: '', superficie: '', zone_id: '', date_entree: aujourdhui(), note: '', photos: [] };
}

function message(texte, type = 'info') {
  zoneMessage.textContent = texte;
  zoneMessage.className = `message ${type}`;
  zoneMessage.hidden = false;
  clearTimeout(message.minuterie);
  message.minuterie = setTimeout(() => { zoneMessage.hidden = true; }, type === 'erreur' ? 7000 : 4000);
}

// Exécute une action réseau : bloque les doubles clics et affiche l'erreur en clair
async function executer(action) {
  if (occupe) return;
  occupe = true;
  document.body.classList.add('occupe');
  try { await action(); } catch (erreur) { message(erreur.message, 'erreur'); } finally {
    occupe = false;
    document.body.classList.remove('occupe');
  }
}

async function recharger() {
  [entrepots, zones, clients, stock] = await Promise.all([
    Donnees.liste('entrepots'), Donnees.liste('zones'), Donnees.liste('clients'), Donnees.lotsEnStock()
  ]);
  if (estAdmin()) reglages = await Donnees.reglages();
}

// Les photos sont privées : on demande des adresses temporaires (1 h) au serveur
const cachePhotos = new Map();
async function chargerPhotos() {
  const images = [...app.querySelectorAll('img[data-photo]')];
  const limite = Date.now() - 50 * 60000;
  const manquantes = [...new Set(images.map(i => i.dataset.photo))].filter(c => !(cachePhotos.get(c)?.le > limite));
  if (manquantes.length) {
    try {
      const adresses = await Donnees.adressesPhotos(manquantes);
      manquantes.forEach((chemin, i) => cachePhotos.set(chemin, { url: adresses[i], le: Date.now() }));
    } catch { /* les photos resteront grises */ }
  }
  images.forEach(i => { const p = cachePhotos.get(i.dataset.photo); if (p) i.src = p.url; });
}
const imagePhoto = (chemin, agrandir = true) => `<img class="vignette" data-photo="${e(chemin)}" ${agrandir ? 'data-action="agrandir"' : ''} alt="Photo">`;

// =====================================================================
// Connexion
// =====================================================================
function vueNonConfiguree() {
  titre.textContent = 'Entreposage';
  return `<section class="bloc"><h2>Configuration à terminer</h2>
    <p>L'application n'est pas encore reliée à sa base de données Supabase.
    Suis le guide du fichier README pour la configurer.</p></section>`;
}

function vueConnexion() {
  titre.textContent = 'Entreposage';
  return `
    <form id="form-connexion" class="bloc">
      <h2>Connexion</h2>
      <label>Courriel<input type="email" name="courriel" autocomplete="username" required></label>
      <label>Mot de passe<input type="password" name="motDePasse" autocomplete="current-password" required></label>
      <button class="principal" type="submit">Se connecter</button>
      <p class="discret">Pas de compte ? Demande à l'administrateur de t'en créer un.</p>
    </form>`;
}

// =====================================================================
// Occupation
// =====================================================================
const classeTaux = t => t >= 0.9 ? 'plein' : t >= 0.7 ? 'attention' : 'ok';
const barreTaux = t => `<div class="jauge"><div class="${classeTaux(t)}" style="width:${Math.min(100, t * 100)}%"></div></div>`;

function vueOccupation() {
  titre.textContent = 'Occupation';
  if (!zones.length) {
    return estAdmin()
      ? `<section class="bloc accueil"><h2>Bienvenue !</h2>
          <p>Pour commencer, saisis ton prix au pied carré, puis crée tes entrepôts et leurs zones avec leur superficie.</p>
          <button class="principal" data-action="aller" data-vue="reglages">Configurer mes entrepôts</button></section>`
      : '<p class="vide">Les entrepôts ne sont pas encore configurés. L\'administrateur doit d\'abord créer les zones.</p>';
  }
  const occ = Calculs.occupation({ entrepots, zones, lots: stock });
  const cartes = occ.entrepots.map(r => `
    <section class="bloc">
      <div class="titre-bloc"><h2>${e(r.entrepot.nom)}</h2><strong class="taux ${classeTaux(r.taux)}">${pourcent(r.taux)}</strong></div>
      ${barreTaux(r.taux)}
      <p class="discret">${nombre(r.occupe)} pi² occupés sur ${nombre(r.superficie)} pi² · ${nombre(r.superficie - r.occupe)} pi² libres</p>
      <ul class="zones">${r.zones.map(z => `
        <li><button data-action="voir-zone" data-id="${z.zone.id}">
          <span class="zone-haut"><strong>${e(z.zone.nom)}</strong><span>${pourcent(z.taux)}</span></span>
          ${barreTaux(z.taux)}
          <span class="discret">${nombre(z.occupe)} / ${nombre(z.zone.superficie)} pi² · ${z.lots} lot(s)</span>
        </button></li>`).join('')}</ul>
    </section>`).join('');
  return `
    <section class="bloc resume">
      <p class="discret">Taux d'occupation global</p>
      <p class="grand ${classeTaux(occ.taux)}">${pourcent(occ.taux)}</p>
      ${barreTaux(occ.taux)}
      <div class="chiffres">
        <div><strong>${nombre(occ.occupe)}</strong><span>pi² occupés</span></div>
        <div><strong>${nombre(occ.superficie - occ.occupe)}</strong><span>pi² libres</span></div>
        <div><strong>${stock.length}</strong><span>lots en stock</span></div>
      </div>
    </section>
    <div class="grille-entrepots">${cartes}</div>`;
}

// =====================================================================
// Réception d'un lot
// =====================================================================
function optionsZones(choisie, { libre = true } = {}) {
  return entrepots.map(en => {
    const sesZones = zones.filter(z => z.entrepot_id === en.id);
    if (!sesZones.length) return '';
    return `<optgroup label="${e(en.nom)}">${sesZones.map(z =>
      `<option value="${z.id}" ${z.id === choisie ? 'selected' : ''}>${e(z.nom)}${libre ? ` — libre : ${nombre(libreDans(z.id))} pi²` : ''}</option>`).join('')}</optgroup>`;
  }).join('');
}

function avertissementZone() {
  if (!brouillon.zone_id || !brouillon.superficie) return '';
  const libre = libreDans(brouillon.zone_id);
  return Number(brouillon.superficie) > libre
    ? `<p class="alerte">⚠️ Cette zone n'a que ${nombre(libre)} pi² libres.</p>` : '';
}

function vueReception() {
  titre.textContent = 'Réception';
  if (!zones.length) return '<p class="vide">Aucune zone configurée pour l\'instant.</p>';
  const b = brouillon;
  const optionsClients = clients.map(c => `<option value="${c.id}" ${c.id === b.client_id ? 'selected' : ''}>${e(c.nom)}</option>`).join('');
  const apercus = b.photos.map((p, i) => `<figure><img class="vignette" src="${p.apercu}" alt=""><button class="lien danger-texte" data-action="retirer-photo" data-index="${i}">Retirer</button></figure>`).join('');
  return `<div class="grille"><div>
    <section class="bloc">
      <h2>Photos du lot</h2>
      <p class="discret">Photographie les morceaux pour qu'on puisse les compter.</p>
      <div class="galerie">${apercus}</div>
      <label class="secondaire bouton-fichier">📷 Prendre ou ajouter des photos
        <input type="file" id="photos-reception" accept="image/*" multiple hidden></label>
    </section>
    <section class="bloc">
      <h2>Lot</h2>
      <label>Client
        <select data-champ="client_id" data-rendu><option value="">Choisir…</option>${optionsClients}<option value="nouveau" ${b.client_id === 'nouveau' ? 'selected' : ''}>＋ Nouveau client…</option></select></label>
      ${b.client_id === 'nouveau' ? `<label>Nom du nouveau client<input data-champ="nouveauClient" value="${e(b.nouveauClient)}"></label>` : ''}
      <label>Description<input data-champ="description" value="${e(b.description)}" placeholder="Ex. : poutres d'acier, caisses de pièces…"></label>
      <label>Nombre de morceaux<input type="number" inputmode="numeric" min="1" step="1" data-champ="morceaux" value="${e(b.morceaux)}"></label>
    </section></div>
    <section class="bloc">
      <h2>Superficie et emplacement</h2>
      <div class="deux">
        <label>Longueur (pi)<input type="number" inputmode="decimal" min="0" step="any" data-champ="longueur" value="${e(b.longueur)}"></label>
        <label>Largeur (pi)<input type="number" inputmode="decimal" min="0" step="any" data-champ="largeur" value="${e(b.largeur)}"></label>
      </div>
      <label>Superficie occupée (pi²)<input type="number" inputmode="decimal" min="0" step="any" id="superficie" data-champ="superficie" value="${e(b.superficie)}"></label>
      <label>Zone
        <select data-champ="zone_id"><option value="">Choisir…</option>${optionsZones(b.zone_id)}</select></label>
      <div id="avertissement">${avertissementZone()}</div>
      <label>Date d'entrée<input type="date" data-champ="date_entree" value="${e(b.date_entree)}"></label>
      <label>Remarque<textarea rows="2" data-champ="note">${e(b.note)}</textarea></label>
    </section>
    <button class="principal" data-action="enregistrer-reception">Enregistrer la réception</button></div>`;
}

async function enregistrerReception() {
  const b = brouillon;
  const morceaux = parseInt(b.morceaux, 10);
  const superficie = Number(b.superficie);
  if (!b.client_id || (b.client_id === 'nouveau' && !b.nouveauClient.trim())) throw new Error('Choisis le client.');
  if (!(morceaux > 0)) throw new Error('Indique le nombre de morceaux.');
  if (!(superficie > 0)) throw new Error('Indique la superficie occupée.');
  if (!b.zone_id) throw new Error('Choisis la zone.');
  if (!b.photos.length && !confirm('Aucune photo. Enregistrer quand même ?')) return;

  let clientId = b.client_id;
  if (clientId === 'nouveau') {
    const client = await Donnees.ajouter('clients', { nom: b.nouveauClient.trim() });
    clients.push(client);
    clientId = client.id;
  }
  const photos = await Donnees.envoyerPhotos(b.photos.map(p => p.image));
  const lot = await Donnees.recevoirLot({
    client_id: clientId, zone_id: b.zone_id, description: b.description.trim(), morceaux, superficie,
    date_entree: b.date_entree || aujourdhui(), note: b.note.trim(), photos_entree: photos
  });
  b.photos.forEach(p => URL.revokeObjectURL(p.apercu));
  brouillon = nouveauBrouillon();
  stock = await Donnees.lotsEnStock();
  message(`Lot n° ${lot.reference} enregistré en ${libelleZone(lot.zone_id)}.`, 'succes');
  allerA({ vue: 'lot', lotId: lot.id });
}

// =====================================================================
// Stock et détail d'un lot
// =====================================================================
function lotsFiltres() {
  const texte = etat.texte.trim().toLowerCase();
  return (etat.voirSortis ? sortis : stock).filter(l => {
    if (etat.zone && l.zone_id !== etat.zone) return false;
    if (!texte) return true;
    return [String(l.reference), l.description, clientDe(l.client_id)?.nom, libelleZone(l.zone_id)].join(' ').toLowerCase().includes(texte);
  });
}

function carteLot(l) {
  return `<li><button class="carte" data-action="ouvrir-lot" data-id="${l.id}">
    ${l.photos_entree[0] ? imagePhoto(l.photos_entree[0], false) : '<span class="vignette vide-photo">📦</span>'}
    <span class="carte-texte">
      <strong>Lot n° ${l.reference} · ${e(clientDe(l.client_id)?.nom || '')}</strong>
      <span>${e(l.description || 'Sans description')}</span>
      <span class="discret">${l.morceaux} morceau(x) · ${nombre(l.superficie)} pi² · ${e(libelleZone(l.zone_id))}</span>
      <span class="discret">${l.date_sortie ? `Sorti le ${dateCourte(l.date_sortie)}` : `Entré le ${dateCourte(l.date_entree)} (${joursDepuis(l.date_entree)} j)`}</span>
    </span></button></li>`;
}

function listeLots() {
  const lots = lotsFiltres();
  return lots.length ? `<ul class="cartes">${lots.map(carteLot).join('')}</ul>` : '<p class="vide">Aucun lot.</p>';
}

function vueStock() {
  titre.textContent = 'Stock';
  return `
    <div class="bascule">
      <button class="${etat.voirSortis ? '' : 'actif'}" data-action="voir-sortis" data-valeur="non">En stock (${stock.length})</button>
      <button class="${etat.voirSortis ? 'actif' : ''}" data-action="voir-sortis" data-valeur="oui">Sortis récemment</button>
    </div>
    <div class="filtres">
      <input type="search" id="recherche" placeholder="Rechercher : client, n° de lot, description…" value="${e(etat.texte)}">
      <select id="filtre-zone"><option value="">Toutes les zones</option>${optionsZones(etat.zone, { libre: false })}</select>
    </div>
    <div id="liste-lots">${listeLots()}</div>`;
}

async function vueLot() {
  let lot = stock.find(l => l.id === etat.lotId) || sortis.find(l => l.id === etat.lotId);
  const historique = lot ? await Donnees.historique(lot.reference) : [];
  lot = historique.find(l => l.id === etat.lotId) || lot;
  if (!lot) return '<p class="vide">Lot introuvable.</p>';
  titre.textContent = `Lot n° ${lot.reference}`;
  if (!sortie || sortie.lot !== lot.id) sortie = { lot: lot.id, date: aujourdhui(), morceaux: lot.morceaux, superficie: lot.superficie, note: '', photos: [] };

  const etapes = historique.length > 1 ? `
    <section class="bloc"><h2>Historique du lot</h2><ul class="historique">${historique.map(h => `
      <li class="${h.id === lot.id ? 'courant' : ''}">${h.morceaux} morceau(x), ${nombre(h.superficie)} pi² — du ${dateCourte(h.date_entree)}
        ${h.date_sortie ? `au ${dateCourte(h.date_sortie)} : <strong>${h.morceaux_sortis} sorti(s)</strong>` : ': <strong>en stock</strong>'}</li>`).join('')}</ul></section>` : '';

  const formulaireSortie = lot.date_sortie ? '' : `
    <section class="bloc">
      <h2>Sortie</h2>
      <div class="deux">
        <label>Morceaux qui sortent<input type="number" inputmode="numeric" min="1" max="${lot.morceaux}" step="1" data-sortie="morceaux" value="${e(sortie.morceaux)}"></label>
        <label>Superficie libérée (pi²)<input type="number" inputmode="decimal" min="0" step="any" id="superficie-liberee" data-sortie="superficie" value="${e(sortie.superficie)}"></label>
      </div>
      <label>Date de sortie<input type="date" data-sortie="date" value="${e(sortie.date)}"></label>
      <label>Remarque<textarea rows="2" data-sortie="note">${e(sortie.note)}</textarea></label>
      <div class="galerie">${sortie.photos.map((p, i) => `<figure><img class="vignette" src="${p.apercu}" alt=""><button class="lien danger-texte" data-action="retirer-photo-sortie" data-index="${i}">Retirer</button></figure>`).join('')}</div>
      <label class="secondaire bouton-fichier">📷 Photo à la sortie (facultatif)
        <input type="file" id="photos-sortie" accept="image/*" multiple hidden></label>
      <button class="principal" data-action="confirmer-sortie">Confirmer la sortie</button>
    </section>
    <section class="bloc" data-bloc>
      <h2>Modifier</h2>
      <label>Zone<select name="zone_id">${optionsZones(lot.zone_id, { libre: false })}</select></label>
      <label>Description<input name="description" value="${e(lot.description)}"></label>
      <label>Remarque<textarea rows="2" name="note">${e(lot.note)}</textarea></label>
      <button class="secondaire" data-action="modifier-lot">Enregistrer les modifications</button>
    </section>`;

  return `<div class="grille"><div>
    <section class="bloc">
      <div class="titre-bloc"><h2>${e(clientDe(lot.client_id)?.nom || '')}</h2>
        <span class="statut ${lot.date_sortie ? 'sorti' : ''}">${lot.date_sortie ? `Sorti le ${dateCourte(lot.date_sortie)}` : 'En stock'}</span></div>
      <p>${e(lot.description || 'Sans description')}</p>
      <dl class="fiche">
        <dt>Morceaux</dt><dd>${lot.morceaux}</dd>
        <dt>Superficie</dt><dd>${nombre(lot.superficie)} pi²</dd>
        <dt>Zone</dt><dd>${e(libelleZone(lot.zone_id))}</dd>
        <dt>Entrée</dt><dd>${dateCourte(lot.date_entree)}</dd>
        ${lot.date_sortie ? `<dt>Sortis</dt><dd>${lot.morceaux_sortis} morceau(x), ${nombre(lot.superficie_liberee)} pi² libérés</dd>` : ''}
      </dl>
      ${lot.note ? `<p class="discret">📝 ${e(lot.note)}</p>` : ''}
      ${lot.note_sortie ? `<p class="discret">📝 Sortie : ${e(lot.note_sortie)}</p>` : ''}
      <div class="galerie">${lot.photos_entree.map(imagePhoto).join('')}${lot.photos_sortie.map(imagePhoto).join('')}</div>
    </section>
    ${etapes}</div>
    <div>${formulaireSortie}</div></div>`;
}

async function confirmerSortie() {
  const lot = stock.find(l => l.id === etat.lotId);
  const morceaux = parseInt(sortie.morceaux, 10);
  const superficie = Number(sortie.superficie);
  if (!(morceaux > 0 && morceaux <= lot.morceaux)) throw new Error(`Le nombre de morceaux doit être entre 1 et ${lot.morceaux}.`);
  const partielle = morceaux < lot.morceaux;
  if (partielle && !(superficie > 0 && superficie < lot.superficie)) throw new Error(`La superficie libérée doit être entre 0 et ${nombre(lot.superficie)} pi².`);
  const resume = partielle
    ? `Sortie partielle : ${morceaux} morceau(x) sur ${lot.morceaux}, ${nombre(superficie)} pi² libérés. Le reste reste en stock.`
    : `Sortie complète du lot (${lot.morceaux} morceau(x), ${nombre(lot.superficie)} pi²).`;
  if (!confirm(`${resume}\n\nConfirmer ?`)) return;

  const photos = await Donnees.envoyerPhotos(sortie.photos.map(p => p.image));
  const reste = await Donnees.sortirLot({ lot: lot.id, date: sortie.date || aujourdhui(), morceaux, superficie: partielle ? superficie : lot.superficie, photos, note: sortie.note.trim() });
  sortie.photos.forEach(p => URL.revokeObjectURL(p.apercu));
  sortie = null;
  stock = await Donnees.lotsEnStock();
  sortis = await Donnees.lotsSortis();
  message(partielle ? 'Sortie partielle enregistrée.' : 'Sortie enregistrée.', 'succes');
  allerA(reste ? { vue: 'lot', lotId: reste } : { vue: 'stock' });
}

// =====================================================================
// Facturation mensuelle (administrateurs)
// =====================================================================
async function preparerFacturation() {
  const { debut, fin } = Calculs.bornesMois(etat.mois);
  const [lots, emises] = await Promise.all([Donnees.lotsPeriode(debut, fin), Donnees.factures(etat.mois)]);
  facturationCourante = { mois: etat.mois, emises, factures: Calculs.facturation({ lots, mois: etat.mois, reglages, clients, zones }) };
}

const factureEmise = clientId => facturationCourante.emises.find(f => f.client_id === clientId);

async function vueFacturation() {
  titre.textContent = 'Facturation';
  await preparerFacturation();
  const { factures } = facturationCourante;
  const totalHT = factures.reduce((s, f) => s + (factureEmise(f.client.id)?.sous_total ?? f.sousTotal), 0);
  const moisEnCours = etat.mois >= moisCourant();
  const cartes = factures.map(f => {
    const emise = factureEmise(f.client.id);
    return `<li><button class="carte" data-action="ouvrir-facture" data-id="${f.client.id}">
      <span class="carte-texte">
        <span class="carte-haut"><strong>${e(f.client.nom)}</strong>${emise ? `<span class="statut">N° ${e(emise.numero)}</span>` : ''}</span>
        <span class="discret">${f.lignes.length} ligne(s) · ${nombre(f.lignes.reduce((s, l) => s + l.superficie, 0))} pi²</span>
        <span class="carte-bas"><span>Total avec taxes</span><strong>${argent(emise ? emise.total : f.total)}</strong></span>
      </span></button></li>`;
  }).join('');
  return `
    <label>Mois facturé<input type="month" id="mois" value="${e(etat.mois)}" max="${moisCourant()}"></label>
    ${!Number(reglages.prix_pi2_mois) ? '<p class="alerte">⚠️ Le prix au pied carré n\'est pas saisi (Réglages).</p>' : ''}
    ${moisEnCours ? '<p class="info">Mois en cours : les montants sont calculés jusqu\'à la fin du mois pour les lots encore en stock.</p>' : ''}
    <section class="bloc resume">
      <p class="discret">${e(nomMois(etat.mois))} · ${nombre(reglages.prix_pi2_mois)} $/pi²/mois</p>
      <p class="grand">${argent(totalHT)}</p>
      <p class="discret">avant taxes · ${factures.length} client(s)</p>
    </section>
    ${cartes ? `<ul class="cartes">${cartes}</ul>` : '<p class="vide">Aucun lot à facturer ce mois-ci.</p>'}
    ${factures.length ? '<button class="secondaire" data-action="exporter-csv">📊 Exporter le mois (tableur CSV)</button>' : ''}`;
}

function vueFacture() {
  const calcul = facturationCourante.factures.find(f => f.client.id === etat.clientId);
  const emise = factureEmise(etat.clientId);
  const client = clientDe(etat.clientId) || calcul?.client;
  if (!calcul && !emise) return '<p class="vide">Facture introuvable.</p>';
  titre.textContent = 'Facture';
  const f = emise
    ? { lignes: emise.lignes, sousTotal: emise.sous_total, tps: emise.tps, tvq: emise.tvq, total: emise.total }
    : calcul;
  const ent = reglages.entreprise || {};
  const { jours } = Calculs.bornesMois(etat.mois);
  return `
    <div class="barre-doc sans-impression">
      <button class="principal" data-action="imprimer">📤 Enregistrer en PDF ou envoyer</button>
      ${emise ? '' : '<button class="secondaire" data-action="emettre-facture">✅ Émettre la facture (numéro définitif)</button>'}
    </div>
    ${emise ? '' : '<p class="info sans-impression">Aperçu : la facture n\'a pas encore de numéro. Émets-la pour la figer.</p>'}
    <article class="document">
      <div class="doc-entete">
        <div>
          <p class="doc-entreprise">${e(ent.nom || 'Entreposage')}</p>
          ${ent.adresse ? `<p>${e(ent.adresse)}</p>` : ''}
          ${ent.telephone ? `<p>${e(ent.telephone)}</p>` : ''}
          ${ent.courriel ? `<p>${e(ent.courriel)}</p>` : ''}
        </div>
        <div class="doc-numero">
          <p class="doc-type">Facture</p>
          <p>${emise ? `N° ${e(emise.numero)}` : 'Aperçu'}</p>
          <p>${dateCourte(emise ? emise.emise_le.slice(0, 10) : aujourdhui())}</p>
        </div>
      </div>
      <div class="doc-parties">
        <div><h3>Facturé à</h3>
          <p><strong>${e(client?.nom)}</strong></p>
          ${client?.contact ? `<p>${e(client.contact)}</p>` : ''}
          ${client?.adresse ? `<p>${e(client.adresse)}</p>` : ''}
          ${client?.courriel ? `<p>${e(client.courriel)}</p>` : ''}
        </div>
        <div><h3>Période</h3>
          <p>Entreposage de ${e(nomMois(etat.mois))}</p>
          <p>Tarif : ${nombre(reglages.prix_pi2_mois)} $/pi²/mois, au prorata des jours (${jours} jours dans le mois)</p>
        </div>
      </div>
      <table class="doc-prix"><thead><tr><th>Lot</th><th>Zone</th><th>pi²</th><th>Période</th><th>Jours</th><th>Montant</th></tr></thead><tbody>
        ${f.lignes.map(l => `<tr><td>N° ${l.reference}${l.description ? `<br><small>${e(l.description)}</small>` : ''}</td><td>${e(l.zone)}</td>
          <td>${nombre(l.superficie)}</td><td>${jourMois(l.du)} au ${jourMois(l.au)}</td><td>${l.jours}</td><td>${argent(l.montant)}</td></tr>`).join('')}
      </tbody></table>
      <div class="doc-totaux">
        <p><span>Sous-total</span><span>${argent(f.sousTotal)}</span></p>
        ${Number(f.tps) || Number(f.tvq) ? `<p><span>TPS</span><span>${argent(f.tps)}</span></p><p><span>TVQ</span><span>${argent(f.tvq)}</span></p>` : ''}
        <p class="total"><span>Total</span><span>${argent(f.total)}</span></p>
        ${ent.numerosTaxes ? `<p class="discret">${e(ent.numerosTaxes)}</p>` : ''}
      </div>
    </article>`;
}

async function emettreFacture() {
  const f = facturationCourante.factures.find(x => x.client.id === etat.clientId);
  if (etat.mois >= moisCourant() && !confirm('Le mois n\'est pas terminé : la facture sera calculée jusqu\'à la fin du mois. Continuer ?')) return;
  if (!confirm(`Émettre la facture de ${f.client.nom} pour ${nomMois(etat.mois)} : ${argent(f.total)} ?\nElle recevra un numéro définitif.`)) return;
  await Donnees.emettreFacture({ client: f.client.id, mois: etat.mois, lignes: f.lignes, sousTotal: f.sousTotal, tps: f.tps, tvq: f.tvq, total: f.total });
  facturationCourante.emises = await Donnees.factures(etat.mois);
  message('Facture émise.', 'succes');
  afficher();
}

function exporterCsv() {
  const colonnes = ['Client', 'Facture', 'Lignes', 'Superficie (pi²)', 'Sous-total', 'TPS', 'TVQ', 'Total'];
  const cellule = v => `"${String(v).replace(/"/g, '""')}"`;
  const montant = n => Number(n).toFixed(2).replace('.', ',');
  const lignes = facturationCourante.factures.map(f => {
    const emise = factureEmise(f.client.id);
    const source = emise ? { sousTotal: emise.sous_total, tps: emise.tps, tvq: emise.tvq, total: emise.total } : f;
    return [f.client.nom, emise?.numero || '', f.lignes.length, f.lignes.reduce((s, l) => s + l.superficie, 0),
      montant(source.sousTotal), montant(source.tps), montant(source.tvq), montant(source.total)].map(cellule).join(';');
  });
  const contenu = '﻿' + [colonnes.map(cellule).join(';'), ...lignes].join('\r\n');
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
  lien.download = `facturation-${etat.mois}.csv`;
  lien.click();
}

// =====================================================================
// Réglages (administrateurs) et compte
// =====================================================================
async function vueReglages() {
  titre.textContent = 'Réglages';
  const profils = await Donnees.profils();
  const ent = reglages.entreprise || {};
  const blocsEntrepots = entrepots.map(en => {
    const sesZones = zones.filter(z => z.entrepot_id === en.id);
    const total = sesZones.reduce((s, z) => s + Number(z.superficie), 0);
    return `
      <section class="bloc">
        <div data-bloc>
          <div class="deux">
            <label>Entrepôt<input name="nom" value="${e(en.nom)}"></label>
            <label>Adresse<input name="adresse" value="${e(en.adresse)}"></label>
          </div>
          <div class="actions">
            <button class="lien" data-action="enregistrer-entrepot" data-id="${en.id}">Enregistrer</button>
            <button class="lien danger-texte" data-action="supprimer-entrepot" data-id="${en.id}">Supprimer</button>
          </div>
        </div>
        <p class="discret">${sesZones.length} zone(s) · ${nombre(total)} pi² au total</p>
        ${sesZones.map(z => `
          <div class="ligne-zone" data-bloc>
            <input name="nom" value="${e(z.nom)}" aria-label="Nom de la zone">
            <input name="superficie" type="number" inputmode="decimal" min="0" step="any" value="${e(z.superficie)}" aria-label="Superficie en pi²">
            <button class="lien" data-action="enregistrer-zone" data-id="${z.id}" aria-label="Enregistrer">💾</button>
            <button class="lien danger-texte" data-action="supprimer-zone" data-id="${z.id}" aria-label="Supprimer">✕</button>
          </div>`).join('')}
        <div class="ligne-zone nouvelle" data-bloc>
          <input name="nom" placeholder="Nouvelle zone (ex. A)">
          <input name="superficie" type="number" inputmode="decimal" min="0" step="any" placeholder="pi²">
          <button class="lien" data-action="ajouter-zone" data-id="${en.id}">＋ Ajouter</button>
        </div>
      </section>`;
  }).join('');
  const blocsClients = clients.map(c => `
    <details class="bloc">
      <summary>${e(c.nom)}</summary>
      <div data-bloc>
        <label>Nom<input name="nom" value="${e(c.nom)}"></label>
        <label>Personne-ressource<input name="contact" value="${e(c.contact)}"></label>
        <label>Téléphone<input name="telephone" type="tel" value="${e(c.telephone)}"></label>
        <label>Courriel (facturation)<input name="courriel" type="email" value="${e(c.courriel)}"></label>
        <label>Adresse<input name="adresse" value="${e(c.adresse)}"></label>
        <div class="actions">
          <button class="secondaire" data-action="enregistrer-client" data-id="${c.id}">Enregistrer</button>
          <button class="lien danger-texte" data-action="supprimer-client" data-id="${c.id}">Supprimer</button>
        </div>
      </div>
    </details>`).join('');
  const blocsProfils = profils.map(p => `
    <div class="ligne-profil" data-bloc>
      <span>${e(p.courriel)}</span>
      <select name="role" data-action-change="role" data-id="${p.id}" ${p.id === profil.id ? 'disabled' : ''}>
        <option value="employe" ${p.role === 'employe' ? 'selected' : ''}>Employé</option>
        <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Administrateur</option>
      </select>
    </div>`).join('');

  return `
    ${!zones.length ? '<p class="info">Bienvenue ! Étape 1 : saisis ton prix au pied carré. Étape 2 : crée tes entrepôts, puis leurs zones avec leur superficie.</p>' : ''}
    <section class="bloc" data-bloc>
      <h2>Tarif</h2>
      <label>Prix au pied carré par mois ($)<input name="prix_pi2_mois" type="number" inputmode="decimal" min="0" step="any" value="${e(reglages.prix_pi2_mois)}"></label>
      <label class="case"><input name="taxes" type="checkbox" ${reglages.taxes ? 'checked' : ''}> <span>Ajouter les taxes aux factures</span></label>
      <div class="deux">
        <label>TPS (%)<input name="tps" type="number" inputmode="decimal" step="any" value="${e(reglages.tps)}"></label>
        <label>TVQ (%)<input name="tvq" type="number" inputmode="decimal" step="any" value="${e(reglages.tvq)}"></label>
      </div>
      <button class="secondaire" data-action="enregistrer-tarif">Enregistrer le tarif</button>
    </section>

    <h2 class="titre-section">Entrepôts et zones</h2>
    ${blocsEntrepots}
    <section class="bloc" data-bloc>
      <div class="deux">
        <label>Nouvel entrepôt<input name="nom" placeholder="Ex. : Entrepôt principal"></label>
        <label>Adresse<input name="adresse"></label>
      </div>
      <button class="secondaire" data-action="ajouter-entrepot">＋ Ajouter l'entrepôt</button>
    </section>

    <h2 class="titre-section">Clients</h2>
    ${blocsClients || '<p class="vide">Aucun client. Ils peuvent aussi être créés à la réception.</p>'}
    <section class="bloc" data-bloc>
      <label>Nouveau client<input name="nom" placeholder="Nom de l'entreprise"></label>
      <button class="secondaire" data-action="ajouter-client">＋ Ajouter le client</button>
    </section>

    <section class="bloc" data-bloc>
      <h2>Entreprise (en-tête des factures)</h2>
      <label>Nom<input name="nom" value="${e(ent.nom)}"></label>
      <label>Adresse<input name="adresse" value="${e(ent.adresse)}"></label>
      <label>Téléphone<input name="telephone" type="tel" value="${e(ent.telephone)}"></label>
      <label>Courriel<input name="courriel" type="email" value="${e(ent.courriel)}"></label>
      <label>Numéros de TPS / TVQ<input name="numerosTaxes" value="${e(ent.numerosTaxes)}"></label>
      <button class="secondaire" data-action="enregistrer-entreprise">Enregistrer</button>
    </section>

    <section class="bloc">
      <h2>Utilisateurs</h2>
      ${blocsProfils}
      <p class="discret">Pour ajouter un employé : Supabase › Authentication › Users › « Add user » (courriel + mot de passe, cocher « Auto Confirm »). Il apparaît ici comme employé.</p>
    </section>
    ${blocCompte()}`;
}

function blocCompte() {
  return `
    <section class="bloc" data-bloc>
      <h2>Mon compte</h2>
      <p>${e(profil.courriel)} · ${profil.role === 'admin' ? 'Administrateur' : 'Employé'}</p>
      <label>Nouveau mot de passe<input name="motDePasse" type="password" autocomplete="new-password" minlength="8"></label>
      <button class="secondaire" data-action="changer-mot-de-passe">Changer le mot de passe</button>
      <button class="danger" data-action="deconnexion">Se déconnecter</button>
    </section>`;
}

function vueCompte() {
  titre.textContent = 'Mon compte';
  return blocCompte();
}

// Lit les champs nommés d'un bloc de formulaire
function valeurs(bloc) {
  const resultat = {};
  bloc.querySelectorAll('[name]').forEach(champ => {
    if (champ.closest('[data-bloc]') !== bloc) return;
    resultat[champ.name] = champ.type === 'checkbox' ? champ.checked
      : champ.type === 'number' ? (champ.value === '' ? null : Number(champ.value)) : champ.value.trim();
  });
  return resultat;
}

// =====================================================================
// Affichage et navigation
// =====================================================================
const ONGLETS_ADMIN = [['occupation', '📊', 'Occupation'], ['reception', '📥', 'Réception'], ['stock', '📦', 'Stock'], ['facturation', '💲', 'Facturation'], ['reglages', '⚙️', 'Réglages']];
const ONGLETS_EMPLOYE = [['occupation', '📊', 'Occupation'], ['reception', '📥', 'Réception'], ['stock', '📦', 'Stock'], ['compte', '👤', 'Compte']];
const PARENT = { lot: 'stock', facture: 'facturation' };

function afficherBarre() {
  if (!profil) { barre.hidden = true; return; }
  barre.hidden = false;
  const actif = PARENT[etat.vue] || etat.vue;
  barre.innerHTML = (estAdmin() ? ONGLETS_ADMIN : ONGLETS_EMPLOYE).map(([vue, icone, nom]) =>
    `<button class="${vue === actif ? 'actif' : ''}" data-action="aller" data-vue="${vue}"><span>${icone}</span>${nom}</button>`).join('');
}

async function afficher() {
  afficherBarre();
  document.getElementById('retour').hidden = !PARENT[etat.vue];
  if (!Donnees.configure) { app.innerHTML = vueNonConfiguree(); return; }
  if (!profil) { app.innerHTML = vueConnexion(); return; }
  const vues = { occupation: vueOccupation, reception: vueReception, stock: vueStock, lot: vueLot, facturation: vueFacturation, facture: vueFacture, reglages: vueReglages, compte: vueCompte };
  const reservee = ['facturation', 'facture', 'reglages'].includes(etat.vue) && !estAdmin();
  const vue = vues[etat.vue] && !reservee ? vues[etat.vue] : vueOccupation;
  try {
    app.innerHTML = await vue();
  } catch (erreur) {
    app.innerHTML = `<p class="vide">Impossible de charger cet écran.</p>`;
    message(erreur.message, 'erreur');
  }
  chargerPhotos();
}

function allerA(nouvelEtat) {
  Object.assign(etat, nouvelEtat);
  window.scrollTo(0, 0);
  return afficher();
}

document.getElementById('retour').addEventListener('click', () => allerA({ vue: PARENT[etat.vue] }));

// =====================================================================
// Événements
// =====================================================================
document.addEventListener('submit', evenement => {
  if (evenement.target.id !== 'form-connexion') return;
  evenement.preventDefault();
  const formulaire = new FormData(evenement.target);
  executer(async () => {
    await Donnees.connexion(formulaire.get('courriel'), formulaire.get('motDePasse'));
    await demarrerSession();
  });
});

app.addEventListener('input', evenement => {
  const champ = evenement.target;
  if (champ.id === 'recherche') {
    etat.texte = champ.value;
    document.getElementById('liste-lots').innerHTML = listeLots();
    chargerPhotos();
    return;
  }
  if (champ.dataset.champ) {
    brouillon[champ.dataset.champ] = champ.value;
    // Longueur × largeur remplit la superficie
    if ((champ.dataset.champ === 'longueur' || champ.dataset.champ === 'largeur') && brouillon.longueur > 0 && brouillon.largeur > 0) {
      brouillon.superficie = String(Calculs.arrondi(brouillon.longueur * brouillon.largeur));
      document.getElementById('superficie').value = brouillon.superficie;
    }
    const avertissement = document.getElementById('avertissement');
    if (avertissement) avertissement.innerHTML = avertissementZone();
  }
  if (champ.dataset.sortie) {
    sortie[champ.dataset.sortie] = champ.value;
    // Superficie libérée proposée au prorata des morceaux
    const lot = stock.find(l => l.id === etat.lotId);
    if (champ.dataset.sortie === 'morceaux' && lot && Number(champ.value) > 0) {
      sortie.superficie = String(Calculs.arrondi(lot.superficie * Math.min(Number(champ.value), lot.morceaux) / lot.morceaux));
      document.getElementById('superficie-liberee').value = sortie.superficie;
    }
  }
});

app.addEventListener('change', evenement => {
  const champ = evenement.target;
  if (champ.id === 'photos-reception' || champ.id === 'photos-sortie') {
    const cible = champ.id === 'photos-reception' ? brouillon : sortie;
    const fichiers = [...champ.files];
    return executer(async () => {
      for (const fichier of fichiers) {
        const image = await compresserPhoto(fichier);
        cible.photos.push({ image, apercu: URL.createObjectURL(image) });
      }
      afficher();
    });
  }
  if (champ.id === 'filtre-zone') { etat.zone = champ.value; document.getElementById('liste-lots').innerHTML = listeLots(); chargerPhotos(); return; }
  if (champ.id === 'mois' && champ.value) return executer(() => allerA({ mois: champ.value }));
  if (champ.dataset.champ && champ.hasAttribute('data-rendu')) { brouillon[champ.dataset.champ] = champ.value; afficher(); return; }
  if (champ.dataset.actionChange === 'role') {
    return executer(async () => {
      await Donnees.modifier('profils', champ.dataset.id, { role: champ.value });
      message('Rôle modifié.', 'succes');
    });
  }
});

document.addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-action]');
  if (!bouton) return;
  const id = bouton.dataset.id;
  const bloc = bouton.closest('[data-bloc]');
  const lot = () => stock.find(l => l.id === etat.lotId);

  const actions = {
    aller: () => allerA({ vue: bouton.dataset.vue }),
    'voir-zone': () => allerA({ vue: 'stock', zone: id, texte: '', voirSortis: false }),
    'voir-sortis': async () => {
      etat.voirSortis = bouton.dataset.valeur === 'oui';
      if (etat.voirSortis) sortis = await Donnees.lotsSortis();
      afficher();
    },
    'ouvrir-lot': () => allerA({ vue: 'lot', lotId: id }),
    agrandir: () => { if (bouton.src) window.open(bouton.src, '_blank'); },
    'retirer-photo': () => { URL.revokeObjectURL(brouillon.photos[bouton.dataset.index].apercu); brouillon.photos.splice(bouton.dataset.index, 1); afficher(); },
    'retirer-photo-sortie': () => { sortie.photos.splice(bouton.dataset.index, 1); afficher(); },
    'enregistrer-reception': enregistrerReception,
    'confirmer-sortie': confirmerSortie,
    'modifier-lot': async () => {
      await Donnees.modifier('lots', etat.lotId, valeurs(bloc));
      stock = await Donnees.lotsEnStock();
      message('Lot modifié.', 'succes');
      afficher();
    },

    'ouvrir-facture': () => allerA({ vue: 'facture', clientId: id }),
    'emettre-facture': emettreFacture,
    'exporter-csv': exporterCsv,
    imprimer: () => window.print(),

    'enregistrer-tarif': async () => {
      const v = valeurs(bloc);
      await Donnees.modifierReglages({ prix_pi2_mois: v.prix_pi2_mois || 0, taxes: v.taxes, tps: v.tps || 0, tvq: v.tvq || 0 });
      await recharger();
      message('Tarif enregistré.', 'succes');
    },
    'enregistrer-entreprise': async () => {
      await Donnees.modifierReglages({ entreprise: valeurs(bloc) });
      await recharger();
      message('Enregistré.', 'succes');
    },
    'ajouter-entrepot': async () => {
      const v = valeurs(bloc);
      if (!v.nom) throw new Error('Donne un nom à l\'entrepôt.');
      await Donnees.ajouter('entrepots', v);
      await recharger(); afficher();
    },
    'enregistrer-entrepot': async () => { await Donnees.modifier('entrepots', id, valeurs(bloc)); await recharger(); message('Entrepôt enregistré.', 'succes'); },
    'supprimer-entrepot': async () => {
      if (zones.some(z => z.entrepot_id === id)) throw new Error('Supprime d\'abord les zones de cet entrepôt.');
      if (!confirm('Supprimer cet entrepôt ?')) return;
      await Donnees.supprimer('entrepots', id); await recharger(); afficher();
    },
    'ajouter-zone': async () => {
      const v = valeurs(bloc);
      if (!v.nom || !(v.superficie > 0)) throw new Error('Indique le nom de la zone et sa superficie en pi².');
      await Donnees.ajouter('zones', { ...v, entrepot_id: id });
      await recharger(); afficher();
    },
    'enregistrer-zone': async () => {
      const v = valeurs(bloc);
      if (!v.nom || v.superficie === null) throw new Error('Indique le nom et la superficie.');
      await Donnees.modifier('zones', id, v); await recharger(); message('Zone enregistrée.', 'succes');
    },
    'supprimer-zone': async () => {
      if (stock.some(l => l.zone_id === id)) throw new Error('Cette zone contient des lots.');
      if (!confirm('Supprimer cette zone ?')) return;
      try { await Donnees.supprimer('zones', id); } catch { throw new Error('Cette zone a un historique de lots : elle ne peut pas être supprimée. Renomme-la plutôt.'); }
      await recharger(); afficher();
    },
    'ajouter-client': async () => {
      const v = valeurs(bloc);
      if (!v.nom) throw new Error('Indique le nom du client.');
      await Donnees.ajouter('clients', v); await recharger(); afficher();
    },
    'enregistrer-client': async () => { await Donnees.modifier('clients', id, valeurs(bloc)); await recharger(); message('Client enregistré.', 'succes'); },
    'supprimer-client': async () => {
      if (!confirm('Supprimer ce client ?')) return;
      try { await Donnees.supprimer('clients', id); } catch { throw new Error('Ce client a des lots ou des factures : il ne peut pas être supprimé.'); }
      await recharger(); afficher();
    },

    'changer-mot-de-passe': async () => {
      const { motDePasse } = valeurs(bloc);
      if (!motDePasse || motDePasse.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.');
      await Donnees.changerMotDePasse(motDePasse);
      message('Mot de passe changé.', 'succes');
    },
    deconnexion: async () => {
      await Donnees.deconnexion();
      profil = null; reglages = null;
      allerA({ vue: 'occupation' });
    }
  };
  const action = actions[bouton.dataset.action];
  if (action) executer(action);
});

// =====================================================================
// Démarrage
// =====================================================================
async function demarrerSession() {
  profil = await Donnees.profil();
  await recharger();
  allerA({ vue: estAdmin() && !zones.length ? 'reglages' : 'occupation' });
}

(async function demarrer() {
  if (Donnees.configure) {
    try {
      if (await Donnees.session()) return await demarrerSession();
    } catch (erreur) {
      message(erreur.message, 'erreur');
    }
  }
  afficher();
})();
