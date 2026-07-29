# LYFTT CRM — briefing pour agents IA (Codex, Claude, etc.)

CRM interne de suivi commercial pour l'agence LYFTT, utilisé quotidiennement par Robin (dirigeant) et son équipe commerciale (Yoan, Clément, Théo). Toute modification impacte du monde réel : prospects, appels, visios, commissions payées. **Zéro donnée inventée, zéro régression silencieuse.**

## Stack & structure

- Front : React 18 + Vite + TypeScript + shadcn/ui + Tailwind CSS + React Query + React Router v6.
- Backend : Supabase (Postgres + Auth). Pas de backend applicatif séparé — le front interroge Supabase directement via `src/lib/api.ts` (client généré, style `client.entities.<table>.create/update/delete/list`).
- Déploiement : Vercel, Root Directory = `frontend`, déploiement auto sur push vers `main`.
- Racine du repo :
  - `frontend/` — tout le code applicatif (voir ci-dessous).
  - `supabase/` — migrations SQL et Edge Functions (ex. `supabase/functions/monday-sync`).
  - `MIGRATION_SUPABASE.md` — historique des migrations DB.

Dans `frontend/src/` :
- `pages/` — une page par route (`Dashboard.tsx`, `Prospects.tsx`, `ProspectDetail.tsx`, `PerformanceCA.tsx`, `VisiosPassees.tsx` (route `/visios-passees`, affichée "Mes visios"), `Pipeline.tsx`, `Attributions.tsx`, `AdminUsers.tsx`).
- `components/` — composants partagés (`Layout.tsx` = sidebar/nav, `SpeedRun.tsx` = mode appel en rafale, `Celebration.tsx` = confettis/animations).
- `hooks/use-prospects.ts` — TOUS les hooks React Query (`useProspects`, `useRegisteredUsers`, `usePaiements`, etc.) + l'interface `Prospect` (source de vérité du schéma côté front).
- `contexts/AuthContext.tsx` — auth Supabase, `isAdmin`, `userRole`.
- `lib/api.ts` — client Supabase.

## Setup local

```bash
cd frontend
npm install
cp .env.example .env.local   # renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (Supabase > Project Settings > API) — demander les valeurs à Robin, ne jamais les committer
npm run dev
```

## Avant de considérer une modification terminée

```bash
cd frontend
npx tsc --noEmit -p tsconfig.app.json
npx vite build
```

Une seule erreur `tsc` préexistante et **non liée** doit rester : `Dashboard.tsx` ligne ~178, `Conversion of type 'Prospect' to type 'Record<string, unknown>'`. Ne pas essayer de la corriger sauf demande explicite — elle est connue et ignorée depuis le début du projet.

Si `vite build` échoue avec une erreur `EPERM` sur le dossier `dist/`, c'est un souci de filesystem local (dossier synchronisé), pas une erreur de code — relancer avec `--outDir /tmp/xxx --emptyOutDir` pour confirmer que le build compile bien.

## Règles métier critiques (ne jamais réinventer, toujours relire le code existant)

**Pipeline commercial** (`statut_avancement`) : `Appel telephonique` → `Relance 1..4` → `Visio` → `Demande de documents` → `Signature` → `Dossier complet` → `Envoyé à Mathilde`, ou `Refus / Perdu` à tout moment. Une fois `Signature` atteint, le commercial est figé sur le dossier (`signed_by_user_id`) — ne jamais le réattribuer après coup.

**CA (page Performance CA, jamais fusionner ces 3 notions)** :
- *CA probable* = part non payée d'un dossier en `Signature` ou `Dossier complet`.
- *CA confirmé* = part non payée d'un dossier `Envoyé à Mathilde`.
- *CA encaissé* = somme des règlements réellement reçus (table `paiements_clients`), plafonnée au `montant_potentiel` du dossier.
- Un dossier est rattaché au **mois de sa signature** (`date_signature`), pas au mois où on le consulte.
- La **commission** est rattachée au **mois du règlement encaissé** (`date_paiement`), indépendamment du mois de signature.

**Dédoublonnage prospects** : clé = société + téléphone normalisés (voir `dedupKey()` dans `Prospects.tsx`). Un doublon "certain" = nom ET téléphone identiques (suppression auto possible) ; un doublon "probable" = correspondance partielle (jamais supprimé automatiquement, seulement signalé — deux entreprises différentes peuvent partager un nom ou un numéro générique).

**Relances datées** (`date_relance_planifiee` + `type_relance_planifiee`) : `null` = relance standard, `'confirmation_visio'` = rappel auto J-1 avant une visio (violet), `'lapin'` = prospect non venu à sa visio (ambre). Toujours dérivé d'une vraie action commerciale, jamais une valeur par défaut arbitraire.

**Journal d'activité** (`commercial_actions`) : chaque action commerciale (appel, relance, visio, changement de statut) crée une ligne. C'est un **log d'audit**, pas une source de comptage direct pour les KPI — un KPI qui compte des lignes brutes de cette table peut se faire fausser par des reprogrammations (bug corrigé récemment sur le KPI "Visios" du Dashboard : il fallait compter des `prospect_id` distincts, pas des lignes).

**Sécurité RLS (connu, non résolu)** : les policies Supabase sur `prospects` (`pr_select`/`pr_update`) sont actuellement ouvertes à tout utilisateur authentifié (`USING (true)`), donc un commercial peut techniquement lire les dossiers d'un collègue via l'API/devtools même si l'UI filtre côté client. Plusieurs écrans (`Prospects.tsx`, `Dashboard.tsx`) dépendent aujourd'hui de ce comportement ouvert (ils filtrent tout côté client). Ne pas restreindre les policies sans auditer ces écrans en amont et sans validation explicite de Robin — risque de casser des pages existantes.

## Conventions de code observées

- Commentaires en français, orientés "pourquoi" (la règle métier derrière le code), pas juste "quoi".
- Pas de données de démo/fictives en production — toujours reconnecter les vraies données Supabase.
- Mises à jour optimistes systématiques via `queryClient.setQueryData` avant l'appel réseau, avec rollback (`invalidateProspects()`) en cas d'erreur.
- Tailwind : uniquement les classes utilitaires du thème de base (pas de config Tailwind custom étendue) ; couleurs de marque `#5A9BA3` / `#6AABB4`, coins arrondis (`rounded-xl`/`rounded-2xl`), cards `shadow-sm`.
- Toasts (`sonner`) pour tout retour utilisateur après une action.
- `usePersistentState` (hook maison, `hooks/use-persistent-state.ts`) pour tout état d'UI qui doit survivre à un rechargement (filtres, onglet actif, thème) — stocké en `localStorage`, clé préfixée `lyftt.<page>.<champ>`.

## Ne jamais casser sans le signaler explicitement

- Le menu latéral / layout global (`Layout.tsx`) sauf demande explicite.
- Les routes existantes.
- L'onglet "Suivi paiements clients" de Performance CA (logique 100% réelle, ne pas la remplacer par des données fictives même si une maquette de référence en propose).
- Les 4 KPI fixes de Performance CA : CA probable, CA encaissé, Objectif, Commission payée (le CA confirmé reste visible ailleurs — graphique, récapitulatif — mais jamais comme 5ᵉ carte KPI).

## Workflow de livraison

1. Modifier le code dans `frontend/src/`.
2. `npx tsc --noEmit -p tsconfig.app.json` + `npx vite build` — zéro nouvelle erreur.
3. Commit clair (français ou anglais, cohérent avec l'historique), push sur `main`.
4. Vercel redéploie automatiquement. Vérifier en prod : `https://lyftt-crm.vercel.app/`.
