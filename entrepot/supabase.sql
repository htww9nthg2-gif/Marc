-- =====================================================================
-- Entreposage : tables, sécurité et stockage des photos
-- À coller UNE SEULE FOIS dans Supabase > SQL Editor > New query, puis « Run ».
-- =====================================================================

-- ---------- Utilisateurs : profil et rôle ----------
create table public.profils (
  id uuid primary key references auth.users on delete cascade,
  courriel text,
  nom text not null default '',
  role text not null default 'employe' check (role in ('admin', 'employe'))
);

create function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where id = auth.uid() and role = 'admin');
$$;

-- Chaque nouveau compte reçoit un profil d'employé.
-- Aucun compte ne devient administrateur automatiquement : l'administrateur est désigné
-- à la main (voir README), pour qu'une inscription non prévue ne puisse jamais donner tous les droits.
create function public.creer_profil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profils (id, courriel, nom, role)
  values (new.id, new.email, split_part(new.email, '@', 1), 'employe');
  return new;
end $$;

create trigger nouveau_compte after insert on auth.users
  for each row execute function public.creer_profil();

-- ---------- Réglages (une seule ligne, réservée aux administrateurs) ----------
create table public.reglages (
  id int primary key default 1 check (id = 1),
  prix_pi2_mois numeric not null default 0 check (prix_pi2_mois >= 0),
  taxes boolean not null default true,
  tps numeric not null default 5,
  tvq numeric not null default 9.975,
  entreprise jsonb not null default '{}'::jsonb,
  prochain_numero_facture int not null default 1
);
insert into public.reglages default values;

-- ---------- Entrepôts, zones, clients ----------
create table public.entrepots (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  adresse text not null default '',
  cree_le timestamptz not null default now()
);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  entrepot_id uuid not null references public.entrepots on delete restrict,
  nom text not null,
  superficie numeric not null default 0 check (superficie >= 0),
  cree_le timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  contact text not null default '',
  telephone text not null default '',
  courriel text not null default '',
  adresse text not null default '',
  cree_le timestamptz not null default now()
);

-- ---------- Lots ----------
-- Une sortie partielle ferme le lot et crée un « reste » qui garde la même référence.
create table public.lots (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  reference bigint,
  client_id uuid not null references public.clients on delete restrict,
  zone_id uuid not null references public.zones on delete restrict,
  description text not null default '',
  morceaux int not null check (morceaux > 0),
  superficie numeric not null check (superficie > 0),
  date_entree date not null default current_date,
  date_sortie date check (date_sortie is null or date_sortie >= date_entree),
  morceaux_sortis int,
  superficie_liberee numeric,
  photos_entree text[] not null default '{}',
  photos_sortie text[] not null default '{}',
  note text not null default '',
  note_sortie text not null default '',
  lot_precedent uuid references public.lots,
  recu_par uuid references auth.users default auth.uid(),
  sorti_par uuid references auth.users,
  cree_le timestamptz not null default now()
);
create index lots_en_stock on public.lots (zone_id) where date_sortie is null;
create index lots_periode on public.lots (date_entree, date_sortie);

create function public.reference_lot() returns trigger language plpgsql as $$
begin
  new.reference := coalesce(new.reference, new.numero);
  return new;
end $$;
create trigger reference_lot before insert on public.lots
  for each row execute function public.reference_lot();

-- Protection des lots contre les écritures directes depuis l'application.
-- « current_user = 'authenticated' » : la requête vient d'un compte connecté, en direct.
-- Les fonctions sortir_lot (security definer) passent outre, car elles font leurs propres contrôles.
--   - à la réception : l'auteur est toujours le compte connecté, et un lot neuf ne peut pas
--     être déclaré déjà sorti ni rattaché à l'historique d'un autre lot ;
--   - ensuite : seuls la zone, la description et la remarque se modifient ; superficie, dates,
--     client, morceaux et traçabilité (base de la facturation) ne changent que par sortir_lot.
create function public.proteger_lot() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.recu_par := auth.uid();
    new.reference := null;
    new.lot_precedent := null;
    new.date_sortie := null;
    new.morceaux_sortis := null;
    new.superficie_liberee := null;
    new.photos_sortie := '{}';
    new.note_sortie := '';
    new.sorti_par := null;
    new.cree_le := now();
    return new;
  end if;
  if (to_jsonb(new) - array['zone_id', 'description', 'note'])
     is distinct from (to_jsonb(old) - array['zone_id', 'description', 'note']) then
    raise exception 'Seules la zone, la description et la remarque d''un lot peuvent être modifiées.';
  end if;
  return new;
end $$;
-- « a_ » : passe avant reference_lot (les déclencheurs s'exécutent par ordre alphabétique)
create trigger a_proteger_lot before insert or update on public.lots
  for each row execute function public.proteger_lot();

-- Sortie complète ou partielle, en une seule opération
create function public.sortir_lot(p_lot uuid, p_date date, p_morceaux int, p_superficie numeric,
                                  p_photos text[] default '{}', p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.lots;
  reste uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into l from public.lots where id = p_lot and date_sortie is null for update;
  if not found then raise exception 'Lot introuvable ou déjà sorti'; end if;
  if p_date < l.date_entree then raise exception 'La date de sortie précède la date d''entrée'; end if;
  if p_morceaux is null or p_morceaux <= 0 or p_morceaux > l.morceaux then raise exception 'Nombre de morceaux invalide'; end if;
  if p_morceaux = l.morceaux then p_superficie := l.superficie; end if;
  if p_superficie is null or p_superficie <= 0 or p_superficie > l.superficie then raise exception 'Superficie libérée invalide'; end if;
  if p_morceaux < l.morceaux and p_superficie >= l.superficie then
    raise exception 'Les morceaux restants doivent encore occuper une superficie';
  end if;

  update public.lots
     set date_sortie = p_date, morceaux_sortis = p_morceaux, superficie_liberee = p_superficie,
         photos_sortie = coalesce(p_photos, '{}'), note_sortie = coalesce(p_note, ''), sorti_par = auth.uid()
   where id = p_lot;

  if p_morceaux < l.morceaux then
    insert into public.lots (reference, client_id, zone_id, description, morceaux, superficie, date_entree,
                             photos_entree, note, lot_precedent, recu_par)
    values (l.reference, l.client_id, l.zone_id, l.description, l.morceaux - p_morceaux, l.superficie - p_superficie,
            p_date + 1, l.photos_entree, l.note, l.id, l.recu_par)
    returning id into reste;
  end if;
  return reste;
end $$;

-- ---------- Factures émises (copie figée de la facture) ----------
create table public.factures (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  client_id uuid not null references public.clients on delete restrict,
  mois date not null,
  lignes jsonb not null,
  sous_total numeric not null,
  tps numeric not null default 0,
  tvq numeric not null default 0,
  total numeric not null,
  emise_le timestamptz not null default now(),
  emise_par uuid references auth.users default auth.uid(),
  unique (client_id, mois)
);

create function public.emettre_facture(p_client uuid, p_mois date, p_lignes jsonb,
                                       p_sous_total numeric, p_tps numeric, p_tvq numeric, p_total numeric)
returns public.factures language plpgsql set search_path = public as $$
declare
  n int;
  f public.factures;
begin
  if not public.est_admin() then raise exception 'Réservé aux administrateurs'; end if;
  update public.reglages set prochain_numero_facture = prochain_numero_facture + 1
   where id = 1 returning prochain_numero_facture - 1 into n;
  insert into public.factures (numero, client_id, mois, lignes, sous_total, tps, tvq, total)
  values (to_char(p_mois, 'YYYY') || '-' || lpad(n::text, 4, '0'), p_client, date_trunc('month', p_mois)::date,
          p_lignes, p_sous_total, p_tps, p_tvq, p_total)
  returning * into f;
  return f;
end $$;

-- =====================================================================
-- Sécurité : seuls les comptes connectés voient les données ;
-- prix, factures, zones et rôles sont réservés aux administrateurs.
-- =====================================================================
alter table public.profils enable row level security;
alter table public.reglages enable row level security;
alter table public.entrepots enable row level security;
alter table public.zones enable row level security;
alter table public.clients enable row level security;
alter table public.lots enable row level security;
alter table public.factures enable row level security;

create policy lecture on public.profils for select to authenticated using (true);
create policy gestion on public.profils for update to authenticated using (public.est_admin()) with check (public.est_admin());

create policy admin on public.reglages for all to authenticated using (public.est_admin()) with check (public.est_admin());

create policy lecture on public.entrepots for select to authenticated using (true);
create policy gestion on public.entrepots for all to authenticated using (public.est_admin()) with check (public.est_admin());

create policy lecture on public.zones for select to authenticated using (true);
create policy gestion on public.zones for all to authenticated using (public.est_admin()) with check (public.est_admin());

-- Les employés peuvent créer un client à la réception ; modifier ou supprimer reste à l'administrateur
create policy lecture on public.clients for select to authenticated using (true);
create policy ajout on public.clients for insert to authenticated with check (true);
create policy modification on public.clients for update to authenticated using (public.est_admin()) with check (public.est_admin());
create policy suppression on public.clients for delete to authenticated using (public.est_admin());

create policy lecture on public.lots for select to authenticated using (true);
create policy ajout on public.lots for insert to authenticated with check (true);
create policy modification on public.lots for update to authenticated using (true) with check (true);
create policy suppression on public.lots for delete to authenticated using (public.est_admin());

create policy admin on public.factures for all to authenticated using (public.est_admin()) with check (public.est_admin());

-- ---------- Photos (espace privé, accessible aux comptes connectés) ----------
-- Photos JPEG uniquement (l'application les compresse), 10 Mo au plus
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg']);
create policy "photos lecture" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos ajout" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "photos suppression" on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.est_admin());

-- ---------- Fonctions : appelables seulement par les comptes connectés ----------
revoke execute on function public.sortir_lot(uuid, date, int, numeric, text[], text) from public, anon;
revoke execute on function public.emettre_facture(uuid, date, jsonb, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.sortir_lot(uuid, date, int, numeric, text[], text) to authenticated;
grant execute on function public.emettre_facture(uuid, date, jsonb, numeric, numeric, numeric, numeric) to authenticated;
