-- =====================================================================
-- Journal des mouvements : chaque réception, sortie et modification d'un lot
-- est inscrite par la base elle-même, avec la personne, la date et l'heure.
-- Le journal ne peut être ni modifié ni effacé depuis l'application.
-- À coller dans Supabase > SQL Editor > New query, puis « Run » (une seule fois).
-- =====================================================================

create table if not exists public.journal (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  action text not null check (action in ('reception', 'sortie', 'sortie_partielle', 'modification')),
  utilisateur uuid,
  utilisateur_courriel text not null default '',
  utilisateur_nom text not null default '',
  lot_id uuid,
  reference bigint,
  client_nom text not null default '',
  zone_nom text not null default '',
  morceaux int,
  superficie numeric,
  details jsonb not null default '{}'::jsonb
);
create index if not exists journal_le on public.journal (le desc);
create index if not exists journal_reference on public.journal (reference);

-- Noms du client et de la zone copiés au moment du mouvement : le journal reste lisible
-- même si un client ou une zone est renommé plus tard
create or replace function public.journaliser_lot() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.profils;
  client text;
  zone text;
  ancienne_zone text;
begin
  select * into p from public.profils where id = auth.uid();
  select nom into client from public.clients where id = new.client_id;
  select nom into zone from public.zones where id = new.zone_id;

  if tg_op = 'INSERT' then
    -- Le reste d'une sortie partielle n'est pas une réception : la sortie est déjà inscrite
    if new.lot_precedent is not null then return new; end if;
    insert into public.journal (action, utilisateur, utilisateur_courriel, utilisateur_nom, lot_id, reference,
                                client_nom, zone_nom, morceaux, superficie, details)
    values ('reception', auth.uid(), coalesce(p.courriel, ''), coalesce(p.nom, ''), new.id, new.reference,
            coalesce(client, ''), coalesce(zone, ''), new.morceaux, new.superficie,
            jsonb_build_object('date_entree', new.date_entree, 'description', new.description, 'note', new.note,
                               'photos', cardinality(new.photos_entree)));
    return new;
  end if;

  if old.date_sortie is null and new.date_sortie is not null then
    insert into public.journal (action, utilisateur, utilisateur_courriel, utilisateur_nom, lot_id, reference,
                                client_nom, zone_nom, morceaux, superficie, details)
    values (case when new.morceaux_sortis < new.morceaux then 'sortie_partielle' else 'sortie' end,
            auth.uid(), coalesce(p.courriel, ''), coalesce(p.nom, ''), new.id, new.reference,
            coalesce(client, ''), coalesce(zone, ''), new.morceaux_sortis, new.superficie_liberee,
            jsonb_build_object('date_sortie', new.date_sortie, 'description', new.description, 'note', new.note_sortie,
                               'morceaux_restants', new.morceaux - new.morceaux_sortis,
                               'superficie_restante', new.superficie - new.superficie_liberee,
                               'photos', cardinality(new.photos_sortie)));
    return new;
  end if;

  if (old.zone_id, old.description, old.note) is distinct from (new.zone_id, new.description, new.note) then
    select nom into ancienne_zone from public.zones where id = old.zone_id;
    insert into public.journal (action, utilisateur, utilisateur_courriel, utilisateur_nom, lot_id, reference,
                                client_nom, zone_nom, morceaux, superficie, details)
    values ('modification', auth.uid(), coalesce(p.courriel, ''), coalesce(p.nom, ''), new.id, new.reference,
            coalesce(client, ''), coalesce(zone, ''), new.morceaux, new.superficie,
            jsonb_strip_nulls(jsonb_build_object(
              'zone', case when old.zone_id is distinct from new.zone_id then jsonb_build_object('avant', ancienne_zone, 'apres', zone) end,
              'description', case when old.description is distinct from new.description then jsonb_build_object('avant', old.description, 'apres', new.description) end,
              'note', case when old.note is distinct from new.note then jsonb_build_object('avant', old.note, 'apres', new.note) end)));
  end if;
  return new;
end $$;

drop trigger if exists z_journal_lot on public.lots;
-- « z_ » : passe après les autres déclencheurs, une fois le lot complet (référence comprise)
create trigger z_journal_lot after insert or update on public.lots
  for each row execute function public.journaliser_lot();

-- Lecture pour les comptes connectés ; aucune écriture possible depuis l'application
alter table public.journal enable row level security;
drop policy if exists lecture on public.journal;
create policy lecture on public.journal for select to authenticated using (true);
revoke insert, update, delete, truncate on public.journal from authenticated, anon, public;
grant select on public.journal to authenticated;

-- Reprise des mouvements déjà enregistrés (une seule fois, si le journal est vide).
-- L'heure exacte des anciennes sorties n'était pas conservée : elles sont datées du jour déclaré.
do $$
begin
  if exists (select 1 from public.journal) then return; end if;
  insert into public.journal (le, action, utilisateur, utilisateur_courriel, utilisateur_nom, lot_id, reference,
                              client_nom, zone_nom, morceaux, superficie, details)
  select l.cree_le, 'reception', l.recu_par, coalesce(p.courriel, ''), coalesce(p.nom, ''), l.id, l.reference,
         coalesce(c.nom, ''), coalesce(z.nom, ''), l.morceaux, l.superficie,
         jsonb_build_object('date_entree', l.date_entree, 'description', l.description, 'note', l.note, 'repris', true)
    from public.lots l
    left join public.profils p on p.id = l.recu_par
    left join public.clients c on c.id = l.client_id
    left join public.zones z on z.id = l.zone_id
   where l.lot_precedent is null;
  insert into public.journal (le, action, utilisateur, utilisateur_courriel, utilisateur_nom, lot_id, reference,
                              client_nom, zone_nom, morceaux, superficie, details)
  select l.date_sortie::timestamptz, case when l.morceaux_sortis < l.morceaux then 'sortie_partielle' else 'sortie' end,
         l.sorti_par, coalesce(p.courriel, ''), coalesce(p.nom, ''), l.id, l.reference,
         coalesce(c.nom, ''), coalesce(z.nom, ''), l.morceaux_sortis, l.superficie_liberee,
         jsonb_build_object('date_sortie', l.date_sortie, 'description', l.description, 'note', l.note_sortie,
                            'morceaux_restants', l.morceaux - l.morceaux_sortis, 'repris', true, 'heure_inconnue', true)
    from public.lots l
    left join public.profils p on p.id = l.sorti_par
    left join public.clients c on c.id = l.client_id
    left join public.zones z on z.id = l.zone_id
   where l.date_sortie is not null;
end $$;
