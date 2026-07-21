-- =====================================================================
-- LYFTT CRM — Ajout de colonnes structurées : forme_juridique, nombre_salaries
-- Exécuté directement en base le 21/07/2026 (session avec accès Postgres).
-- Idempotent : ré-exécutable sans casser l'existant.
--
-- Contexte : ces deux infos existaient uniquement en texte libre dans le
-- champ "notes" (import Monday, format "Effectif: X · Forme: Y · ..."),
-- non éditables ni filtrables. On les sort en colonnes dédiées et on
-- backfill les valeurs déjà présentes dans notes pour ne rien perdre.
-- =====================================================================

alter table public.prospects
    add column if not exists forme_juridique text,
    add column if not exists nombre_salaries text;

-- Backfill depuis notes pour les prospects importés via Monday qui n'ont
-- pas encore ces colonnes renseignées.
update public.prospects
set forme_juridique = trim(substring(notes from 'Forme\s*:\s*([^·\n]+)'))
where forme_juridique is null
  and notes ~* 'Forme\s*:';

update public.prospects
set nombre_salaries = trim(substring(notes from 'Effectif\s*:\s*([^·\n]+)'))
where nombre_salaries is null
  and notes ~* 'Effectif\s*:';
