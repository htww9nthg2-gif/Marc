'use strict';

// Accès aux données partagées (Supabase). Tout l'écran passe par cet objet.
const Donnees = (() => {
  const configure = Boolean(CONFIG.url && CONFIG.cle);
  const sb = configure ? supabase.createClient(CONFIG.url, CONFIG.cle) : null;

  const MESSAGES = {
    'Invalid login credentials': 'Courriel ou mot de passe incorrect.',
    'Email not confirmed': 'Ce compte n\'est pas encore confirmé.',
    'Failed to fetch': 'Pas de connexion au serveur. Vérifie le réseau.'
  };
  function verifier({ data, error }) {
    if (error) throw new Error(MESSAGES[error.message] || error.message);
    return data;
  }
  const identifiant = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

  return {
    configure,

    async session() { return verifier(await sb.auth.getSession()).session; },
    async connexion(courriel, motDePasse) { verifier(await sb.auth.signInWithPassword({ email: courriel, password: motDePasse })); },
    async deconnexion() { await sb.auth.signOut(); },
    async changerMotDePasse(motDePasse) { verifier(await sb.auth.updateUser({ password: motDePasse })); },

    async profil() {
      const { user } = verifier(await sb.auth.getUser());
      return verifier(await sb.from('profils').select('*').eq('id', user.id).single());
    },
    profils: async () => verifier(await sb.from('profils').select('*').order('courriel')),

    reglages: async () => verifier(await sb.from('reglages').select('*').eq('id', 1).single()),
    modifierReglages: async champs => verifier(await sb.from('reglages').update(champs).eq('id', 1)),

    // entrepots, zones, clients, profils
    liste: async table => verifier(await sb.from(table).select('*').order(table === 'profils' ? 'courriel' : 'nom')),
    ajouter: async (table, objet) => verifier(await sb.from(table).insert(objet).select().single()),
    modifier: async (table, id, champs) => verifier(await sb.from(table).update(champs).eq('id', id)),
    supprimer: async (table, id) => verifier(await sb.from(table).delete().eq('id', id)),

    lotsEnStock: async () => verifier(await sb.from('lots').select('*').is('date_sortie', null).order('numero', { ascending: false })),
    lotsSortis: async () => verifier(await sb.from('lots').select('*').not('date_sortie', 'is', null).order('date_sortie', { ascending: false }).limit(200)),
    lotsPeriode: async (debut, fin) => verifier(await sb.from('lots').select('*').lte('date_entree', fin).or(`date_sortie.is.null,date_sortie.gte.${debut}`)),
    historique: async reference => verifier(await sb.from('lots').select('*').eq('reference', reference).order('numero')),
    recevoirLot: async lot => verifier(await sb.from('lots').insert(lot).select().single()),
    sortirLot: async ({ lot, date, morceaux, superficie, photos, note }) =>
      verifier(await sb.rpc('sortir_lot', { p_lot: lot, p_date: date, p_morceaux: morceaux, p_superficie: superficie, p_photos: photos, p_note: note })),

    async envoyerPhotos(images) {
      const chemins = [];
      for (const image of images) {
        const chemin = `${new Date().toISOString().slice(0, 7)}/${identifiant()}.jpg`;
        verifier(await sb.storage.from('photos').upload(chemin, image, { contentType: 'image/jpeg' }));
        chemins.push(chemin);
      }
      return chemins;
    },
    async adressesPhotos(chemins) {
      if (!chemins.length) return [];
      return verifier(await sb.storage.from('photos').createSignedUrls(chemins, 3600)).map(p => p.signedUrl);
    },

    factures: async mois => verifier(await sb.from('factures').select('*').eq('mois', `${mois}-01`)),
    emettreFacture: async ({ client, mois, lignes, sousTotal, tps, tvq, total }) =>
      verifier(await sb.rpc('emettre_facture', { p_client: client, p_mois: `${mois}-01`, p_lignes: lignes, p_sous_total: sousTotal, p_tps: tps, p_tvq: tvq, p_total: total }))
  };
})();
