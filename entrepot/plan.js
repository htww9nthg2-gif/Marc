'use strict';

// Plans des entrepôts, en pieds, d'après les plans d'aménagement.
// Les zones sont reliées à celles de l'application par leur nom (« Zone 7 », « 7 », « zone 7 »…).
// Les dimensions servent seulement au dessin : la superficie facturée et le taux
// d'occupation viennent toujours des zones saisies dans les réglages.
const PLANS = [
  {
    nom: 'Plan d\'aménagement 4',
    largeur: 98,
    hauteur: 108,
    contour: [[0, 0], [64, 0], [64, 40], [98, 40], [98, 108], [0, 108]],
    portes: [{ de: 72.5, a: 86.5, y: 108, libelle: 'Porte de garage' }],
    zones: [
      { nom: '7', x: 0, y: 0, l: 21.3, h: 55 },
      { nom: '6', x: 21.3, y: 0, l: 21.4, h: 55 },
      { nom: '5', x: 42.7, y: 0, l: 21.3, h: 55 },
      { nom: '4', x: 3.5, y: 78, l: 26, h: 30 },
      { nom: '3', x: 29.5, y: 78, l: 18, h: 17 },
      { nom: '2', x: 47.5, y: 82, l: 20, h: 26 },
      { nom: '1', x: 87, y: 40, l: 11, h: 68 }
    ]
  }
];

const Plan = (() => {
  const cle = nom => String(nom).toLowerCase().replace(/zone/g, '').replace(/\s+/g, '');

  // Le plan qui correspond le mieux aux zones d'un entrepôt (au moins la moitié des noms)
  function pourEntrepot(zonesEntrepot) {
    const noms = new Set(zonesEntrepot.map(z => cle(z.nom)));
    let meilleur = null;
    let score = 0;
    for (const plan of PLANS) {
      const trouvees = plan.zones.filter(z => noms.has(cle(z.nom))).length;
      if (trouvees >= plan.zones.length / 2 && trouvees > score) { meilleur = plan; score = trouvees; }
    }
    return meilleur;
  }

  // Dessin SVG : vert = encore de la place, rouge = pleine (90 % et plus), gris = zone pas encore créée
  function dessiner(plan, lignesZones, { e, nombre }) {
    const parNom = new Map(lignesZones.map(l => [cle(l.zone.nom), l]));
    const marge = 3;
    const contour = plan.contour.map(([x, y]) => `${x},${y}`).join(' ');
    const portes = plan.portes.map(p => `
      <line x1="${p.de}" y1="${p.y}" x2="${p.a}" y2="${p.y}" class="plan-porte"/>
      <text x="${(p.de + p.a) / 2}" y="${p.y + 3.2}" class="plan-legende-porte">${e(p.libelle)}</text>`).join('');
    const zones = plan.zones.map(z => {
      const ligne = parNom.get(cle(z.nom));
      const etroite = z.l < 12;
      const cx = z.x + z.l / 2;
      const cy = z.y + z.h / 2;
      const rotation = etroite ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
      if (!ligne) {
        return `<g class="plan-zone absente"><rect x="${z.x}" y="${z.y}" width="${z.l}" height="${z.h}"/>
          ${etroite
            ? `<text x="${cx}" y="${cy}"${rotation}><tspan class="plan-nom">Zone ${e(z.nom)}</tspan><tspan class="plan-detail" dx="1.5">non créée</tspan></text>`
            : `<text x="${cx}" y="${cy - 1}"><tspan x="${cx}" class="plan-nom">Zone ${e(z.nom)}</tspan><tspan x="${cx}" dy="1.4em" class="plan-detail">non créée</tspan></text>`}</g>`;
      }
      const libre = ligne.zone.superficie - ligne.occupe;
      const etat = ligne.taux >= 0.9 ? 'pleine' : 'libre';
      const detail = libre > 0 ? `${nombre(libre)} pi² libres` : 'pleine';
      // Zone étroite : tout sur une ligne, dans le sens de la longueur
      const texte = etroite
        ? `<text x="${cx}" y="${cy}"${rotation}><tspan class="plan-nom">${e(ligne.zone.nom)}</tspan>
            <tspan class="plan-taux" dx="1.5">${Math.round(ligne.taux * 100)} %</tspan>
            <tspan class="plan-detail" dx="1.5">${detail}</tspan></text>`
        : `<text x="${cx}" y="${cy - 2}">
            <tspan x="${cx}" class="plan-nom">${e(ligne.zone.nom)}</tspan>
            <tspan x="${cx}" dy="1.25em" class="plan-taux">${Math.round(ligne.taux * 100)} %</tspan>
            <tspan x="${cx}" dy="1.35em" class="plan-detail">${detail}</tspan>
          </text>`;
      return `<g class="plan-zone ${etat}" data-action="voir-zone" data-id="${ligne.zone.id}" role="button"
          aria-label="${e(ligne.zone.nom)} : ${Math.round(ligne.taux * 100)} % occupée, ${nombre(Math.max(0, libre))} pieds carrés libres">
        <rect x="${z.x}" y="${z.y}" width="${z.l}" height="${z.h}"/>
        ${texte}</g>`;
    }).join('');
    return `
      <figure class="plan">
        <svg viewBox="${-marge} ${-marge} ${plan.largeur + 2 * marge} ${plan.hauteur + 2 * marge + 3}" role="img" aria-label="${e(plan.nom)}">
          <polygon points="${contour}" class="plan-batiment"/>
          ${zones}
          ${portes}
        </svg>
        <figcaption>
          <span><i class="pastille libre"></i>Place disponible</span>
          <span><i class="pastille pleine"></i>Pleine (90 % et plus)</span>
          <span>Touche une zone pour voir ses lots</span>
        </figcaption>
      </figure>`;
  }

  return { pourEntrepot, dessiner };
})();

if (typeof module !== 'undefined') module.exports = { PLANS, Plan };
