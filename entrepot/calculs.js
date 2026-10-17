'use strict';

// Calculs purs (sans écran ni base de données) : occupation et facturation au prorata.
// Les dates sont des chaînes « AAAA-MM-JJ » ; un mois est « AAAA-MM ».
const Calculs = (() => {
  const UN_JOUR = 86400000;
  const jour = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const versIso = temps => new Date(temps).toISOString().slice(0, 10);
  const arrondi = n => Math.round(n * 100) / 100;

  function bornesMois(mois) {
    const [annee, m] = mois.split('-').map(Number);
    const fin = Date.UTC(annee, m, 0);
    return { debut: versIso(Date.UTC(annee, m - 1, 1)), fin: versIso(fin), jours: new Date(fin).getUTCDate() };
  }

  // Période du lot comprise dans [debut, fin], jour d'entrée et jour de sortie inclus
  function periodeFacturee(lot, debut, fin) {
    const du = Math.max(jour(lot.date_entree), jour(debut));
    const au = Math.min(lot.date_sortie ? jour(lot.date_sortie) : Infinity, jour(fin));
    if (du > au) return null;
    return { du: versIso(du), au: versIso(au), jours: Math.round((au - du) / UN_JOUR) + 1 };
  }

  // Une facture par client : superficie × prix mensuel × jours présents / jours du mois
  function facturation({ lots, mois, reglages, clients, zones }) {
    const { debut, fin, jours: joursMois } = bornesMois(mois);
    const parClient = new Map();
    for (const lot of lots) {
      const periode = periodeFacturee(lot, debut, fin);
      if (!periode) continue;
      const montant = arrondi(lot.superficie * reglages.prix_pi2_mois * periode.jours / joursMois);
      const zone = zones.find(z => z.id === lot.zone_id);
      if (!parClient.has(lot.client_id)) parClient.set(lot.client_id, []);
      parClient.get(lot.client_id).push({
        reference: lot.reference, description: lot.description, zone: zone ? zone.nom : '',
        superficie: Number(lot.superficie), du: periode.du, au: periode.au, jours: periode.jours, montant
      });
    }
    return [...parClient].map(([clientId, lignes]) => {
      lignes.sort((a, b) => a.reference - b.reference || a.du.localeCompare(b.du));
      const sousTotal = arrondi(lignes.reduce((s, l) => s + l.montant, 0));
      const tps = reglages.taxes ? arrondi(sousTotal * reglages.tps / 100) : 0;
      const tvq = reglages.taxes ? arrondi(sousTotal * reglages.tvq / 100) : 0;
      return {
        client: clients.find(c => c.id === clientId) || { id: clientId, nom: 'Client inconnu' },
        lignes, sousTotal, tps, tvq, total: arrondi(sousTotal + tps + tvq), joursMois
      };
    }).sort((a, b) => a.client.nom.localeCompare(b.client.nom, 'fr'));
  }

  // Taux d'occupation à partir des lots présents
  function occupation({ entrepots, zones, lots }) {
    const parZone = new Map(zones.map(z => [z.id, { zone: z, occupe: 0, lots: 0 }]));
    for (const lot of lots) {
      const ligne = parZone.get(lot.zone_id);
      if (ligne) { ligne.occupe += Number(lot.superficie); ligne.lots++; }
    }
    const resultat = entrepots.map(entrepot => {
      const sesZones = [...parZone.values()].filter(l => l.zone.entrepot_id === entrepot.id)
        .sort((a, b) => a.zone.nom.localeCompare(b.zone.nom, 'fr', { numeric: true }));
      const superficie = sesZones.reduce((s, l) => s + Number(l.zone.superficie), 0);
      const occupe = sesZones.reduce((s, l) => s + l.occupe, 0);
      return { entrepot, superficie, occupe, taux: superficie ? occupe / superficie : 0, zones: sesZones.map(l => ({ ...l, taux: l.zone.superficie ? l.occupe / l.zone.superficie : 0 })) };
    });
    const superficie = resultat.reduce((s, r) => s + r.superficie, 0);
    const occupe = resultat.reduce((s, r) => s + r.occupe, 0);
    return { entrepots: resultat, superficie, occupe, taux: superficie ? occupe / superficie : 0 };
  }

  return { bornesMois, periodeFacturee, facturation, occupation, arrondi };
})();

if (typeof module !== 'undefined') module.exports = Calculs;
