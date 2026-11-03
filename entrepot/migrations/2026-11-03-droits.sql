-- =====================================================================
-- Droits d'accès des comptes connectés aux tables
-- Les projets Supabase récents n'accordent plus ces droits automatiquement :
-- sans eux, l'application affiche « permission denied » (accès refusé).
-- Les règles de sécurité (RLS) continuent de décider qui voit et modifie quoi.
-- À coller dans Supabase > SQL Editor > New query, puis « Run ». Peut être relancé sans risque.
-- =====================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.est_admin() to authenticated;
grant execute on function public.sortir_lot(uuid, date, int, numeric, text[], text) to authenticated;
grant execute on function public.emettre_facture(uuid, date, jsonb, numeric, numeric, numeric, numeric) to authenticated;
