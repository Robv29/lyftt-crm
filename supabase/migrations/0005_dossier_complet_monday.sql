-- Phase 1 de l'automatisation "Dossier complet -> Monday" :
--   Signature -> Dossier complet -> Envoye a Mathilde
-- ajoutes APRES "Signature" dans le pipeline existant (on ne touche pas au
-- sens actuel de "Signature" = deal gagne, utilise partout dans l'app).

alter table public.prospects
    add column if not exists doc_cfp_recu boolean not null default false,
    add column if not exists doc_kbis_recu boolean not null default false,
    add column if not exists doc_cni_recu boolean not null default false,
    add column if not exists signed_by_user_id bigint references public.user_roles(id),
    add column if not exists monday_item_id bigint,
    add column if not exists monday_item_url text,
    add column if not exists monday_sync_status text, -- null | 'pending' | 'synced' | 'error'
    add column if not exists monday_synced_at timestamptz,
    add column if not exists monday_last_sync_at timestamptz,
    add column if not exists monday_sync_error text;

-- Journal de synchronisation (partie 12 du prompt) : une ligne par evenement,
-- affichee chronologiquement sur la fiche prospect.
create table if not exists public.monday_sync_log (
    id bigint generated always as identity primary key,
    prospect_id bigint not null references public.prospects(id) on delete cascade,
    event text not null,
    detail text,
    success boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.monday_sync_log enable row level security;

drop policy if exists "msl_select_all_active" on public.monday_sync_log;
create policy "msl_select_all_active" on public.monday_sync_log
    for select using (
        exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.is_active = true)
    );

-- Ecriture reservee au backend (service_role, via l'Edge Function) + admins
-- pour debug manuel si besoin.
drop policy if exists "msl_insert_admin" on public.monday_sync_log;
create policy "msl_insert_admin" on public.monday_sync_log
    for insert with check (
        exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin' and ur.is_active = true)
    );
