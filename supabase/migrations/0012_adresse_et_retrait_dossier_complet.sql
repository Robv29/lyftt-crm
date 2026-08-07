-- Ajoute la colonne "adresse" (utilisee pour la transmission Monday) et
-- retire le statut "Dossier complet" du pipeline : les dossiers qui y
-- etaient encore (aucun n'a jamais ete transmis a Monday, verifie avant
-- migration) repassent en "Signature", point d'entree unique de la
-- transmission automatique desormais.

alter table public.prospects add column if not exists adresse text;

update public.prospects
set statut_avancement = 'Signature'
where statut_avancement = 'Dossier complet';
