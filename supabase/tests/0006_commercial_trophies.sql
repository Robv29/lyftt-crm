begin;

select plan(18);

select has_table('public', 'trophy_definitions', 'La table des définitions existe');
select has_table('public', 'user_trophies', 'La table des déblocages persistants existe');
select has_table('public', 'recordman_history', 'La table d’historique Recordman existe');
select has_column('public', 'user_roles', 'avatar_key', 'Le personnage est stocké sur le profil');

select results_eq(
  $$ select count(*)::bigint from public.trophy_definitions where collection = 'closing' $$,
  array[4::bigint],
  'La collection Closing contient 4 trophées'
);
select results_eq(
  $$ select count(*)::bigint from public.trophy_definitions where collection = 'revenue' $$,
  array[6::bigint],
  'La collection CA contient 6 trophées'
);
select results_eq(
  $$ select count(*)::bigint from public.trophy_definitions where collection = 'regularity' $$,
  array[4::bigint],
  'La collection Régularité contient 4 trophées'
);
select results_eq(
  $$ select threshold::bigint from public.trophy_definitions where code = 'revenue_250' $$,
  array[250000::bigint],
  'Hall of Fame est fixé à 250 k€'
);
select results_eq(
  $$ select array_agg(threshold::int order by threshold) from public.trophy_definitions where collection = 'regularity' $$,
  array[array[3, 6, 9, 12]],
  'Les seuils de régularité respectent l’année civile'
);
select results_eq(
  $$ select count(*)::bigint from public.trophy_definitions where is_dynamic $$,
  array[1::bigint],
  'Recordman est le seul trophée dynamique'
);
select results_eq(
  $$ select code from public.trophy_definitions where is_dynamic $$,
  array['special_recordman'::text],
  'Le trophée dynamique est bien Recordman'
);
select ok(
  (select count(*) <= 1 from public.recordman_history where relinquished_at is null),
  'Il ne peut exister qu’un détenteur Recordman'
);
select has_function('public', 'refresh_commercial_trophies', array[]::text[], 'La fonction de recalcul existe');
select has_function('public', 'get_trophy_profiles', array[]::text[], 'La fonction de lecture des profils existe');
select has_function('public', 'set_my_avatar', array['text'], 'La fonction de sélection du personnage existe');
select has_trigger('public', 'prospects', 'trg_trophies_prospects', 'Les signatures recalculent les trophées');
select has_trigger('public', 'paiements_clients', 'trg_trophies_payments', 'Les encaissements recalculent les trophées');
select has_trigger('public', 'objectifs_ca', 'trg_trophies_objectives', 'Les objectifs recalculent les trophées');

select * from finish();
rollback;
