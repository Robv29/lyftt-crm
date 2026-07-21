-- =====================================================================
-- LYFTT CRM — Correctifs de sécurité critiques (audit technique 21/07/2026)
-- À exécuter dans Supabase > SQL Editor > New query > Run.
-- Idempotent : ré-exécutable sans casser l'existant.
--
-- Corrige :
--   BUG-002 (critique) : un commercial pouvait modifier sa propre ligne
--                         user_roles, y compris son propre "role" ->
--                         auto-promotion admin possible.
--   BUG-003 (majeur)   : n'importe quel utilisateur authentifié pouvait
--                         supprimer n'importe quel prospect / action,
--                         avec suppression en cascade de tout l'historique.
--   BUG-001 (critique) : un compte auto-inscrit (self-signup, email non
--                         pré-créé par un admin) était activé (is_active
--                         = true) et obtenait immédiatement un accès
--                         complet à tous les prospects.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) BUG-002 — un utilisateur non-admin ne peut plus modifier sa propre
--    ligne user_roles (donc ne peut plus changer son propre role/is_active).
--    Seul un admin peut modifier une ligne user_roles.
-- ---------------------------------------------------------------------
drop policy if exists ur_update_self on public.user_roles;
create policy ur_update_admin_only on public.user_roles
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 2) BUG-003 — DELETE réservé aux admins sur prospects et
--    commercial_actions (SELECT/INSERT/UPDATE restent partagés équipe,
--    comportement inchangé pour ne rien casser dans l'usage quotidien).
-- ---------------------------------------------------------------------
drop policy if exists pr_all on public.prospects;
drop policy if exists pr_select on public.prospects;
drop policy if exists pr_insert on public.prospects;
drop policy if exists pr_update on public.prospects;
drop policy if exists pr_delete on public.prospects;

create policy pr_select on public.prospects
    for select to authenticated using (true);
create policy pr_insert on public.prospects
    for insert to authenticated with check (true);
create policy pr_update on public.prospects
    for update to authenticated using (true) with check (true);
create policy pr_delete on public.prospects
    for delete to authenticated using (public.is_admin());

drop policy if exists ca_all on public.commercial_actions;
drop policy if exists ca_select on public.commercial_actions;
drop policy if exists ca_insert on public.commercial_actions;
drop policy if exists ca_update on public.commercial_actions;
drop policy if exists ca_delete on public.commercial_actions;

create policy ca_select on public.commercial_actions
    for select to authenticated using (true);
create policy ca_insert on public.commercial_actions
    for insert to authenticated with check (true);
create policy ca_update on public.commercial_actions
    for update to authenticated using (true) with check (true);
create policy ca_delete on public.commercial_actions
    for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 3) BUG-001 — un compte auto-inscrit (email non pré-créé par un admin)
--    est désormais créé INACTIF. Il reste bloqué sur l'écran "Accès non
--    autorisé" (déjà existant côté app) jusqu'à activation manuelle par
--    un admin (AdminUsers > passer is_active à true, fonctionnalité à
--    ajouter côté UI si besoin — en attendant, activable en SQL :
--    update public.user_roles set is_active = true where email = '...';
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
    v_existing bigint;
begin
    -- 1) Compte pré-créé par un admin (via "Nouveau compte") ? -> on lie
    --    et on active : l'admin a déjà validé cette personne en amont.
    select id into v_existing
    from public.user_roles
    where lower(email) = lower(new.email) and user_id is null
    limit 1;

    if v_existing is not null then
        update public.user_roles
        set user_id    = new.id,
            first_name = coalesce(nullif(first_name,''), new.raw_user_meta_data->>'first_name'),
            last_name  = coalesce(nullif(last_name,''),  new.raw_user_meta_data->>'last_name'),
            is_active  = true
        where id = v_existing;
        return new;
    end if;

    -- 2) Auto-inscription libre (email jamais invité) :
    --    - le tout premier compte de l'instance = admin, actif (bootstrap
    --      indispensable pour pouvoir créer le premier admin) ;
    --    - tous les suivants = commercial, INACTIF tant qu'un admin ne
    --      les active pas explicitement.
    if (select count(*) from public.user_roles) = 0 then
        insert into public.user_roles (user_id, email, first_name, last_name, role, is_active)
        values (
            new.id, new.email,
            coalesce(new.raw_user_meta_data->>'first_name', ''),
            coalesce(new.raw_user_meta_data->>'last_name', ''),
            'admin', true
        )
        on conflict (user_id) do nothing;
    else
        insert into public.user_roles (user_id, email, first_name, last_name, role, is_active)
        values (
            new.id, new.email,
            coalesce(new.raw_user_meta_data->>'first_name', ''),
            coalesce(new.raw_user_meta_data->>'last_name', ''),
            'commercial', false
        )
        on conflict (user_id) do nothing;
    end if;

    return new;
end;
$$;

-- =====================================================================
-- FIN — après exécution, teste :
--   1) Un compte commercial existant ne doit plus pouvoir se supprimer/
--      modifier lui-même son role via l'API (RLS doit renvoyer 42501).
--   2) Un compte commercial ne doit plus pouvoir supprimer un prospect
--      (RLS doit renvoyer 42501) — seul un admin le peut.
--   3) Une nouvelle inscription libre (email jamais invité) doit atterrir
--      sur l'écran "Accès non autorisé" tant qu'un admin n'a pas fait :
--      update public.user_roles set is_active = true where email = '...';
-- =====================================================================
