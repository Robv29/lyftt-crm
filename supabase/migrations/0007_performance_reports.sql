-- Rapports de performance automatiques (hebdo + mensuel), envoyes par mail
-- depuis robin.vergnes@lyftt.fr a chaque commercial actif. Topo chiffres de
-- la periode + message de coaching genere selon des regles simples
-- (encouragement / felicitations / warning / recadrage).
--
-- Envoi reel via l'API Resend (https://resend.com) appelee en HTTP depuis
-- Postgres (extension pg_net). La cle API est stockee dans Supabase Vault
-- (secret nomme 'resend_api_key') — jamais en clair dans une migration.
-- Tant que ce secret n'est pas fourni, la fonction logue une erreur
-- explicite au lieu d'echouer silencieusement, et le cron ne casse rien.

create extension if not exists pg_net;

-- 1) Journal des envois -------------------------------------------------
create table if not exists public.performance_reports_log (
  id bigint generated always as identity primary key,
  user_role_id bigint references public.user_roles(id) on delete cascade,
  period_type text not null check (period_type in ('week', 'month')),
  period_start date not null,
  period_end date not null,
  email_to text,
  status text not null check (status in ('success', 'error', 'skipped')),
  error_detail text,
  stats jsonb,
  coaching_message text,
  sent_at timestamptz not null default now()
);

alter table public.performance_reports_log enable row level security;

drop policy if exists "admins peuvent lire les rapports" on public.performance_reports_log;
create policy "admins peuvent lire les rapports"
  on public.performance_reports_log for select
  using (public.is_admin());

-- 2) Stats d'un commercial sur une periode -------------------------------
create or replace function public.compute_commercial_period_stats(
  p_user_role_id bigint,
  p_start date,
  p_end date
) returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'appels', (
      select count(*) from public.commercial_actions ca
      join public.user_roles u on u.user_id = ca.user_id
      where u.id = p_user_role_id
        and ca.action_type = 'appel'
        and ca.action_date::date between p_start and p_end
    ),
    'visios_programmees', (
      select count(*) from public.commercial_actions ca
      join public.user_roles u on u.user_id = ca.user_id
      where u.id = p_user_role_id
        and ca.action_type = 'visio'
        and ca.action_date::date between p_start and p_end
    ),
    'signatures', (
      select count(*) from public.prospects p
      where p.signed_by_user_id = p_user_role_id
        and p.date_signature::date between p_start and p_end
        and p.statut_avancement in ('Signature', 'Dossier complet', 'Envoyé à Mathilde')
    ),
    'ca_signe', (
      select coalesce(sum(greatest(coalesce(p.montant_potentiel, 0), 0)), 0) from public.prospects p
      where p.signed_by_user_id = p_user_role_id
        and p.date_signature::date between p_start and p_end
        and p.statut_avancement in ('Signature', 'Dossier complet', 'Envoyé à Mathilde')
    )
  );
$$;

-- 3) Message de coaching selon des regles simples ------------------------
create or replace function public.build_coaching_message(
  p_period_type text,
  p_stats jsonb,
  p_objectif_ca numeric default null,
  p_ca_mois_a_date numeric default null
) returns text
language plpgsql
stable
as $$
declare
  v_appels int := coalesce((p_stats->>'appels')::int, 0);
  v_visios int := coalesce((p_stats->>'visios_programmees')::int, 0);
  v_signatures int := coalesce((p_stats->>'signatures')::int, 0);
  v_ca numeric := coalesce((p_stats->>'ca_signe')::numeric, 0);
  v_pct numeric;
  v_msg text;
begin
  if p_period_type = 'week' then
    if v_appels = 0 then
      v_msg := '⚠️ Aucun appel enregistré cette semaine. On reprend le rythme dès lundi, l''activité commerciale ne doit jamais tomber à zéro.';
    elsif v_signatures = 0 and v_visios = 0 then
      v_msg := format('%s appel(s) cette semaine mais aucune visio programmée. Consigne : muscle la prise de rendez-vous, chaque appel utile doit déboucher sur une visio.', v_appels);
    elsif v_signatures = 0 then
      v_msg := format('%s appel(s) et %s visio(s) cette semaine, mais 0 signature. Retravaille le closing en visio, la conversion doit suivre le volume.', v_appels, v_visios);
    elsif v_signatures = 1 then
      v_msg := format('Bonne semaine : 1 signature pour %s € de CA. Continue sur cette lancée.', to_char(v_ca, 'FM999G999G999'));
    else
      v_msg := format('Félicitations, %s signatures cette semaine pour %s € de CA. Excellent rythme, on garde ce niveau.', v_signatures, to_char(v_ca, 'FM999G999G999'));
    end if;
  else
    if p_objectif_ca is null or p_objectif_ca = 0 then
      v_msg := format('Aucun objectif de CA défini pour ce mois. %s € signés à date — pense à fixer un objectif pour piloter le mois suivant.', to_char(coalesce(p_ca_mois_a_date, v_ca), 'FM999G999G999'));
    else
      v_pct := round(coalesce(p_ca_mois_a_date, v_ca) / p_objectif_ca * 100);
      if v_pct >= 100 then
        v_msg := format('🏆 Objectif du mois atteint (%s%% de %s €). Félicitations, mois réussi.', v_pct, to_char(p_objectif_ca, 'FM999G999G999'));
      elsif v_pct >= 70 then
        v_msg := format('Objectif presque atteint (%s%%). Encore un effort sur les derniers jours pour passer la barre.', v_pct);
      elsif v_pct >= 40 then
        v_msg := format('Objectif à %s%% seulement à la clôture du mois. Il faut accélérer le rythme le mois prochain.', v_pct);
      else
        v_msg := format('⚠️ Recadrage : %s%% de l''objectif du mois seulement (%s € sur %s €). Priorité absolue sur l''activité commerciale.', v_pct, to_char(coalesce(p_ca_mois_a_date, v_ca), 'FM999G999G999'), to_char(p_objectif_ca, 'FM999G999G999'));
      end if;
    end if;
  end if;
  return v_msg;
end;
$$;

-- 4) Envoi effectif des rapports d'une periode ---------------------------
-- p_period = 'week'  -> rapporte la semaine ISO precedente (lundi-dimanche)
-- p_period = 'month' -> rapporte le mois calendaire precedent
create or replace function public.send_performance_reports(p_period text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_start date;
  v_end date;
  v_api_key text;
  v_from text := 'Robin Vergnes <robin.vergnes@lyftt.fr>';
  v_user record;
  v_stats jsonb;
  v_objectif numeric;
  v_coaching text;
  v_subject text;
  v_html text;
  v_period_label text;
  v_request_id bigint;
  v_sent int := 0;
  v_errors int := 0;
begin
  if p_period not in ('week', 'month') then
    raise exception 'p_period doit valoir week ou month';
  end if;

  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  if p_period = 'week' then
    v_start := date_trunc('week', now())::date - 7;
    v_end := v_start + 6;
    v_period_label := 'Semaine du ' || to_char(v_start, 'DD/MM') || ' au ' || to_char(v_end, 'DD/MM');
  else
    v_start := date_trunc('month', now())::date - interval '1 month';
    v_end := (date_trunc('month', now())::date - interval '1 day')::date;
    v_period_label := 'Mois de ' || to_char(v_start, 'TMMonth YYYY');
  end if;

  select decrypted_secret into v_api_key
  from vault.decrypted_secrets where name = 'resend_api_key'
  limit 1;

  for v_user in
    select id, first_name, last_name, email from public.user_roles
    where role = 'commercial' and is_active = true
  loop
    v_stats := public.compute_commercial_period_stats(v_user.id, v_start, v_end);

    if p_period = 'month' then
      select objectif_ca into v_objectif from public.objectifs_ca
      where user_role_id = v_user.id and mois = v_start
      limit 1;
      v_coaching := public.build_coaching_message('month', v_stats, v_objectif, (v_stats->>'ca_signe')::numeric);
    else
      v_coaching := public.build_coaching_message('week', v_stats);
    end if;

    v_subject := case when p_period = 'week'
      then 'Ton topo de la semaine — ' || v_period_label
      else 'Ton bilan du mois — ' || v_period_label
    end;

    v_html := format(
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">'
      || '<h2 style="color:#0f172a">%s</h2>'
      || '<p>Salut %s,</p>'
      || '<table style="width:100%%;border-collapse:collapse;margin:16px 0">'
      || '<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">Appels</td><td style="text-align:right;font-weight:bold;border-bottom:1px solid #e5e7eb">%s</td></tr>'
      || '<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">Visios programmées</td><td style="text-align:right;font-weight:bold;border-bottom:1px solid #e5e7eb">%s</td></tr>'
      || '<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">Signatures</td><td style="text-align:right;font-weight:bold;border-bottom:1px solid #e5e7eb">%s</td></tr>'
      || '<tr><td style="padding:6px 0">CA signé</td><td style="text-align:right;font-weight:bold">%s €</td></tr>'
      || '</table>'
      || '<p style="background:#f8fafc;border-left:4px solid #5A9BA3;padding:12px 16px;border-radius:6px">%s</p>'
      || '<p style="margin-top:24px;color:#64748b;font-size:13px">— Robin</p>'
      || '</div>',
      v_period_label, coalesce(v_user.first_name, ''),
      coalesce(v_stats->>'appels', '0'), coalesce(v_stats->>'visios_programmees', '0'),
      coalesce(v_stats->>'signatures', '0'), to_char(coalesce((v_stats->>'ca_signe')::numeric, 0), 'FM999G999G999'),
      v_coaching
    );

    if v_api_key is null then
      insert into public.performance_reports_log
        (user_role_id, period_type, period_start, period_end, email_to, status, error_detail, stats, coaching_message)
      values
        (v_user.id, p_period, v_start, v_end, v_user.email, 'error', 'Cle Resend absente (secret resend_api_key non configure dans Vault)', v_stats, v_coaching);
      v_errors := v_errors + 1;
      continue;
    end if;

    begin
      select net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object('from', v_from, 'to', array[v_user.email], 'subject', v_subject, 'html', v_html)
      ) into v_request_id;

      insert into public.performance_reports_log
        (user_role_id, period_type, period_start, period_end, email_to, status, stats, coaching_message)
      values
        (v_user.id, p_period, v_start, v_end, v_user.email, 'success', v_stats, v_coaching);
      v_sent := v_sent + 1;
    exception when others then
      insert into public.performance_reports_log
        (user_role_id, period_type, period_start, period_end, email_to, status, error_detail, stats, coaching_message)
      values
        (v_user.id, p_period, v_start, v_end, v_user.email, 'error', sqlerrm, v_stats, v_coaching);
      v_errors := v_errors + 1;
    end;
  end loop;

  return jsonb_build_object('period', p_period, 'start', v_start, 'end', v_end, 'sent', v_sent, 'errors', v_errors);
end;
$$;

-- 5) Planification automatique -------------------------------------------
-- Hebdo : chaque lundi 7h10 UTC (~9h10 Paris), juste apres le job de
-- relance documents (7h00) pour ne pas les faire competir.
select cron.unschedule(jobid) from cron.job where jobname = 'weekly-performance-report';
select cron.schedule(
  'weekly-performance-report',
  '10 7 * * 1',
  $$ select public.send_performance_reports('week'); $$
);

-- Mensuel : le 1er de chaque mois a 8h00 UTC.
select cron.unschedule(jobid) from cron.job where jobname = 'monthly-performance-report';
select cron.schedule(
  'monthly-performance-report',
  '0 8 1 * *',
  $$ select public.send_performance_reports('month'); $$
);
