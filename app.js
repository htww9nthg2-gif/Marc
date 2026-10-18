'use strict';

// =====================================================================
// Base de données sur le téléphone (IndexedDB) : les photos et les PDF
// sont trop lourds pour localStorage.
// =====================================================================
const BD = (() => {
  let connexion;
  function ouvrir() {
    connexion ??= new Promise((ok, ko) => {
      const requete = indexedDB.open('visite-chantier', 1);
      requete.onupgradeneeded = () => {
        const base = requete.result;
        base.createObjectStore('dossiers', { keyPath: 'id' });
        base.createObjectStore('procedures', { keyPath: 'id' });
        base.createObjectStore('reglages', { keyPath: 'cle' });
      };
      requete.onsuccess = () => ok(requete.result);
      requete.onerror = () => ko(requete.error);
    });
    return connexion;
  }
  async function operation(magasin, mode, action) {
    const base = await ouvrir();
    return new Promise((ok, ko) => {
      const transaction = base.transaction(magasin, mode);
      const requete = action(transaction.objectStore(magasin));
      transaction.oncomplete = () => ok(requete.result);
      transaction.onerror = () => ko(transaction.error);
    });
  }
  return {
    lire: (magasin, id) => operation(magasin, 'readonly', m => m.get(id)),
    tout: magasin => operation(magasin, 'readonly', m => m.getAll()),
    ecrire: (magasin, objet) => operation(magasin, 'readwrite', m => m.put(objet)),
    supprimer: (magasin, id) => operation(magasin, 'readwrite', m => m.delete(id))
  };
})();

// =====================================================================
// Réglages par défaut : tarifs, options et conditions (tout est modifiable)
// Un prix à 0 signifie « à définir » : la ligne est signalée dans la soumission.
// Aucun tarif réel ici (dépôt public) : ils se saisissent dans l'application et restent sur le téléphone.
// =====================================================================
const CATEGORIES = ['Équipes', 'Chariots élévateurs', 'Grues', 'Frais fixes', 'Matériel', 'Autre'];
const UNITES = { h: 'heure', jour: 'jour', forfait: 'forfait', unite: 'unité' };

const REGLAGES_DEFAUT = {
  cle: 'principal',
  entreprise: { nom: 'Summerside', adresse: 'Boucherville (Québec)', telephone: '', courriel: '', responsable: '', numerosTaxes: '' },
  tps: 5,
  tvq: 9.975,
  minimumHeures: 4,
  validiteJours: 30,
  prochainNumero: 1,
  catalogue: [
    { id: 'eq4', categorie: 'Équipes', nom: 'Équipe de 4 hommes + camion + chariot 7,5 t', unite: 'h', prix: 0, minimum: true },
    { id: 'eq3', categorie: 'Équipes', nom: 'Équipe de 3 hommes + camion + chariot 7,5 t', unite: 'h', prix: 0, minimum: true },
    { id: 'ch15', categorie: 'Chariots élévateurs', nom: 'Chariot élévateur 15 t', unite: 'jour', prix: 0 },
    { id: 'ch25', categorie: 'Chariots élévateurs', nom: 'Chariot élévateur 25 t', unite: 'jour', prix: 0 },
    { id: 'ch35', categorie: 'Chariots élévateurs', nom: 'Chariot élévateur 35 t', unite: 'jour', prix: 0 },
    { id: 'gr45', categorie: 'Grues', nom: 'Grue 45 t', unite: 'h', prix: 0 },
    { id: 'gr70', categorie: 'Grues', nom: 'Grue 70 t', unite: 'h', prix: 0 },
    { id: 'mob', categorie: 'Frais fixes', nom: 'Mobilisation / démobilisation des équipements', unite: 'forfait', prix: 0 },
    { id: 'rem', categorie: 'Frais fixes', nom: 'Transport par remorque', unite: 'h', prix: 0 },
    { id: 'perm', categorie: 'Frais fixes', nom: 'Permis de transport hors normes', unite: 'forfait', prix: 0 },
    { id: 'esc', categorie: 'Frais fixes', nom: 'Escorte routière', unite: 'h', prix: 0 },
    { id: 'pat', categorie: 'Matériel', nom: 'Patins à rouleaux', unite: 'jour', prix: 0 },
    { id: 'ver', categorie: 'Matériel', nom: 'Vérins hydrauliques', unite: 'jour', prix: 0 },
    { id: 'pla', categorie: 'Matériel', nom: 'Plaques d\'acier (protection de plancher)', unite: 'jour', prix: 0 },
    { id: 'cai', categorie: 'Matériel', nom: 'Caisse / emballage', unite: 'unite', prix: 0 }
  ],
  conditions: [
    { id: 'c1', texte: 'Le débranchement et le rebranchement électrique, pneumatique et hydraulique sont à la charge du client.' },
    { id: 'c2', texte: 'Le client garantit un accès dégagé aux machines et aux voies de passage le jour des travaux.' },
    { id: 'c3', texte: 'La capacité portante des planchers, dalles et quais est sous la responsabilité du client.' },
    { id: 'c4', texte: 'Les permis et frais municipaux ne sont pas inclus, sauf mention contraire.' },
    { id: 'c5', texte: 'Prix établis pour des travaux en heures normales, du lundi au vendredi.' },
    { id: 'c6', texte: 'Le temps d\'attente causé par le client est facturé au taux horaire en vigueur.' },
    { id: 'c7', texte: 'Soumission valide {validite} jours à compter de sa date d\'émission.' }
  ]
};

const CATEGORIES_ENJEUX = ['Accès / porte', 'Plancher / capacité', 'Hauteur / obstacle', 'Débranchement', 'Ancrage', 'Point de levage', 'Sécurité', 'Autre'];
const STATUTS = ['Visite', 'Soumission envoyée', 'Acceptée', 'Planifiée', 'Terminée', 'Refusée'];

// =====================================================================
// Petits outils
// =====================================================================
const e = texte => String(texte ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatArgent = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
const argent = n => formatArgent.format(n || 0);
const nombre = n => new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 3 }).format(n || 0);
const identifiant = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateLongue = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const unite = (u, n) => (UNITES[u] || u) + (n > 1 && u !== 'forfait' ? 's' : '');

// Modifie une propriété à partir d'un chemin du type « lignes.2.prix »
function definir(objet, chemin, valeur) {
  const morceaux = chemin.split('.');
  const dernier = morceaux.pop();
  morceaux.reduce((o, cle) => o[cle], objet)[dernier] = valeur;
}

// Réduit les photos pour ne pas remplir le téléphone (1600 px, JPEG)
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
      ok(toile.toDataURL('image/jpeg', 0.75));
    };
    image.onerror = ko;
    image.src = adresse;
  });
}

function ouvrirFichier(blob) {
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(blob);
  lien.target = '_blank';
  lien.rel = 'noopener';
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
}

// Partage par la feuille de partage de l'iPhone (courriel, Messages, Fichiers…)
async function partagerFichiers(fichiers, titre) {
  if (navigator.canShare?.({ files: fichiers })) {
    try { await navigator.share({ files: fichiers, title: titre }); } catch { /* partage annulé */ }
    return true;
  }
  return false;
}

// =====================================================================
// État de l'application
// =====================================================================
let reglages;
let dossiers = [];
let procedures = [];
let etat = { vue: 'accueil', dossierId: null, onglet: 'infos', document: null };

const app = document.getElementById('app');
const titre = document.getElementById('titre');
const boutonRetour = document.getElementById('retour');

const dossierCourant = () => dossiers.find(d => d.id === etat.dossierId);

// Sauvegarde différée : on n'écrit pas à chaque lettre tapée
const enAttente = new Map();
function sauverBientot(magasin, objet) {
  const cle = magasin + (objet.id || objet.cle);
  clearTimeout(enAttente.get(cle)?.minuterie);
  enAttente.set(cle, {
    magasin, objet,
    minuterie: setTimeout(() => { enAttente.delete(cle); BD.ecrire(magasin, objet); }, 400)
  });
}
function toutSauver() {
  for (const { minuterie, magasin, objet } of enAttente.values()) {
    clearTimeout(minuterie);
    BD.ecrire(magasin, objet);
  }
  enAttente.clear();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) toutSauver(); });

function nouveauDossier() {
  const annee = new Date().getFullYear();
  const numero = `${annee}-${String(reglages.prochainNumero).padStart(3, '0')}`;
  reglages.prochainNumero++;
  BD.ecrire('reglages', reglages);
  return {
    id: identifiant(),
    numero,
    cree: Date.now(),
    modifie: Date.now(),
    statut: 'Visite',
    client: { nom: '', contact: '', telephone: '', courriel: '' },
    dateVisite: aujourdhui(),
    dateTravaux: '',
    lieuDepart: '',
    lieuArrivee: '',
    description: '',
    machines: [],
    photos: [],
    lignes: [],
    options: { taxes: true, minimum: false, conditions: true, photosSoumission: false },
    conditions: reglages.conditions.map(c => c.id),
    procedures: [],
    consignes: ''
  };
}

// =====================================================================
// Calcul de la soumission
// =====================================================================
function calculer(dossier) {
  const lignes = dossier.lignes.map(ligne => {
    const minimumApplique = dossier.options.minimum && ligne.minimum && ligne.unite === 'h' && ligne.duree < reglages.minimumHeures;
    const dureeFacturee = minimumApplique ? reglages.minimumHeures : ligne.duree;
    return { ...ligne, dureeFacturee, minimumApplique, montant: ligne.nombre * dureeFacturee * ligne.prix };
  });
  const sousTotal = lignes.reduce((s, l) => s + l.montant, 0);
  const tps = dossier.options.taxes ? sousTotal * reglages.tps / 100 : 0;
  const tvq = dossier.options.taxes ? sousTotal * reglages.tvq / 100 : 0;
  return { lignes, sousTotal, tps, tvq, total: sousTotal + tps + tvq, aDefinir: lignes.filter(l => !l.prix) };
}

// =====================================================================
// Morceaux de formulaire réutilisables
// =====================================================================
function champ(libelle, chemin, valeur, { type = 'text', cible = 'dossier', id = '', indice = '', rendu = false } = {}) {
  const numerique = type === 'number' ? 'inputmode="decimal" step="any" min="0"' : '';
  return `<label>${libelle}<input type="${type}" ${numerique} data-cible="${cible}" data-id="${id}" data-champ="${chemin}"
    ${rendu ? 'data-rendu' : ''} value="${e(valeur)}" placeholder="${e(indice)}"></label>`;
}
function zoneTexte(libelle, chemin, valeur, { cible = 'dossier', id = '', indice = '' } = {}) {
  return `<label>${libelle}<textarea rows="3" data-cible="${cible}" data-id="${id}" data-champ="${chemin}"
    placeholder="${e(indice)}">${e(valeur)}</textarea></label>`;
}
function liste(libelle, chemin, valeur, choix, { cible = 'dossier', id = '', rendu = false } = {}) {
  const options = Object.entries(choix).map(([v, t]) => `<option value="${e(v)}" ${v === valeur ? 'selected' : ''}>${e(t)}</option>`).join('');
  return `<label>${libelle}<select data-cible="${cible}" data-id="${id}" data-champ="${chemin}" ${rendu ? 'data-rendu' : ''}>${options}</select></label>`;
}
function caseACocher(libelle, chemin, coche, { cible = 'dossier', id = '', rendu = false } = {}) {
  return `<label class="case"><input type="checkbox" data-cible="${cible}" data-id="${id}" data-champ="${chemin}"
    ${rendu ? 'data-rendu' : ''} ${coche ? 'checked' : ''}> <span>${libelle}</span></label>`;
}
const enListe = tableau => Object.fromEntries(tableau.map(v => [v, v]));

// =====================================================================
// Écran d'accueil
// =====================================================================
function vueAccueil() {
  titre.textContent = 'Visites de chantier';
  const tries = [...dossiers].sort((a, b) => b.modifie - a.modifie);
  const cartes = tries.map(d => `
    <li><button class="carte" data-action="ouvrir" data-id="${d.id}">
      <span class="carte-haut"><strong>${e(d.client.nom || 'Client à préciser')}</strong><span class="statut">${e(d.statut)}</span></span>
      <span class="discret">N° ${e(d.numero)} · visite du ${e(dateLongue(d.dateVisite))}</span>
      ${d.lieuDepart ? `<span class="discret">📍 ${e(d.lieuDepart)}</span>` : ''}
      <span class="carte-bas">${d.machines.length} machine(s) · ${d.photos.length} photo(s)<strong>${argent(calculer(d).total)}</strong></span>
    </button></li>`).join('');
  const sansTarifs = reglages.catalogue.every(a => !a.prix);
  return `
    ${sansTarifs ? '<p class="info">Première utilisation : commence par saisir tes tarifs dans « Tarifs, conditions et procédures ».</p>' : ''}
    <button class="principal" data-action="nouveau">＋ Nouvelle visite</button>
    ${cartes ? `<ul class="cartes">${cartes}</ul>` : '<p class="vide">Aucune visite pour l\'instant. Touche « Nouvelle visite » en arrivant sur le chantier.</p>'}
    <button class="secondaire" data-action="reglages">⚙️ Tarifs, conditions et procédures</button>`;
}

// =====================================================================
// Dossier de visite, en onglets
// =====================================================================
const ONGLETS = { infos: 'Infos', machines: 'Machines', photos: 'Photos', estimation: 'Prix', procedures: 'Procédures', documents: 'Documents' };

function vueDossier() {
  const d = dossierCourant();
  titre.textContent = d.client.nom || `Visite ${d.numero}`;
  const onglets = Object.entries(ONGLETS).map(([cle, nom]) =>
    `<button class="${cle === etat.onglet ? 'actif' : ''}" data-action="onglet" data-onglet="${cle}">${nom}</button>`).join('');
  const contenu = { infos: ongletInfos, machines: ongletMachines, photos: ongletPhotos, estimation: ongletEstimation, procedures: ongletProcedures, documents: ongletDocuments }[etat.onglet](d);
  return `<nav class="onglets">${onglets}</nav><div class="contenu-onglet">${contenu}</div>`;
}

function ongletInfos(d) {
  return `
    <section class="bloc">
      <p class="discret">Dossier n° ${e(d.numero)}</p>
      ${liste('Statut', 'statut', d.statut, enListe(STATUTS))}
    </section>
    <section class="bloc">
      <h2>Client</h2>
      ${champ('Entreprise', 'client.nom', d.client.nom, { indice: 'Nom du client' })}
      ${champ('Personne-ressource', 'client.contact', d.client.contact)}
      ${champ('Téléphone', 'client.telephone', d.client.telephone, { type: 'tel' })}
      ${champ('Courriel', 'client.courriel', d.client.courriel, { type: 'email' })}
    </section>
    <section class="bloc">
      <h2>Chantier</h2>
      ${champ('Lieu de départ', 'lieuDepart', d.lieuDepart, { indice: 'Adresse de l\'usine actuelle' })}
      ${champ('Lieu d\'arrivée', 'lieuArrivee', d.lieuArrivee, { indice: 'Même bâtiment, autre usine…' })}
      <div class="deux">
        ${champ('Date de visite', 'dateVisite', d.dateVisite, { type: 'date' })}
        ${champ('Date prévue des travaux', 'dateTravaux', d.dateTravaux, { type: 'date' })}
      </div>
      ${zoneTexte('Description des travaux', 'description', d.description, { indice: 'Ex. : déplacer 3 presses du bâtiment A vers le quai de chargement, chargement sur remorque…' })}
    </section>
    <button class="danger" data-action="supprimer-dossier">Supprimer ce dossier</button>`;
}

function ongletMachines(d) {
  const plusLourde = d.machines.reduce((max, m) => Math.max(max, Number(m.poids) || 0), 0);
  const fiches = d.machines.map((m, i) => `
    <section class="bloc">
      <div class="titre-bloc"><h2>Machine ${i + 1}</h2><button class="lien danger-texte" data-action="supprimer-machine" data-index="${i}">Retirer</button></div>
      ${champ('Nom / type', `machines.${i}.nom`, m.nom, { indice: 'Ex. : presse plieuse, tour CNC…' })}
      ${champ('Marque et modèle', `machines.${i}.modele`, m.modele)}
      <div class="deux">
        ${champ('Poids (tonnes)', `machines.${i}.poids`, m.poids, { type: 'number' })}
        ${champ('Dimensions L × l × H', `machines.${i}.dimensions`, m.dimensions, { indice: 'ex. 4 × 2 × 3 m' })}
      </div>
      ${zoneTexte('Remarques', `machines.${i}.notes`, m.notes, { indice: 'Ancrée au sol, fosse, points de levage, centre de gravité…' })}
    </section>`).join('');
  return `
    ${plusLourde ? `<p class="info">Machine la plus lourde : <strong>${nombre(plusLourde)} t</strong>. Vérifie la capacité du chariot ou de la grue dans l'onglet Prix.</p>` : ''}
    ${fiches || '<p class="vide">Ajoute chaque machine à déplacer.</p>'}
    <button class="principal" data-action="ajouter-machine">＋ Ajouter une machine</button>`;
}

function ongletPhotos(d) {
  const cartes = d.photos.map((p, i) => `
    <section class="bloc photo">
      <img src="${e(p.image)}" alt="Photo ${i + 1}">
      ${liste('Enjeu', `photos.${i}.categorie`, p.categorie, enListe(CATEGORIES_ENJEUX))}
      ${zoneTexte('Ce qu\'il faut savoir', `photos.${i}.note`, p.note, { indice: 'Ex. : porte de 3 m de large, prévoir de retirer le cadre' })}
      <button class="lien danger-texte" data-action="supprimer-photo" data-index="${i}">Supprimer la photo</button>
    </section>`).join('');
  return `
    <label class="principal bouton-fichier">📷 Prendre ou ajouter des photos
      <input type="file" id="ajout-photos" accept="image/*" multiple hidden>
    </label>
    <p class="discret centre">Photographie chaque enjeu : portes, planchers, obstacles, ancrages, points de levage…</p>
    ${cartes}`;
}

function ongletEstimation(d) {
  const calcul = calculer(d);
  const groupes = CATEGORIES.map(cat => {
    const articles = reglages.catalogue.filter(a => a.categorie === cat);
    if (!articles.length) return '';
    return `<optgroup label="${e(cat)}">${articles.map(a =>
      `<option value="${a.id}">${e(a.nom)}${a.prix ? ` — ${argent(a.prix)}/${UNITES[a.unite]}` : ' — prix à définir'}</option>`).join('')}</optgroup>`;
  }).join('');
  const lignes = calcul.lignes.map((l, i) => `
    <section class="bloc ligne">
      <div class="titre-bloc">${champ('', `lignes.${i}.nom`, l.nom)}<button class="lien danger-texte" data-action="supprimer-ligne" data-index="${i}" aria-label="Retirer">✕</button></div>
      <div class="trois">
        ${champ('Nombre', `lignes.${i}.nombre`, l.nombre, { type: 'number' })}
        ${champ(`Durée (${unite(l.unite, 2)})`, `lignes.${i}.duree`, l.duree, { type: 'number' })}
        ${champ(`Taux / ${UNITES[l.unite]}`, `lignes.${i}.prix`, l.prix, { type: 'number' })}
      </div>
      <p class="montant-ligne" id="montant-${l.id}">${montantLigne(l)}</p>
    </section>`).join('');
  const conditions = reglages.conditions.map(c => `
    <label class="case"><input type="checkbox" data-liste="conditions" data-id="${c.id}" ${d.conditions.includes(c.id) ? 'checked' : ''}>
      <span>${e(texteCondition(c))}</span></label>`).join('');
  return `
    <section class="bloc">
      <h2>Ajouter une ressource</h2>
      <select id="choix-ressource"><option value="">Choisir dans les tarifs…</option>${groupes}<option value="libre">Ligne libre (autre)</option></select>
      <button class="principal" data-action="ajouter-ligne">＋ Ajouter</button>
    </section>
    ${lignes || '<p class="vide">Ajoute les équipes, chariots, grues et frais nécessaires.</p>'}
    <section class="bloc">
      <h2>Options de la soumission</h2>
      ${caseACocher(`Taxes (TPS ${nombre(reglages.tps)} % et TVQ ${nombre(reglages.tvq)} %)`, 'options.taxes', d.options.taxes)}
      ${caseACocher(`Minimum de ${nombre(reglages.minimumHeures)} h facturées par équipe`, 'options.minimum', d.options.minimum)}
      ${caseACocher('Joindre les photos à la soumission', 'options.photosSoumission', d.options.photosSoumission)}
      ${caseACocher('Ajouter les conditions et exclusions', 'options.conditions', d.options.conditions, { rendu: true })}
      ${d.options.conditions ? `<div class="sous-liste">${conditions}</div>` : ''}
    </section>
    <section class="bloc totaux" id="totaux">${blocTotaux(calcul)}</section>`;
}

function montantLigne(l) {
  if (!l.prix) return '<span class="alerte">Prix à définir</span>';
  const detail = `${nombre(l.nombre)} × ${nombre(l.dureeFacturee)} ${unite(l.unite, l.dureeFacturee)} × ${argent(l.prix)}`;
  return `${detail}${l.minimumApplique ? ' <span class="alerte">(minimum appliqué)</span>' : ''} = <strong>${argent(l.montant)}</strong>`;
}

function blocTotaux(calcul) {
  const d = dossierCourant();
  return `
    <p><span>Sous-total</span><span>${argent(calcul.sousTotal)}</span></p>
    ${d.options.taxes ? `<p><span>TPS</span><span>${argent(calcul.tps)}</span></p><p><span>TVQ</span><span>${argent(calcul.tvq)}</span></p>` : ''}
    <p class="total"><span>Total</span><span>${argent(calcul.total)}</span></p>
    ${calcul.aDefinir.length ? `<p class="alerte">${calcul.aDefinir.length} ligne(s) sans prix.</p>` : ''}`;
}

function texteCondition(c) {
  return c.texte.replace('{validite}', reglages.validiteJours);
}

function ongletProcedures(d) {
  const lignes = procedures.map(p => `
    <div class="procedure">
      <label class="case"><input type="checkbox" data-liste="procedures" data-id="${p.id}" ${d.procedures.includes(p.id) ? 'checked' : ''}>
        <span>${e(p.nom)}</span></label>
      <button class="lien" data-action="ouvrir-procedure" data-id="${p.id}">Voir</button>
    </div>`).join('');
  return `
    <section class="bloc">
      <h2>Procédures à suivre</h2>
      <p class="discret">Coche les procédures qui s'appliquent à ce chantier. Elles seront listées dans le bon de travail.</p>
      ${lignes || '<p class="vide">Aucune procédure enregistrée pour l\'instant.</p>'}
      <label class="secondaire bouton-fichier">📄 Importer des procédures (PDF)
        <input type="file" id="import-pdf" accept="application/pdf" multiple hidden>
      </label>
    </section>
    <section class="bloc">
      <h2>Consignes à l'équipe</h2>
      ${zoneTexte('', 'consignes', d.consignes, { indice: 'Ex. : arriver par la porte 4, le contremaître du client est Marc, débranchement fait la veille…' })}
    </section>`;
}

function ongletDocuments(d) {
  const calcul = calculer(d);
  return `
    <button class="document-bouton" data-action="voir-document" data-type="soumission">
      <strong>💲 Soumission pour le client</strong>
      <span>Avec les prix : ${argent(calcul.total)}</span>
    </button>
    <button class="document-bouton" data-action="voir-document" data-type="bon">
      <strong>🛠️ Bon de travail pour l'équipe</strong>
      <span>Sans les prix, avec les photos, les consignes et ${d.procedures.length} procédure(s)</span>
    </button>
    <p class="discret centre">Dans le document, touche « Enregistrer en PDF ou envoyer » puis utilise le bouton Partager de l'iPhone.</p>`;
}

// =====================================================================
// Documents : soumission (client) et bon de travail (équipe)
// =====================================================================
function enteteDocument(d, type) {
  const ent = reglages.entreprise;
  const nom = type === 'soumission' ? 'Soumission' : 'Bon de travail';
  const prefixe = type === 'soumission' ? 'S' : 'BT';
  return `
    <div class="doc-entete">
      <div>
        <p class="doc-entreprise">${e(ent.nom)}</p>
        <p>${e(ent.adresse)}</p>
        ${ent.telephone ? `<p>${e(ent.telephone)}</p>` : ''}
        ${ent.courriel ? `<p>${e(ent.courriel)}</p>` : ''}
      </div>
      <div class="doc-numero">
        <p class="doc-type">${nom}</p>
        <p>N° ${prefixe}-${e(d.numero)}</p>
        <p>${e(dateLongue(type === 'soumission' ? aujourdhui() : d.dateTravaux) || 'Date des travaux à confirmer')}</p>
      </div>
    </div>
    <div class="doc-parties">
      <div><h3>Client</h3>
        <p><strong>${e(d.client.nom)}</strong></p>
        ${d.client.contact ? `<p>${e(d.client.contact)}</p>` : ''}
        ${d.client.telephone ? `<p>${e(d.client.telephone)}</p>` : ''}
        ${d.client.courriel ? `<p>${e(d.client.courriel)}</p>` : ''}
      </div>
      <div><h3>Chantier</h3>
        ${d.lieuDepart ? `<p>Départ : ${e(d.lieuDepart)}</p>` : ''}
        ${d.lieuArrivee ? `<p>Arrivée : ${e(d.lieuArrivee)}</p>` : ''}
        ${type === 'soumission' && d.dateTravaux ? `<p>Travaux prévus : ${e(dateLongue(d.dateTravaux))}</p>` : ''}
      </div>
    </div>
    ${d.description ? `<h3>Description des travaux</h3><p class="doc-texte">${e(d.description)}</p>` : ''}`;
}

function tableauMachines(d) {
  if (!d.machines.length) return '';
  return `
    <h3>Machines à déplacer</h3>
    <table><thead><tr><th>Machine</th><th>Poids</th><th>Dimensions</th></tr></thead><tbody>
      ${d.machines.map(m => `<tr><td>${e(m.nom)}${m.modele ? `<br><small>${e(m.modele)}</small>` : ''}${m.notes ? `<br><small>${e(m.notes)}</small>` : ''}</td>
        <td>${m.poids ? `${nombre(m.poids)} t` : ''}</td><td>${e(m.dimensions)}</td></tr>`).join('')}
    </tbody></table>`;
}

function grillePhotos(d) {
  if (!d.photos.length) return '';
  return `
    <h3>Points d'attention relevés à la visite</h3>
    <div class="doc-photos">
      ${d.photos.map((p, i) => `<figure><img src="${e(p.image)}" alt="">
        <figcaption><strong>${i + 1}. ${e(p.categorie)}</strong>${p.note ? ` — ${e(p.note)}` : ''}</figcaption></figure>`).join('')}
    </div>`;
}

function documentSoumission(d) {
  const calcul = calculer(d);
  const conditions = reglages.conditions.filter(c => d.conditions.includes(c.id));
  return `
    ${enteteDocument(d, 'soumission')}
    ${tableauMachines(d)}
    <h3>Prix</h3>
    <table class="doc-prix"><thead><tr><th>Description</th><th>Qté</th><th>Durée</th><th>Taux</th><th>Montant</th></tr></thead><tbody>
      ${calcul.lignes.map(l => `<tr><td>${e(l.nom)}${l.minimumApplique ? `<br><small>Minimum de ${nombre(reglages.minimumHeures)} h</small>` : ''}</td>
        <td>${nombre(l.nombre)}</td><td>${nombre(l.dureeFacturee)} ${unite(l.unite, l.dureeFacturee)}</td>
        <td>${l.prix ? argent(l.prix) : 'À définir'}</td><td>${argent(l.montant)}</td></tr>`).join('')}
    </tbody></table>
    <div class="doc-totaux">
      <p><span>Sous-total</span><span>${argent(calcul.sousTotal)}</span></p>
      ${d.options.taxes ? `<p><span>TPS (${nombre(reglages.tps)} %)</span><span>${argent(calcul.tps)}</span></p>
        <p><span>TVQ (${nombre(reglages.tvq)} %)</span><span>${argent(calcul.tvq)}</span></p>` : ''}
      <p class="total"><span>Total</span><span>${argent(calcul.total)}</span></p>
      ${d.options.taxes && reglages.entreprise.numerosTaxes ? `<p class="discret">${e(reglages.entreprise.numerosTaxes)}</p>` : ''}
    </div>
    ${d.options.photosSoumission ? grillePhotos(d) : ''}
    ${d.options.conditions && conditions.length ? `<h3>Conditions et exclusions</h3><ul class="doc-liste">${conditions.map(c => `<li>${e(texteCondition(c))}</li>`).join('')}</ul>` : ''}
    <div class="doc-signatures">
      <div><p>Préparée par</p><p class="ligne-signature">${e(reglages.entreprise.responsable)}</p></div>
      <div><p>Acceptée par le client (nom, signature, date)</p><p class="ligne-signature"></p></div>
    </div>`;
}

function documentBon(d) {
  const choisies = procedures.filter(p => d.procedures.includes(p.id));
  return `
    ${enteteDocument(d, 'bon')}
    ${d.lignes.length ? `<h3>Équipes et équipements</h3><table><thead><tr><th>Ressource</th><th>Qté</th><th>Durée prévue</th></tr></thead><tbody>
      ${d.lignes.map(l => `<tr><td>${e(l.nom)}</td><td>${nombre(l.nombre)}</td><td>${l.unite === 'forfait' ? '—' : `${nombre(l.duree)} ${unite(l.unite, l.duree)}`}</td></tr>`).join('')}
    </tbody></table>` : ''}
    ${tableauMachines(d)}
    ${d.consignes ? `<h3>Consignes</h3><p class="doc-texte">${e(d.consignes)}</p>` : ''}
    ${choisies.length ? `<h3>Procédures à suivre</h3><ul class="doc-liste">${choisies.map(p => `<li>${e(p.nom)}
      <button class="lien sans-impression" data-action="ouvrir-procedure" data-id="${p.id}">Voir</button></li>`).join('')}</ul>` : ''}
    ${grillePhotos(d)}
    <div class="doc-signatures">
      <div><p>Chef d'équipe</p><p class="ligne-signature"></p></div>
      <div><p>Travaux terminés le (date, heure)</p><p class="ligne-signature"></p></div>
    </div>`;
}

function vueDocument() {
  const d = dossierCourant();
  const type = etat.document;
  titre.textContent = type === 'soumission' ? 'Soumission' : 'Bon de travail';
  const aDesProcedures = type === 'bon' && d.procedures.length;
  return `
    <div class="barre-doc sans-impression">
      <button class="principal" data-action="imprimer">📤 Enregistrer en PDF ou envoyer</button>
      ${aDesProcedures ? '<button class="secondaire" data-action="partager-procedures">📄 Envoyer les procédures (PDF)</button>' : ''}
    </div>
    <article class="document">${type === 'soumission' ? documentSoumission(d) : documentBon(d)}</article>`;
}

// =====================================================================
// Réglages : entreprise, tarifs, conditions, procédures, sauvegarde
// =====================================================================
function vueReglages() {
  titre.textContent = 'Réglages';
  const ent = reglages.entreprise;
  const articles = reglages.catalogue.map((a, i) => `
    <section class="bloc ligne">
      <div class="titre-bloc">${champ('', `catalogue.${i}.nom`, a.nom, { cible: 'reglages' })}
        <button class="lien danger-texte" data-action="supprimer-article" data-index="${i}" aria-label="Retirer">✕</button></div>
      <div class="trois">
        ${liste('Catégorie', `catalogue.${i}.categorie`, a.categorie, enListe(CATEGORIES), { cible: 'reglages' })}
        ${liste('Unité', `catalogue.${i}.unite`, a.unite, UNITES, { cible: 'reglages', rendu: true })}
        ${champ('Prix', `catalogue.${i}.prix`, a.prix, { type: 'number', cible: 'reglages' })}
      </div>
      ${a.unite === 'h' ? caseACocher('Soumis au minimum d\'heures', `catalogue.${i}.minimum`, a.minimum, { cible: 'reglages' }) : ''}
    </section>`).join('');
  const conditions = reglages.conditions.map((c, i) => `
    <div class="condition">
      <textarea rows="2" data-cible="reglages" data-champ="conditions.${i}.texte">${e(c.texte)}</textarea>
      <button class="lien danger-texte" data-action="supprimer-condition" data-index="${i}" aria-label="Retirer">✕</button>
    </div>`).join('');
  const listeProcedures = procedures.map(p => `
    <div class="procedure">
      <input type="text" data-cible="procedure" data-id="${p.id}" data-champ="nom" value="${e(p.nom)}">
      <button class="lien" data-action="ouvrir-procedure" data-id="${p.id}">Voir</button>
      <button class="lien danger-texte" data-action="supprimer-procedure" data-id="${p.id}" aria-label="Supprimer">✕</button>
    </div>`).join('');
  return `
    <section class="bloc">
      <h2>Entreprise (en-tête des documents)</h2>
      ${champ('Nom', 'entreprise.nom', ent.nom, { cible: 'reglages' })}
      ${champ('Adresse', 'entreprise.adresse', ent.adresse, { cible: 'reglages' })}
      ${champ('Téléphone', 'entreprise.telephone', ent.telephone, { type: 'tel', cible: 'reglages' })}
      ${champ('Courriel', 'entreprise.courriel', ent.courriel, { type: 'email', cible: 'reglages' })}
      ${champ('Préparé par (ton nom)', 'entreprise.responsable', ent.responsable, { cible: 'reglages' })}
      ${champ('Numéros de TPS / TVQ', 'entreprise.numerosTaxes', ent.numerosTaxes, { cible: 'reglages', indice: 'TPS : … / TVQ : …' })}
    </section>
    <section class="bloc">
      <h2>Taxes et règles</h2>
      <div class="deux">
        ${champ('TPS (%)', 'tps', reglages.tps, { type: 'number', cible: 'reglages' })}
        ${champ('TVQ (%)', 'tvq', reglages.tvq, { type: 'number', cible: 'reglages' })}
        ${champ('Minimum d\'heures par équipe', 'minimumHeures', reglages.minimumHeures, { type: 'number', cible: 'reglages' })}
        ${champ('Validité de la soumission (jours)', 'validiteJours', reglages.validiteJours, { type: 'number', cible: 'reglages' })}
      </div>
    </section>
    <h2 class="titre-section">Tarifs</h2>
    ${articles}
    <button class="secondaire" data-action="ajouter-article">＋ Ajouter un tarif</button>
    <section class="bloc">
      <h2>Conditions et exclusions types</h2>
      <p class="discret">{validite} est remplacé par la durée de validité.</p>
      ${conditions}
      <button class="secondaire" data-action="ajouter-condition">＋ Ajouter une condition</button>
    </section>
    <section class="bloc">
      <h2>Procédures (PDF)</h2>
      ${listeProcedures || '<p class="vide">Aucune procédure. Importe les PDF depuis l\'app Fichiers de l\'iPhone.</p>'}
      <label class="secondaire bouton-fichier">📄 Importer des procédures (PDF)
        <input type="file" id="import-pdf" accept="application/pdf" multiple hidden>
      </label>
    </section>
    <section class="bloc">
      <h2>Sauvegarde</h2>
      <p class="discret">Les données restent sur ce téléphone. Fais une sauvegarde de temps en temps (sans les PDF de procédures).</p>
      <button class="secondaire" data-action="exporter">💾 Exporter une sauvegarde</button>
      <label class="secondaire bouton-fichier">↩️ Restaurer une sauvegarde
        <input type="file" id="import-sauvegarde" accept="application/json,.json" hidden>
      </label>
    </section>`;
}

// =====================================================================
// Affichage et navigation
// =====================================================================
function afficher() {
  boutonRetour.hidden = etat.vue === 'accueil';
  const vues = { accueil: vueAccueil, dossier: vueDossier, document: vueDocument, reglages: vueReglages };
  app.innerHTML = vues[etat.vue]();
}

function allerA(nouvelEtat) {
  toutSauver();
  Object.assign(etat, nouvelEtat);
  afficher();
  window.scrollTo(0, 0);
}

boutonRetour.addEventListener('click', () => {
  if (etat.vue === 'document') allerA({ vue: 'dossier' });
  else allerA({ vue: 'accueil', dossierId: null });
});

// Retrouve l'objet modifié par un champ de formulaire
function cibleDe(element) {
  if (element.dataset.cible === 'reglages') return ['reglages', reglages];
  if (element.dataset.cible === 'procedure') return ['procedures', procedures.find(p => p.id === element.dataset.id)];
  return ['dossiers', dossierCourant()];
}

function surSaisie(evenement) {
  const element = evenement.target;

  // Cases des listes de conditions et de procédures d'un dossier
  if (element.dataset.liste) {
    const d = dossierCourant();
    const choix = new Set(d[element.dataset.liste]);
    element.checked ? choix.add(element.dataset.id) : choix.delete(element.dataset.id);
    d[element.dataset.liste] = [...choix];
    d.modifie = Date.now();
    sauverBientot('dossiers', d);
    return;
  }
  if (!element.dataset.champ) return;

  const [magasin, objet] = cibleDe(element);
  let valeur = element.value;
  if (element.type === 'checkbox') valeur = element.checked;
  else if (element.type === 'number') valeur = element.value === '' ? 0 : Number(element.value);
  definir(objet, element.dataset.champ, valeur);
  if (magasin === 'dossiers') objet.modifie = Date.now();
  sauverBientot(magasin, objet);

  if (element.hasAttribute('data-rendu') && evenement.type === 'change') afficher();
  else if (etat.vue === 'dossier' && etat.onglet === 'estimation') mettreAJourMontants();
}

// Met à jour les montants sans redessiner l'écran (pour ne pas fermer le clavier)
function mettreAJourMontants() {
  const calcul = calculer(dossierCourant());
  calcul.lignes.forEach(l => {
    const zone = document.getElementById(`montant-${l.id}`);
    if (zone) zone.innerHTML = montantLigne(l);
  });
  const totaux = document.getElementById('totaux');
  if (totaux) totaux.innerHTML = blocTotaux(calcul);
}

app.addEventListener('input', surSaisie);
app.addEventListener('change', async evenement => {
  const element = evenement.target;
  if (element.id === 'ajout-photos') return ajouterPhotos(element.files);
  if (element.id === 'import-pdf') return importerProcedures(element.files);
  if (element.id === 'import-sauvegarde') return restaurer(element.files[0]);
  if (element.type === 'checkbox' || element.tagName === 'SELECT') surSaisie(evenement);
});

async function ajouterPhotos(fichiers) {
  const d = dossierCourant();
  app.insertAdjacentHTML('afterbegin', '<p class="info" id="chargement">Ajout des photos…</p>');
  for (const fichier of fichiers) {
    d.photos.push({ id: identifiant(), image: await compresserPhoto(fichier), categorie: CATEGORIES_ENJEUX[0], note: '' });
  }
  d.modifie = Date.now();
  await BD.ecrire('dossiers', d);
  afficher();
}

async function importerProcedures(fichiers) {
  for (const fichier of fichiers) {
    const procedure = { id: identifiant(), nom: fichier.name.replace(/\.pdf$/i, ''), fichier };
    await BD.ecrire('procedures', procedure);
    procedures.push(procedure);
  }
  procedures.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  afficher();
}

async function exporter() {
  toutSauver();
  const contenu = JSON.stringify({ application: 'visite-chantier', version: 1, reglages, dossiers });
  const fichier = new File([contenu], `sauvegarde-chantier-${aujourdhui()}.json`, { type: 'application/json' });
  if (await partagerFichiers([fichier], 'Sauvegarde des visites de chantier')) return;
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(fichier);
  lien.download = fichier.name;
  lien.click();
}

async function restaurer(fichier) {
  if (!fichier) return;
  try {
    const donnees = JSON.parse(await fichier.text());
    if (donnees.application !== 'visite-chantier' || !Array.isArray(donnees.dossiers)) throw new Error();
    // Une sauvegarde est un fichier qui peut venir d'ailleurs : les photos doivent être de vraies images
    const imageValide = image => typeof image === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
    for (const d of donnees.dossiers) {
      if (!d || typeof d !== 'object' || !Array.isArray(d.photos) || !d.photos.every(p => imageValide(p?.image))) throw new Error();
    }
    // Les identifiants et numéros sont repris tels quels dans la page : ils ne doivent contenir aucun balisage
    const identifiantsSurs = valeur => {
      if (Array.isArray(valeur)) return valeur.every(identifiantsSurs);
      if (!valeur || typeof valeur !== 'object') return true;
      return Object.entries(valeur).every(([cle, v]) =>
        (['id', 'numero', 'ressourceId'].includes(cle) ? v == null || /^[\w-]{1,64}$/.test(String(v)) : true) && identifiantsSurs(v));
    };
    if (!identifiantsSurs(donnees.dossiers) || !identifiantsSurs(donnees.reglages)) throw new Error();
    if (!confirm(`Restaurer ${donnees.dossiers.length} dossier(s) et les réglages ? Les dossiers du même numéro seront remplacés.`)) return;
    reglages = { ...REGLAGES_DEFAUT, ...donnees.reglages };
    await BD.ecrire('reglages', reglages);
    for (const d of donnees.dossiers) await BD.ecrire('dossiers', d);
    dossiers = await BD.tout('dossiers');
    alert('Sauvegarde restaurée.');
    allerA({ vue: 'accueil' });
  } catch {
    alert('Ce fichier n\'est pas une sauvegarde de l\'application.');
  }
}

// Toutes les actions des boutons, regroupées
app.addEventListener('click', async evenement => {
  const bouton = evenement.target.closest('[data-action]');
  if (!bouton) return;
  const d = dossierCourant();
  const index = Number(bouton.dataset.index);
  const modifierDossier = () => { d.modifie = Date.now(); BD.ecrire('dossiers', d); afficher(); };
  const modifierReglages = () => { BD.ecrire('reglages', reglages); afficher(); };

  switch (bouton.dataset.action) {
    case 'nouveau': {
      const nouveau = nouveauDossier();
      dossiers.push(nouveau);
      await BD.ecrire('dossiers', nouveau);
      allerA({ vue: 'dossier', dossierId: nouveau.id, onglet: 'infos' });
      break;
    }
    case 'ouvrir': allerA({ vue: 'dossier', dossierId: bouton.dataset.id, onglet: 'infos' }); break;
    case 'reglages': allerA({ vue: 'reglages' }); break;
    case 'onglet': allerA({ onglet: bouton.dataset.onglet }); break;
    case 'supprimer-dossier':
      if (!confirm('Supprimer définitivement ce dossier et ses photos ?')) return;
      dossiers = dossiers.filter(x => x.id !== d.id);
      await BD.supprimer('dossiers', d.id);
      allerA({ vue: 'accueil', dossierId: null });
      break;

    case 'ajouter-machine':
      d.machines.push({ nom: '', modele: '', poids: '', dimensions: '', notes: '' });
      modifierDossier();
      break;
    case 'supprimer-machine':
      if (confirm('Retirer cette machine ?')) { d.machines.splice(index, 1); modifierDossier(); }
      break;
    case 'supprimer-photo':
      if (confirm('Supprimer cette photo ?')) { d.photos.splice(index, 1); modifierDossier(); }
      break;

    case 'ajouter-ligne': {
      const choix = document.getElementById('choix-ressource').value;
      if (!choix) return;
      const article = choix === 'libre'
        ? { nom: 'Autre', categorie: 'Autre', unite: 'forfait', prix: 0 }
        : reglages.catalogue.find(a => a.id === choix);
      d.lignes.push({
        id: identifiant(), ressourceId: article.id || null, nom: article.nom, categorie: article.categorie,
        unite: article.unite, prix: article.prix, minimum: !!article.minimum, nombre: 1, duree: article.unite === 'forfait' || article.unite === 'unite' ? 1 : 0
      });
      modifierDossier();
      break;
    }
    case 'supprimer-ligne': d.lignes.splice(index, 1); modifierDossier(); break;

    case 'ouvrir-procedure': {
      const procedure = procedures.find(p => p.id === bouton.dataset.id);
      if (procedure) ouvrirFichier(procedure.fichier);
      break;
    }
    case 'voir-document': allerA({ vue: 'document', document: bouton.dataset.type }); break;
    case 'imprimer': window.print(); break;
    case 'partager-procedures': {
      const fichiers = procedures.filter(p => d.procedures.includes(p.id))
        .map(p => new File([p.fichier], `${p.nom}.pdf`, { type: 'application/pdf' }));
      if (!await partagerFichiers(fichiers, `Procédures — BT-${d.numero}`)) alert('Le partage de fichiers n\'est pas disponible sur cet appareil.');
      break;
    }

    case 'ajouter-article':
      reglages.catalogue.push({ id: identifiant(), categorie: 'Autre', nom: 'Nouveau tarif', unite: 'h', prix: 0 });
      modifierReglages();
      break;
    case 'supprimer-article':
      if (confirm(`Retirer « ${reglages.catalogue[index].nom} » des tarifs ?`)) { reglages.catalogue.splice(index, 1); modifierReglages(); }
      break;
    case 'ajouter-condition':
      reglages.conditions.push({ id: identifiant(), texte: '' });
      modifierReglages();
      break;
    case 'supprimer-condition':
      reglages.conditions.splice(index, 1);
      modifierReglages();
      break;
    case 'supprimer-procedure':
      if (!confirm('Supprimer cette procédure du téléphone ?')) return;
      procedures = procedures.filter(p => p.id !== bouton.dataset.id);
      await BD.supprimer('procedures', bouton.dataset.id);
      afficher();
      break;
    case 'exporter': exporter(); break;
  }
});

// =====================================================================
// Démarrage
// =====================================================================
(async function demarrer() {
  reglages = await BD.lire('reglages', 'principal');
  if (!reglages) {
    reglages = structuredClone(REGLAGES_DEFAUT);
    await BD.ecrire('reglages', reglages);
  }
  dossiers = await BD.tout('dossiers');
  procedures = (await BD.tout('procedures')).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  afficher();
})();
