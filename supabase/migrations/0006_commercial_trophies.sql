-- LYFTT CRM — Profil commercial, trophées persistants et Recordman dynamique
-- Les montants de CA des trophées sont basés sur les règlements encaissés.
-- Le Recordman est basé sur le montant signé cumulé sur un mois civil.

alter table public.user_roles
  add column if not exists avatar_key text not null default 'summit';

create table if not exists public.objectifs_ca (
  id bigint generated always as identity primary key,
  user_role_id bigint not null references public.user_roles(id) on delete cascade,
  mois date not null,
  objectif_ca numeric(12,2) not null default 0 check (objectif_ca >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_role_id, mois)
);

create table if not exists public.paiements_clients (
  id bigint generated always as identity primary key,
  prospect_id bigint not null references public.prospects(id) on delete cascade,
  montant numeric(12,2) not null check (montant > 0),
  date_paiement date not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.user_roles
  add column if not exists taux_commission numeric(5,2) not null default 0;

alter table public.prospects
  add column if not exists signed_by_user_id bigint references public.user_roles(id);

create index if not exists idx_objectifs_ca_user_month
  on public.objectifs_ca(user_role_id, mois);
create index if not exists idx_paiements_clients_prospect_date
  on public.paiements_clients(prospect_id, date_paiement);
create index if not exists idx_prospects_signed_owner_date
  on public.prospects(signed_by_user_id, date_signature);

create table if not exists public.trophy_definitions (
  code text primary key,
  collection text not null check (collection in ('closing', 'revenue', 'regularity', 'special')),
  name text not null,
  description text not null,
  metric text not null,
  threshold numeric not null,
  sort_order integer not null unique,
  rarity text not null check (rarity in ('bronze', 'silver', 'gold', 'epic', 'legendary', 'mythic')),
  is_dynamic boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_trophies (
  id bigint generated always as identity primary key,
  user_role_id bigint not null references public.user_roles(id) on delete cascade,
  trophy_code text not null references public.trophy_definitions(code) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unlock_value numeric,
  unlock_context jsonb not null default '{}'::jsonb,
  unique (user_role_id, trophy_code)
);

create table if not exists public.recordman_history (
  id bigint generated always as identity primary key,
  user_role_id bigint not null references public.user_roles(id) on delete cascade,
  record_amount numeric(12,2) not null,
  record_month date not null,
  acquired_at timestamptz not null default now(),
  relinquished_at timestamptz,
  unique (user_role_id, record_amount, record_month)
);

create unique index if not exists uq_recordman_current_holder
  on public.recordman_history ((relinquished_at is null))
  where relinquished_at is null;

insert into public.trophy_definitions
  (code, collection, name, description, metric, threshold, sort_order, rarity, is_dynamic)
values
  ('closing_1',   'closing',    'Première victoire', 'Signer un premier contrat.',                                      'signed_contracts',       1,      10, 'bronze',    false),
  ('closing_25',  'closing',    'Je prends confiance','Signer 25 contrats.',                                             'signed_contracts',       25,     20, 'silver',    false),
  ('closing_75',  'closing',    'Closer d''élite',   'Signer 75 contrats.',                                              'signed_contracts',       75,     30, 'gold',      false),
  ('closing_150', 'closing',    'Maître du closing', 'Signer 150 contrats.',                                             'signed_contracts',       150,    40, 'mythic',    false),
  ('revenue_25',  'revenue',    '25K Club',          'Atteindre 25 000 € de CA encaissé cumulé.',                        'collected_revenue',      25000,  50, 'bronze',    false),
  ('revenue_50',  'revenue',    '50K Club',          'Atteindre 50 000 € de CA encaissé cumulé.',                        'collected_revenue',      50000,  60, 'silver',    false),
  ('revenue_80',  'revenue',    '80K Club',          'Atteindre 80 000 € de CA encaissé cumulé.',                        'collected_revenue',      80000,  70, 'gold',      false),
  ('revenue_120', 'revenue',    '120K Club',         'Atteindre 120 000 € de CA encaissé cumulé.',                       'collected_revenue',      120000, 80, 'epic',      false),
  ('revenue_160', 'revenue',    '160K Club',         'Atteindre 160 000 € de CA encaissé cumulé.',                       'collected_revenue',      160000, 90, 'legendary', false),
  ('revenue_250', 'revenue',    'Hall of Fame',      'Atteindre 250 000 € de CA encaissé cumulé sur plusieurs années.', 'collected_revenue',      250000, 100,'mythic',    false),
  ('regularity_3','regularity', 'Régulier',          'Atteindre 100 % de son objectif pendant 3 mois d''une année civile.','year_target_months',    3,      110,'bronze',    false),
  ('regularity_6','regularity', 'Inarrêtable',       'Atteindre 100 % de son objectif pendant 6 mois d''une année civile.','year_target_months',    6,      120,'silver',    false),
  ('regularity_9','regularity', 'Excellence',        'Atteindre 100 % de son objectif pendant 9 mois d''une année civile.','year_target_months',    9,      130,'gold',      false),
  ('regularity_12','regularity','Grand Chelem',      'Atteindre 100 % de son objectif pendant les 12 mois d''une année civile.','year_target_months', 12,     140,'mythic',    false),
  ('special_number_one','special','Numéro 1 du mois','Terminer premier du classement mensuel avec au moins 100 % de son objectif.','monthly_wins',      1,      150,'gold',      false),
  ('special_speed_runner','special','Speed Runner',  'Atteindre 100 % de son objectif avant le 15 du mois.',             'speed_run',              1,      160,'epic',      false),
  ('special_overdrive','special','Overdrive',        'Atteindre 150 % de son objectif sur un mois.',                     'overdrive',              1,      170,'legendary', false),
  ('special_recordman','special','Recordman',        'Détenir le record historique du plus gros CA signé sur un mois.',  'monthly_record',         1,      180,'mythic',    true),
  ('special_goat','special',    'GOAT LYFTT',        'Obtenir Grand Chelem, 160K Club et Numéro 1 du mois.',             'goat',                   1,      190,'mythic',    false)
on conflict (code) do update set
  collection = excluded.collection,
  name = excluded.name,
  description = excluded.description,
  metric = excluded.metric,
  threshold = excluded.threshold,
  sort_order = excluded.sort_order,
  rarity = excluded.rarity,
  is_dynamic = excluded.is_dynamic;

create or replace function public.monthly_signed_revenue()
returns table(user_role_id bigint, month date, amount numeric)
language sql stable security definer set search_path = public
as $$
  select p.signed_by_user_id,
         date_trunc('month', p.date_signature)::date,
         coalesce(sum(greatest(coalesce(p.montant_potentiel, 0), 0)), 0)
  from public.prospects p
  where p.signed_by_user_id is not null
    and p.date_signature is not null
    and p.statut_avancement in ('Signature', 'Dossier complet', 'Envoyé à Mathilde')
  group by p.signed_by_user_id, date_trunc('month', p.date_signature)::date;
$$;

create or replace function public.refresh_commercial_trophies()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_record record;
  v_current record;
begin
  -- Trophées Closing.
  insert into public.user_trophies (user_role_id, trophy_code, unlock_value)
  select u.id, d.code, x.signed_count
  from public.user_roles u
  cross join public.trophy_definitions d
  cross join lateral (
    select count(*)::numeric as signed_count
    from public.prospects p
    where p.signed_by_user_id = u.id
      and p.date_signature is not null
      and p.statut_avancement in ('Signature', 'Dossier complet', 'Envoyé à Mathilde')
  ) x
  where d.collection = 'closing' and x.signed_count >= d.threshold
  on conflict (user_role_id, trophy_code) do nothing;

  -- Trophées de CA encaissé cumulé.
  insert into public.user_trophies (user_role_id, trophy_code, unlock_value)
  select u.id, d.code, x.collected
  from public.user_roles u
  cross join public.trophy_definitions d
  cross join lateral (
    -- Même règle que Performance CA : les paiements d'un dossier sont
    -- plafonnés à son montant potentiel avant d'être cumulés.
    select coalesce(sum(capped.amount), 0)::numeric as collected
    from (
      select least(
        coalesce(sum(pc.montant), 0),
        greatest(coalesce(p.montant_potentiel, 0), 0)
      ) as amount
      from public.prospects p
      join public.paiements_clients pc on pc.prospect_id = p.id
      where p.signed_by_user_id = u.id
      group by p.id, p.montant_potentiel
    ) capped
  ) x
  where d.collection = 'revenue' and x.collected >= d.threshold
  on conflict (user_role_id, trophy_code) do nothing;

  -- Régularité : meilleur nombre de mois à 100 % dans une même année civile.
  insert into public.user_trophies (user_role_id, trophy_code, unlock_value, unlock_context)
  select u.id, d.code, x.best_months, jsonb_build_object('year', x.best_year)
  from public.user_roles u
  cross join public.trophy_definitions d
  cross join lateral (
    select count(*)::numeric as best_months, extract(year from o.mois)::int as best_year
    from public.objectifs_ca o
    join public.monthly_signed_revenue() m
      on m.user_role_id = o.user_role_id and m.month = o.mois
    where o.user_role_id = u.id and o.objectif_ca > 0 and m.amount >= o.objectif_ca
    group by extract(year from o.mois)
    order by count(*) desc, extract(year from o.mois) desc
    limit 1
  ) x
  where d.collection = 'regularity' and x.best_months >= d.threshold
  on conflict (user_role_id, trophy_code) do nothing;

  -- Overdrive.
  insert into public.user_trophies (user_role_id, trophy_code, unlock_value, unlock_context)
  select m.user_role_id, 'special_overdrive', max(m.amount / nullif(o.objectif_ca, 0) * 100),
         jsonb_build_object('month', max(m.month))
  from public.monthly_signed_revenue() m
  join public.objectifs_ca o on o.user_role_id = m.user_role_id and o.mois = m.month
  where o.objectif_ca > 0 and m.amount >= o.objectif_ca * 1.5
  group by m.user_role_id
  on conflict (user_role_id, trophy_code) do nothing;

  -- Numéro 1 du mois, avec objectif atteint.
  insert into public.user_trophies (user_role_id, trophy_code, unlock_value, unlock_context)
  select ranked.user_role_id, 'special_number_one', ranked.amount,
         jsonb_build_object('month', ranked.month)
  from (
    select m.*, o.objectif_ca,
           rank() over (partition by m.month order by m.amount desc) as position
    from public.monthly_signed_revenue() m
    join public.objectifs_ca o on o.user_role_id = m.user_role_id and o.mois = m.month
    where o.objectif_ca > 0
  ) ranked
  where ranked.position = 1 and ranked.amount >= ranked.objectif_ca
  on conflict (user_role_id, trophy_code) do nothing;

  -- Speed Runner : objectif atteint avec les signatures datées du 1 au 14 inclus.
  insert into public.user_trophies (user_role_id, trophy_code, unlock_value, unlock_context)
  select o.user_role_id, 'special_speed_runner', sum(p.montant_potentiel),
         jsonb_build_object('month', o.mois)
  from public.objectifs_ca o
  join public.prospects p on p.signed_by_user_id = o.user_role_id
    and date_trunc('month', p.date_signature)::date = o.mois
    and extract(day from p.date_signature) < 15
    and p.statut_avancement in ('Signature', 'Dossier complet', 'Envoyé à Mathilde')
  where o.objectif_ca > 0
  group by o.user_role_id, o.mois, o.objectif_ca
  having sum(p.montant_potentiel) >= o.objectif_ca
  on conflict (user_role_id, trophy_code) do nothing;

  -- GOAT persistant.
  insert into public.user_trophies (user_role_id, trophy_code, unlock_value)
  select a.user_role_id, 'special_goat', 1
  from public.user_trophies a
  join public.user_trophies b on b.user_role_id = a.user_role_id and b.trophy_code = 'revenue_160'
  join public.user_trophies c on c.user_role_id = a.user_role_id and c.trophy_code = 'special_number_one'
  where a.trophy_code = 'regularity_12'
  on conflict (user_role_id, trophy_code) do nothing;

  -- Recordman unique et transférable. Une égalité ne vole pas le trophée.
  select m.user_role_id, m.month, m.amount
    into v_record
  from public.monthly_signed_revenue() m
  order by m.amount desc, m.month asc, m.user_role_id asc
  limit 1;

  select * into v_current
  from public.recordman_history
  where relinquished_at is null
  limit 1;

  if v_record.user_role_id is not null and (
    v_current.id is null
    or v_record.amount > v_current.record_amount
    or (v_record.amount = v_current.record_amount and v_record.user_role_id = v_current.user_role_id)
  ) then
    if v_current.id is null
       or v_current.user_role_id <> v_record.user_role_id
       or v_current.record_amount <> v_record.amount
       or v_current.record_month <> v_record.month then
      update public.recordman_history
      set relinquished_at = now()
      where relinquished_at is null;

      insert into public.recordman_history (user_role_id, record_amount, record_month)
      values (v_record.user_role_id, v_record.amount, v_record.month)
      on conflict (user_role_id, record_amount, record_month)
      do update set acquired_at = now(), relinquished_at = null;
    end if;
  end if;
end;
$$;

create or replace function public.get_trophy_profiles()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with signed as (
    select u.id, count(p.id)::numeric value
    from public.user_roles u left join public.prospects p
      on p.signed_by_user_id = u.id and p.date_signature is not null
      and p.statut_avancement in ('Signature', 'Dossier complet', 'Envoyé à Mathilde')
    group by u.id
  ), collected as (
    select u.id, coalesce(sum(capped.amount), 0)::numeric value
    from public.user_roles u
    left join lateral (
      select least(
        coalesce(sum(pc.montant), 0),
        greatest(coalesce(p.montant_potentiel, 0), 0)
      ) as amount
      from public.prospects p
      join public.paiements_clients pc on pc.prospect_id = p.id
      where p.signed_by_user_id = u.id
      group by p.id, p.montant_potentiel
    ) capped on true
    group by u.id
  ), regularity as (
    select u.id, coalesce(max(x.months), 0)::numeric value
    from public.user_roles u
    left join lateral (
      select count(*) months
      from public.objectifs_ca o join public.monthly_signed_revenue() m
        on m.user_role_id = o.user_role_id and m.month = o.mois
      where o.user_role_id = u.id and o.objectif_ca > 0 and m.amount >= o.objectif_ca
      group by extract(year from o.mois)
    ) x on true
    group by u.id
  ), profiles as (
    select u.id, u.first_name, u.last_name, u.avatar_key,
      jsonb_agg(
        jsonb_build_object(
          'code', d.code, 'collection', d.collection, 'name', d.name,
          'description', d.description, 'rarity', d.rarity,
          'threshold', case
            when d.metric = 'monthly_record' then coalesce(
              (select max(amount) from public.monthly_signed_revenue()),
              d.threshold
            )
            else d.threshold
          end,
          'sortOrder', d.sort_order,
          'dynamic', d.is_dynamic,
          'unlocked', case when d.is_dynamic then rh.user_role_id = u.id else ut.id is not null end,
          'unlockedAt', case when d.is_dynamic then rh.acquired_at else ut.unlocked_at end,
          'progress', case
            when d.metric = 'monthly_record' then coalesce(
              (select max(amount) from public.monthly_signed_revenue() mm where mm.user_role_id = u.id),
              0
            )
            else least(d.threshold,
              case d.metric
                when 'signed_contracts' then s.value
                when 'collected_revenue' then c.value
                when 'year_target_months' then r.value
                else case when ut.id is not null then d.threshold else 0 end
              end
            )
          end,
          'record', case when d.is_dynamic and rh.user_role_id = u.id
            then jsonb_build_object('amount', rh.record_amount, 'month', rh.record_month, 'since', rh.acquired_at)
            else null end
        ) order by d.sort_order
      ) trophies
    from public.user_roles u
    cross join public.trophy_definitions d
    join signed s on s.id = u.id
    join collected c on c.id = u.id
    join regularity r on r.id = u.id
    left join public.user_trophies ut on ut.user_role_id = u.id and ut.trophy_code = d.code
    left join public.recordman_history rh on rh.user_role_id = u.id and rh.relinquished_at is null
    where u.is_active = true
    group by u.id, u.first_name, u.last_name, u.avatar_key
  )
  select jsonb_build_object(
    'profiles', coalesce(jsonb_agg(jsonb_build_object(
      'userRoleId', p.id, 'firstName', p.first_name, 'lastName', p.last_name,
      'avatarKey', p.avatar_key, 'trophies', p.trophies
    ) order by p.first_name, p.last_name), '[]'::jsonb),
    'recordHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userRoleId', rh.user_role_id, 'firstName', u.first_name, 'lastName', u.last_name,
        'amount', rh.record_amount, 'month', rh.record_month,
        'acquiredAt', rh.acquired_at, 'relinquishedAt', rh.relinquished_at
      ) order by rh.acquired_at desc)
      from public.recordman_history rh join public.user_roles u on u.id = rh.user_role_id
    ), '[]'::jsonb)
  ) from profiles p;
$$;

create or replace function public.set_my_avatar(p_avatar_key text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_avatar_key not in ('summit', 'navigator', 'closer', 'vanguard', 'strategist', 'ace') then
    raise exception 'Avatar non autorisé';
  end if;
  update public.user_roles set avatar_key = p_avatar_key where user_id = auth.uid();
end;
$$;

alter table public.trophy_definitions enable row level security;
alter table public.user_trophies enable row level security;
alter table public.recordman_history enable row level security;
alter table public.objectifs_ca enable row level security;
alter table public.paiements_clients enable row level security;

drop policy if exists trophy_definitions_read on public.trophy_definitions;
create policy trophy_definitions_read on public.trophy_definitions for select to authenticated using (true);
drop policy if exists user_trophies_read on public.user_trophies;
create policy user_trophies_read on public.user_trophies for select to authenticated using (true);
drop policy if exists recordman_history_read on public.recordman_history;
create policy recordman_history_read on public.recordman_history for select to authenticated using (true);
drop policy if exists objectifs_ca_read on public.objectifs_ca;
create policy objectifs_ca_read on public.objectifs_ca for select to authenticated using (true);
drop policy if exists objectifs_ca_admin_write on public.objectifs_ca;
create policy objectifs_ca_admin_write on public.objectifs_ca for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists paiements_clients_read on public.paiements_clients;
create policy paiements_clients_read on public.paiements_clients for select to authenticated using (true);
drop policy if exists paiements_clients_admin_write on public.paiements_clients;
create policy paiements_clients_admin_write on public.paiements_clients for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant execute on function public.get_trophy_profiles() to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
revoke execute on function public.refresh_commercial_trophies() from public, anon, authenticated;

-- Recalcul automatique après chaque modification susceptible de changer un trophée.
create or replace function public.trigger_refresh_commercial_trophies()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.refresh_commercial_trophies();
  return null;
end;
$$;

drop trigger if exists trg_trophies_prospects on public.prospects;
create trigger trg_trophies_prospects
after insert or update or delete on public.prospects
for each statement execute function public.trigger_refresh_commercial_trophies();

drop trigger if exists trg_trophies_payments on public.paiements_clients;
create trigger trg_trophies_payments
after insert or update or delete on public.paiements_clients
for each statement execute function public.trigger_refresh_commercial_trophies();

drop trigger if exists trg_trophies_objectives on public.objectifs_ca;
create trigger trg_trophies_objectives
after insert or update or delete on public.objectifs_ca
for each statement execute function public.trigger_refresh_commercial_trophies();

select public.refresh_commercial_trophies();
