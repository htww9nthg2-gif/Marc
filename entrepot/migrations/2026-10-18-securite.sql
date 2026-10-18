-- =====================================================================
-- Mise à jour de sécurité du 18 octobre 2026
-- Pour un projet Supabase où supabase.sql a DÉJÀ été exécuté.
-- À coller dans Supabase > SQL Editor > New query, puis « Run ». Peut être relancé sans risque.
-- (Une nouvelle installation n'en a pas besoin : supabase.sql contient déjà ces règles.)
-- =====================================================================

-- 1. Plus aucun administrateur automatique : tout nouveau compte est employé.
create or replace function public.creer_profil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profils (id, courriel, nom, role)
  values (new.id, new.email, split_part(new.email, '@', 1), 'employe');
  return new;
end $$;

-- 2. Lots : auteur imposé à la réception, et seules zone/description/remarque modifiables ensuite.
create or replace function public.proteger_lot() returns trigger
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
drop trigger if exists a_proteger_lot on public.lots;
create trigger a_proteger_lot before insert or update on public.lots
  for each row execute function public.proteger_lot();

-- 3. La sortie passe par une fonction de confiance qui fait ses propres contrôles.
create or replace function public.sortir_lot(p_lot uuid, p_date date, p_morceaux int, p_superficie numeric,
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

-- 4. Fonctions appelables seulement par les comptes connectés.
revoke execute on function public.sortir_lot(uuid, date, int, numeric, text[], text) from public, anon;
revoke execute on function public.emettre_facture(uuid, date, jsonb, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.sortir_lot(uuid, date, int, numeric, text[], text) to authenticated;
grant execute on function public.emettre_facture(uuid, date, jsonb, numeric, numeric, numeric, numeric) to authenticated;

-- 5. Photos : JPEG uniquement, 10 Mo au plus.
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg'] where id = 'photos';

-- 6. Vérification : la liste des administrateurs doit contenir uniquement les personnes prévues.
select courriel, role from public.profils where role = 'admin';
