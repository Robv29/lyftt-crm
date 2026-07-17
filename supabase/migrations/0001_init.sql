-- =====================================================================
-- LYFTT CRM — Schéma Supabase (Chemin A : 100% Supabase)
-- À exécuter dans Supabase > SQL Editor > New query > Run
-- Idempotent : ré-exécutable sans casser l'existant.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Table user_roles  (rôle applicatif lié à auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
    id          bigint generated always as identity primary key,
    user_id     uuid unique references auth.users(id) on delete cascade,
    email       text not null,
    first_name  text,
    last_name   text,
    role        text not null default 'commercial' check (role in ('admin','commercial')),
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);
create index if not exists idx_user_roles_user_id on public.user_roles(user_id);
-- Email unique (insensible à la casse) : permet de pré-créer un utilisateur
-- par email côté admin, puis de le lier à son compte à l'inscription.
create unique index if not exists uq_user_roles_email on public.user_roles(lower(email));

-- ---------------------------------------------------------------------
-- 2. Table prospects
-- ---------------------------------------------------------------------
create table if not exists public.prospects (
    id                     bigint generated always as identity primary key,
    user_id                uuid default auth.uid() references auth.users(id) on delete set null,
    nom_societe            text not null,
    nom_dirigeant          text,
    telephone              text,
    email                  text,
    zone_geographique      text,
    categorie_metier       text,
    commercial_assigne     text,
    statut_avancement      text default 'Appel telephonique',
    date_dernier_appel     timestamptz,
    date_prochaine_relance timestamptz,
    nombre_appels          integer default 0,
    nombre_appels_repondus integer default 0,
    nombre_relances        integer default 0,
    date_visio             timestamptz,
    date_demande_documents timestamptz,
    date_signature         timestamptz,
    date_rdv               timestamptz,
    notes                  text,
    priorite               text,
    source_lead            text,
    montant_potentiel      numeric default 0,
    statut_gagne_perdu     text default 'actif',
    opco_docs              text,
    budget_hors_opco       text,
    derniere_maj           text,        -- champ legacy libre (peut contenir du texte)
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);
create index if not exists idx_prospects_statut   on public.prospects(statut_avancement);
create index if not exists idx_prospects_assigne  on public.prospects(commercial_assigne);
create index if not exists idx_prospects_updated  on public.prospects(updated_at desc);

-- ---------------------------------------------------------------------
-- 3. Table commercial_actions  (historique / journal des actions)
-- ---------------------------------------------------------------------
create table if not exists public.commercial_actions (
    id            bigint generated always as identity primary key,
    user_id       uuid default auth.uid() references auth.users(id) on delete set null,
    prospect_id   bigint references public.prospects(id) on delete cascade,
    action_type   text,
    appel_repondu boolean,
    from_status   text,
    to_status     text,
    notes         text,
    action_date   timestamptz not null default now(),
    created_at    timestamptz not null default now()
);
create index if not exists idx_actions_prospect on public.commercial_actions(prospect_id);
create index if not exists idx_actions_date     on public.commercial_actions(action_date desc);

-- ---------------------------------------------------------------------
-- 4. Table objectives
-- ---------------------------------------------------------------------
create table if not exists public.objectives (
    id                       bigint generated always as identity primary key,
    user_id                  uuid default auth.uid() references auth.users(id) on delete cascade,
    objectif_appels_jour     integer default 30,
    objectif_visios_semaine  integer default 5,
    objectif_signatures_mois integer default 3,
    mois                     text,
    created_at               timestamptz not null default now()
);
create index if not exists idx_objectives_user on public.objectives(user_id);

-- ---------------------------------------------------------------------
-- 5. Table city_attributions
-- ---------------------------------------------------------------------
create table if not exists public.city_attributions (
    id            bigint generated always as identity primary key,
    user_role_id  bigint references public.user_roles(id) on delete cascade,
    city          text not null,
    created_at    timestamptz not null default now()
);
create index if not exists idx_city_attr_role on public.city_attributions(user_role_id);

-- =====================================================================
-- 6. Fonctions & triggers
-- =====================================================================

-- 6a. Maj automatique de updated_at sur prospects
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_prospects_updated on public.prospects;
create trigger trg_prospects_updated
    before update on public.prospects
    for each row execute function public.set_updated_at();

-- 6b. Création automatique d'un user_roles à l'inscription
--     Le tout premier compte créé devient 'admin', les suivants 'commercial'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
    v_role       text;
    v_existing   bigint;
begin
    -- 1) Un utilisateur a-t-il été pré-créé par l'admin avec cet email ?
    select id into v_existing
    from public.user_roles
    where lower(email) = lower(new.email) and user_id is null
    limit 1;

    if v_existing is not null then
        -- On lie le compte auth au rôle déjà défini par l'admin.
        update public.user_roles
        set user_id    = new.id,
            first_name = coalesce(nullif(first_name,''), new.raw_user_meta_data->>'first_name'),
            last_name  = coalesce(nullif(last_name,''),  new.raw_user_meta_data->>'last_name')
        where id = v_existing;
        return new;
    end if;

    -- 2) Sinon : premier compte de l'instance = admin, les suivants = commercial.
    if (select count(*) from public.user_roles) = 0 then
        v_role := 'admin';
    else
        v_role := 'commercial';
    end if;

    insert into public.user_roles (user_id, email, first_name, last_name, role, is_active)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'first_name', ''),
        coalesce(new.raw_user_meta_data->>'last_name', ''),
        v_role,
        true
    )
    on conflict (user_id) do nothing;

    return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 6c. Helper : l'utilisateur courant est-il admin actif ?
create or replace function public.is_admin()
returns boolean
language sql
stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role = 'admin'
          and is_active = true
    );
$$;

-- =====================================================================
-- 7. Row Level Security
--    Modèle : CRM d'équipe interne -> lecture partagée entre membres
--    authentifiés ; écritures sensibles (users, attributions) = admin.
-- =====================================================================

alter table public.user_roles        enable row level security;
alter table public.prospects         enable row level security;
alter table public.commercial_actions enable row level security;
alter table public.objectives        enable row level security;
alter table public.city_attributions enable row level security;

-- ---- user_roles ----
drop policy if exists ur_select on public.user_roles;
create policy ur_select on public.user_roles
    for select to authenticated using (true);

drop policy if exists ur_update_self on public.user_roles;
create policy ur_update_self on public.user_roles
    for update to authenticated
    using (user_id = auth.uid() or public.is_admin())
    with check (user_id = auth.uid() or public.is_admin());

drop policy if exists ur_admin_insert on public.user_roles;
create policy ur_admin_insert on public.user_roles
    for insert to authenticated with check (public.is_admin());

drop policy if exists ur_admin_delete on public.user_roles;
create policy ur_admin_delete on public.user_roles
    for delete to authenticated using (public.is_admin());

-- ---- prospects (équipe : tout membre actif gère) ----
drop policy if exists pr_all on public.prospects;
create policy pr_all on public.prospects
    for all to authenticated using (true) with check (true);

-- ---- commercial_actions ----
drop policy if exists ca_all on public.commercial_actions;
create policy ca_all on public.commercial_actions
    for all to authenticated using (true) with check (true);

-- ---- objectives (chacun les siens, admin voit tout) ----
drop policy if exists ob_select on public.objectives;
create policy ob_select on public.objectives
    for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists ob_write on public.objectives;
create policy ob_write on public.objectives
    for all to authenticated
    using (user_id = auth.uid() or public.is_admin())
    with check (user_id = auth.uid() or public.is_admin());

-- ---- city_attributions (lecture équipe, écriture admin) ----
drop policy if exists cattr_select on public.city_attributions;
create policy cattr_select on public.city_attributions
    for select to authenticated using (true);

drop policy if exists cattr_admin_write on public.city_attributions;
create policy cattr_admin_write on public.city_attributions
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- 8. Storage : bucket pour documents prospects (OPCO, pièces jointes)
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('prospect-docs', 'prospect-docs', false)
on conflict (id) do nothing;

drop policy if exists sb_read on storage.objects;
create policy sb_read on storage.objects
    for select to authenticated using (bucket_id = 'prospect-docs');

drop policy if exists sb_write on storage.objects;
create policy sb_write on storage.objects
    for insert to authenticated with check (bucket_id = 'prospect-docs');

drop policy if exists sb_update on storage.objects;
create policy sb_update on storage.objects
    for update to authenticated using (bucket_id = 'prospect-docs');

drop policy if exists sb_delete on storage.objects;
create policy sb_delete on storage.objects
    for delete to authenticated using (bucket_id = 'prospect-docs');

-- =====================================================================
-- FIN — après exécution :
--   1) Crée ton compte via l'app (il deviendra admin automatiquement)
--      OU en SQL :  update public.user_roles set role='admin' where email='robin@vgs-autos.fr';
--   2) Importe tes prospects (JSON/Excel existants) via l'app.
-- =====================================================================
