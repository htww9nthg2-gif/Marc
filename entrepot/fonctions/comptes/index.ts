// Fonction Supabase « comptes » : l'administrateur gère les comptes depuis l'application.
// Elle s'exécute sur le serveur Supabase, seul endroit où la clé secrète peut vivre :
// cette clé permet de créer des comptes et ne doit JAMAIS se trouver dans l'application.
// Actions : creer, mot-de-passe, desactiver, reactiver. Réservé aux administrateurs actifs.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const ENTETES = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function reponse(corps: unknown, statut = 200) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...ENTETES, 'Content-Type': 'application/json' } });
}

// La clé secrète, selon la façon dont le projet la fournit
function cleSecrete(): string | undefined {
  const directe = Deno.env.get('CLE_SECRETE') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (directe) return directe;
  try {
    const cles = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return cles.default || Object.values(cles)[0] as string | undefined;
  } catch {
    return undefined;
  }
}

Deno.serve(async requete => {
  if (requete.method === 'OPTIONS') return new Response('ok', { headers: ENTETES });
  if (requete.method !== 'POST') return reponse({ erreur: 'Méthode non permise.' }, 405);

  const cle = cleSecrete();
  if (!cle) return reponse({ erreur: 'Clé secrète introuvable : ajoute le secret CLE_SECRETE dans Edge Functions › Secrets.' }, 500);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, cle, { auth: { persistSession: false, autoRefreshToken: false } });

  // Qui appelle ? Le jeton de connexion est vérifié auprès de Supabase, puis le rôle dans profils
  const jeton = (requete.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: lecture, error: erreurJeton } = await admin.auth.getUser(jeton);
  const appelant = lecture?.user;
  if (erreurJeton || !appelant) return reponse({ erreur: 'Connexion requise.' }, 401);
  const { data: profil, error: erreurProfil } = await admin.from('profils').select('role, actif').eq('id', appelant.id).single();
  if (erreurProfil) return reponse({ erreur: `Lecture du profil impossible (${erreurProfil.message}). Exécute migrations/2026-11-05-comptes.sql dans Supabase.` }, 500);
  if (profil?.role !== 'admin' || profil.actif === false) return reponse({ erreur: 'Réservé aux administrateurs.' }, 403);

  try {
    const { action, id, courriel, nom, motDePasse } = await requete.json();
    const verifierMotDePasse = () => {
      if (typeof motDePasse !== 'string' || motDePasse.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.');
    };

    if (action === 'creer') {
      const adresse = String(courriel || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adresse)) throw new Error('Courriel invalide.');
      verifierMotDePasse();
      const { data, error } = await admin.auth.admin.createUser({ email: adresse, password: motDePasse, email_confirm: true });
      if (error) throw new Error(/already|exists/i.test(error.message) ? 'Un compte existe déjà avec ce courriel.' : error.message);
      // Le profil d'employé est créé par le déclencheur de la base ; on y ajoute le nom
      if (nom) await admin.from('profils').update({ nom: String(nom).trim() }).eq('id', data.user.id);
      return reponse({ ok: true, id: data.user.id });
    }

    if (!id) throw new Error('Compte non précisé.');
    if (action === 'mot-de-passe') {
      verifierMotDePasse();
      const { error } = await admin.auth.admin.updateUserById(id, { password: motDePasse });
      if (error) throw error;
      return reponse({ ok: true });
    }
    if (action === 'desactiver' || action === 'reactiver') {
      if (id === appelant.id) throw new Error('Tu ne peux pas désactiver ton propre compte.');
      const actif = action === 'reactiver';
      // Un compte désactivé ne peut plus se connecter ; son historique (réceptions, sorties) est conservé
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: actif ? 'none' : '876000h' });
      if (error) throw error;
      await admin.from('profils').update({ actif }).eq('id', id);
      return reponse({ ok: true });
    }
    throw new Error('Action inconnue.');
  } catch (erreur) {
    return reponse({ erreur: (erreur as Error).message }, 400);
  }
});
