-- Relance automatique quotidienne pour les prospects en "Demande de
-- documents" : tant qu'un prospect reste bloqué à cette étape (pas encore
-- passé en Signature ni en Refus), une relance datée est reprogrammée
-- chaque jour à 7h UTC (~9h Paris) s'il n'y en a pas déjà une en attente
-- ou future. Ça les fait remonter automatiquement dans le Dashboard,
-- colonne "Relance date", jour après jour, sans action manuelle.
--
-- Une relance déjà planifiée (par le commercial, pour plus tard) n'est
-- jamais écrasée. Dès que le statut change (Signature ou Refus), le job
-- ne le touche plus.
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'relance-demande-documents';

select cron.schedule(
  'relance-demande-documents',
  '0 7 * * *',
  $$
    update public.prospects
    set date_relance_planifiee = now()
    where statut_avancement = 'Demande de documents'
      and statut_gagne_perdu = 'actif'
      and (date_relance_planifiee is null or date_relance_planifiee < now());
  $$
);
