-- =====================================================================
-- Gestion des comptes depuis l'application (fonction « comptes »)
-- Ajoute l'état actif/désactivé des comptes ; un administrateur désactivé perd ses droits.
-- À coller dans Supabase > SQL Editor > New query, puis « Run ». Peut être relancé sans risque.
-- =====================================================================
alter table public.profils add column if not exists actif boolean not null default true;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where id = auth.uid() and role = 'admin' and actif);
$$;

-- La fonction serveur « comptes » lit et met à jour les profils avec la clé secrète (rôle service_role).
-- Les projets Supabase récents n'accordent plus ce droit automatiquement.
grant usage on schema public to service_role;
grant select, update on public.profils to service_role;
