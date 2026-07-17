# LYFTT CRM — Migration vers 100% Supabase + Vercel

Ce document est ta **checklist de mise en prod**. Suis-le dans l'ordre.
Temps estimé : ~30 min.

---

## Ce qui a changé (résumé)

On a sorti l'app de la plateforme MGX (MetaGPT X) pour qu'elle tourne
sur **ton** stack : Vercel (front) + Supabase (base + auth + storage).

| Brique | Avant (MGX) | Maintenant |
|--------|-------------|------------|
| Base de données | DB MGX | **Supabase Postgres** |
| Connexion utilisateurs | SSO/OIDC MGX | **Supabase Auth** (email + mot de passe) |
| Stockage fichiers | Service OSS MGX | **Supabase Storage** (bucket `prospect-docs`) |
| Accès aux données (front) | SDK `@metagptx/web-sdk` | **Adaptateur `src/lib/api.ts`** → supabase-js |
| Backend Python | AWS Lambda MGX | **Supprimé** (plus nécessaire) |

Le front n'a quasiment pas changé : l'adaptateur garde la même interface
(`client.entities.*`, `client.apiCall.invoke`, `client.auth.*`), le moteur
dessous est maintenant Supabase.

**Fichiers clés créés/modifiés :**
- `supabase/migrations/0001_init.sql` — tout le schéma (à exécuter)
- `frontend/src/lib/supabase.ts` — client Supabase
- `frontend/src/lib/api.ts` — adaptateur (remplace le SDK MGX)
- `frontend/src/pages/Login.tsx` — page de connexion
- `frontend/src/contexts/AuthContext.tsx` — synchro auth Supabase
- `frontend/vercel.json`, `frontend/.env.example` — config déploiement
- Le dossier `backend/` n'est **plus utilisé** (tu peux le garder en archive).

---

## Étape 1 — Base de données Supabase

1. Va sur **supabase.com → ton projet → SQL Editor → New query**.
2. Ouvre `supabase/migrations/0001_init.sql`, copie **tout**, colle, clique **Run**.
3. Tu dois voir « Success ». Le script crée les 5 tables, les sécurités (RLS),
   les triggers et le bucket de stockage. Il est ré-exécutable sans risque.

---

## Étape 2 — Réglages Auth Supabase

Dans **Authentication → Sign In / Providers** :
- Active **Email** (activé par défaut).
- Pour démarrer vite : **désactive « Confirm email »** (Authentication →
  Providers → Email → décoche *Confirm email*). Tu pourras le réactiver plus tard.

Dans **Authentication → URL Configuration** :
- **Site URL** : mets l'URL Vercel de ton front (ex. `https://crm-lyftt.vercel.app`).
  En dev, ajoute aussi `http://localhost:3000` dans **Redirect URLs**.

---

## Étape 3 — Créer ton compte admin

1. Lance le front (localement ou après le déploiement Vercel).
2. Va sur `/login`, onglet **Créer un compte**, inscris-toi avec
   `robin@vgs-autos.fr`.
3. **Le tout premier compte devient automatiquement `admin`.**
   (Vérif si besoin, en SQL :
   `select email, role from public.user_roles;`)
4. Pour ajouter tes commerciaux : depuis l'app, **Gestion utilisateurs →
   créer** (email + rôle). Quand la personne s'inscrit avec cet email, son
   compte est lié automatiquement au rôle que tu as défini.

---

## Étape 4 — Déployer le front sur Vercel

1. **Vercel → Add New → Project → importe le repo GitHub `crm lyftt`.**
2. Réglages du projet :
   - **Root Directory** : `app/frontend`
   - **Framework Preset** : Vite (détecté)
   - **Build Command** : `pnpm build` — **Output** : `dist`
3. **Environment Variables** (Settings → Environment Variables) :
   ```
   VITE_SUPABASE_URL      = https://TON-PROJET.supabase.co
   VITE_SUPABASE_ANON_KEY = (clé anon publique, Supabase → Settings → API)
   ```
4. **Deploy**. À la fin, récupère l'URL et remets-la en **Site URL** Supabase
   (Étape 2) si tu ne l'avais pas encore.

> Dev local : dans `app/frontend`, copie `.env.example` en `.env.local`,
> remplis les 2 variables, puis `pnpm install` et `pnpm dev`.

---

## Étape 5 — Importer tes prospects

Deux options :
- **Depuis l'app** : page Prospects → **Importer Excel** (le parseur Monday
  existant fonctionne déjà, 100% côté navigateur).
- **En masse via SQL** : je peux te générer un script d'insertion à partir de
  tes fichiers `prospects_data.json` / `batch1-3.json` si tu préfères.

---

## Phase 2 — Fonctions serveur (plus tard, si besoin)

Ces fonctionnalités existaient dans l'ancien backend mais **ne sont pas
utilisées par l'app actuelle**. À rebrancher en **Supabase Edge Functions**
seulement quand tu en auras besoin :
- **IA / assistant** (ancien `aihub`) — clé OpenAI côté serveur.
- **Paiement Stripe** (ancien `payment`).
- **Envoi d'invitations email** aux nouveaux commerciaux (via service_role).

Rien de bloquant pour lancer le CRM aujourd'hui.

---

## Ce que je n'ai pas pu faire pour toi (à faire de ton côté)

- **Pousser sur GitHub** et **cliquer Deploy** : ça demande l'accès à tes
  comptes, que je n'ai pas dans cette session. Le code est prêt dans ton
  dossier ; il te reste à commit + push + suivre les étapes ci-dessus.
- **Renseigner tes clés Supabase** dans Vercel (Étape 4).

Dis-moi quand tu as fait tourner le SQL et le premier déploiement : on
enchaîne sur la vraie brique « Aircall » (suivi d'appels dans la fiche
prospect) une fois la base en ligne.
