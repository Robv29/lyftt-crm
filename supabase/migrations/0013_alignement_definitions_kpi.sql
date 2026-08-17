-- =====================================================================
-- 0013 — Alignement des definitions entre l'ecran, les mails et les trophees
--
-- Constat de l'audit : trois surfaces calculaient les memes indicateurs
-- differemment ; un commercial voyait 4 chiffres differents sur 4 entre son
-- tableau de bord et son mail hebdomadaire (ex. Yoan juillet : 19 313 EUR
-- annonces par mail contre 3 873 EUR a l'ecran).
--
-- Definition unique desormais partagee par les 3 surfaces :
--   * une VENTE = un dossier avec une date_signature qui n'est pas retombe
--     en "Refus / Perdu". L'etape du pipeline n'intervient plus : un client
--     signe qui attend ses pieces reste une vente.
--   * les APPELS incluent 'appel' ET 'relance', comme le tableau de bord.
--   * les VISIOS sont comptees par prospect DISTINCT : reprogrammer un RDV
--     creait plusieurs lignes pour un seul rendez-vous reel.
--
-- Au passage, le statut 'Dossier complet' reference dans ces 4 fonctions
-- n'existait plus depuis la migration 0012, tandis que 'Demande de documents'
-- (qui porte de vraies ventes signees) n'y figurait pas : 60 % des dossiers
-- signes ne declenchaient donc aucun trophee.
--
-- Fonctions recreees a l'identique de la prod, seuls les filtres changent.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.compute_commercial_period_stats(p_user_role_id bigint, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'appels', (
      select count(*) from public.commercial_actions ca
      join public.user_roles u on u.user_id = ca.user_id
      where u.id = p_user_role_id
        and ca.action_type in ('appel', 'relance')
        and ca.action_date::date between p_start and p_end
    ),
    'visios_programmees', (
      select count(distinct ca.prospect_id) from public.commercial_actions ca
      join public.user_roles u on u.user_id = ca.user_id
      where u.id = p_user_role_id
        and ca.action_type = 'visio'
        and ca.action_date::date between p_start and p_end
    ),
    'signatures', (
      select count(*) from public.prospects p
      where p.signed_by_user_id = p_user_role_id
        and p.date_signature::date between p_start and p_end
        and p.statut_avancement <> 'Refus / Perdu'
    ),
    'ca_signe', (
      select coalesce(sum(greatest(coalesce(p.montant_potentiel, 0), 0)), 0) from public.prospects p
      where p.signed_by_user_id = p_user_role_id
        and p.date_signature::date between p_start and p_end
        and p.statut_avancement <> 'Refus / Perdu'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.monthly_signed_revenue()
 RETURNS TABLE(user_role_id bigint, month date, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.signed_by_user_id,
         date_trunc('month', p.date_signature)::date,
         coalesce(sum(greatest(coalesce(p.montant_potentiel, 0), 0)), 0)
  from public.prospects p
  where p.signed_by_user_id is not null
    and p.date_signature is not null
    and p.statut_avancement <> 'Refus / Perdu'
  group by p.signed_by_user_id, date_trunc('month', p.date_signature)::date;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_commercial_trophies()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and p.statut_avancement <> 'Refus / Perdu'
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
    and p.statut_avancement <> 'Refus / Perdu'
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
$function$;

CREATE OR REPLACE FUNCTION public.get_trophy_profiles()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with signed as (
    select u.id, count(p.id)::numeric value
    from public.user_roles u left join public.prospects p
      on p.signed_by_user_id = u.id and p.date_signature is not null
      and p.statut_avancement <> 'Refus / Perdu'
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
$function$;
