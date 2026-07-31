-- Ajoute Robin et Theo en copie de chaque mail de rapport hebdo/mensuel
-- envoye a un commercial (sans les mettre en copie de leur propre mail),
-- et ajoute une mention claire "mail automatique" dans le corps.

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
  v_from text := 'Robin Vergnes <robin@vgs-autos.fr>';
  v_cc_pool text[] := array['robin@vgs-autos.fr', 'theo.simbert@lyftt.fr'];
  v_cc text[];
  v_user record;
  v_stats jsonb;
  v_objectif numeric;
  v_coaching text;
  v_subject text;
  v_html text;
  v_period_label text;
  v_request_id bigint;
  v_queued int := 0;
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

    -- Robin et Theo en copie, sauf sur leur propre rapport (pas de doublon).
    select array_agg(addr) into v_cc
    from unnest(v_cc_pool) addr
    where lower(addr) <> lower(v_user.email);

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
      || '<p style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;color:#94a3b8;font-size:11px">'
      || 'Ceci est un message automatique généré par le CRM Lyftt, merci de ne pas y répondre directement.'
      || '</p>'
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
        body := jsonb_build_object(
          'from', v_from,
          'to', array[v_user.email],
          'cc', coalesce(v_cc, array[]::text[]),
          'subject', v_subject,
          'html', v_html
        )
      ) into v_request_id;

      insert into public.performance_reports_log
        (user_role_id, period_type, period_start, period_end, email_to, status, stats, coaching_message, request_id)
      values
        (v_user.id, p_period, v_start, v_end, v_user.email, 'pending', v_stats, v_coaching, v_request_id);
      v_queued := v_queued + 1;
    exception when others then
      insert into public.performance_reports_log
        (user_role_id, period_type, period_start, period_end, email_to, status, error_detail, stats, coaching_message)
      values
        (v_user.id, p_period, v_start, v_end, v_user.email, 'error', sqlerrm, v_stats, v_coaching);
      v_errors := v_errors + 1;
    end;
  end loop;

  perform public.reconcile_performance_reports();

  return jsonb_build_object('period', p_period, 'start', v_start, 'end', v_end, 'queued', v_queued, 'errors', v_errors);
end;
$$;
