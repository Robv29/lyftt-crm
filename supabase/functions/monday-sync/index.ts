// Edge Function Supabase : transmission automatique d'un dossier "complet"
// vers le board Monday "TRANSMISSION CLIENTS" (id 1834077174, workspace
// LYFTT). Appelée par le front (supabase.functions.invoke('monday-sync',
// { body: { prospect_id } })) quand un commercial marque un dossier comme
// complet, ou pour un "Réessayer" après une erreur.
//
// Principes (voir prompt "PERFORMANCE CA + TRANSMISSION MONDAY", parties 3-13) :
//  - Clé API Monday jamais exposée au frontend : elle vit uniquement ici,
//    en secret Supabase (MONDAY_API_TOKEN).
//  - Anti-doublon : si prospects.monday_item_id existe déjà, on met à jour
//    l'item existant au lieu d'en créer un nouveau (une seule ligne, quel
//    que soit le nombre de clics / retries / refresh).
//  - Le statut CRM ne passe à "Envoyé à Mathilde" QUE si la création/mise à
//    jour Monday ET la note de synthèse ont réussi. En cas d'échec à
//    n'importe quelle étape, le prospect reste en "Dossier complet" avec
//    monday_sync_status = 'error' et le détail de l'erreur est conservé.
//  - "DATE ENVOIE MATHILDE" et "CA HT PROBABLE" (si inconnu) restent vides
//    à la création — jamais de valeur inventée.
//
// Mapping de colonnes basé sur l'inspection réelle du board (get_board_info),
// PAS sur des suppositions : voir MONDAY_COLUMN_MAPPING ci-dessous.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MONDAY_BOARD_ID = 1834077174; // "TRANSMISSION CLIENTS"
const MONDAY_GROUP_ID = 'group_mkvt7t5y'; // "FORMATION LYFTT 2026"
const MONDAY_API_URL = 'https://api.monday.com/v2';

// --- Mapping centralisé CRM -> Monday (colonnes réelles du board) --------
const MONDAY_COLUMN_MAPPING = {
  entreprise: 'text_mkp4sxvj',      // "Entreprise"
  contact: 'text_mkp4ehsx',         // "Contact"
  telephone: 'phone_mkp4hx6c',      // "Téléphone"
  email: 'email_mkp4hk2e',          // "E-mail"
  statut: 'project_status',         // "Statut"
  caProbable: 'numeric_mkrearx1',   // "CA HT PROBABLE"
  dateEnvoiMathilde: 'date_mkqnqse3', // "DATE ENVOIE MATHILDE" — jamais rempli à la création
} as const;

// Valeur de statut Monday donnée à la création (choix confirmé : le dossier
// vient d'arriver côté prod, Mathilde doit encore le traiter).
const MONDAY_INITIAL_STATUS_LABEL = 'À ENVOYER MATHILDE';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface MondayGraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function mondayRequest<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as MondayGraphQLResponse<T>;
  if (!res.ok || json.errors?.length) {
    const msg = json.errors?.map((e) => e.message).join(' | ') || `HTTP ${res.status}`;
    throw new Error(`Monday API: ${msg}`);
  }
  if (!json.data) throw new Error('Monday API: réponse vide');
  return json.data;
}

// Formate la structure de colonnes attendue par l'API Monday selon le type
// réel de chaque colonne (les types "plain string" ne s'appliquent pas à
// tous les champs, contrairement à un mapping naïf).
function buildColumnValues(p: Record<string, unknown>, includeCaProbable: boolean) {
  const values: Record<string, unknown> = {
    [MONDAY_COLUMN_MAPPING.entreprise]: String(p.nom_societe ?? ''),
    [MONDAY_COLUMN_MAPPING.contact]: String(p.nom_dirigeant ?? ''),
    [MONDAY_COLUMN_MAPPING.statut]: { label: MONDAY_INITIAL_STATUS_LABEL },
  };
  if (p.telephone) {
    values[MONDAY_COLUMN_MAPPING.telephone] = { phone: String(p.telephone).replace(/\D/g, ''), countryShortName: 'FR' };
  }
  if (p.email) {
    values[MONDAY_COLUMN_MAPPING.email] = { email: String(p.email), text: String(p.email) };
  }
  // "CA HT PROBABLE" et "DATE ENVOIE MATHILDE" restent volontairement absents
  // tant qu'ils ne sont pas réellement connus (parties 7 et 16 du cahier des
  // charges) — on ne les inclut que si une vraie valeur existe déjà.
  if (includeCaProbable && typeof p.montant_potentiel === 'number' && p.montant_potentiel > 0) {
    values[MONDAY_COLUMN_MAPPING.caProbable] = String(p.montant_potentiel);
  }
  return values;
}

// Note de synthèse publiée dans les "Updates" Monday (partie 8) — donne au
// pôle administratif/production tout le contexte sans qu'il ait à rouvrir
// le CRM.
function buildSyntheseNote(p: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push('<b>NOUVEAU CLIENT — TRANSMISSION CRM</b>');
  lines.push('');
  lines.push(`<b>Entreprise :</b> ${p.nom_societe ?? '-'}`);
  lines.push(`<b>Contact :</b> ${p.nom_dirigeant ?? '-'}`);
  lines.push(`<b>Téléphone :</b> ${p.telephone ?? '-'}`);
  lines.push(`<b>Email :</b> ${p.email ?? '-'}`);
  lines.push(`<b>Zone :</b> ${p.zone_geographique ?? '-'}`);
  lines.push(`<b>Catégorie :</b> ${p.categorie_metier ?? '-'}`);
  lines.push(`<b>Statut juridique :</b> ${p.forme_juridique || '-'}`);
  lines.push(`<b>Nombre de salariés :</b> ${p.nombre_salaries || '-'}`);
  lines.push('');
  lines.push('<b>DOCUMENTS REÇUS</b>');
  lines.push(`${p.doc_cfp_recu ? '✓' : '✗'} CFP`);
  lines.push(`${p.doc_kbis_recu ? '✓' : '✗'} KBIS`);
  lines.push(`${p.doc_cni_recu ? '✓' : '✗'} CNI`);
  if (p.notes) {
    lines.push('');
    lines.push('<b>NOTES COMMERCIALES</b>');
    lines.push(String(p.notes));
  }
  return lines.join('<br/>');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // .trim() + nettoyage des caractères non imprimables : évite un crash
    // "not a valid ByteString" si le secret a été collé avec un espace, un
    // retour à la ligne ou un caractère invisible en trop.
    const mondayTokenRaw = Deno.env.get('MONDAY_API_TOKEN');
    const mondayToken = mondayTokenRaw?.replace(/[^\x20-\x7E]/g, '').trim();
    if (!mondayToken) {
      return jsonResponse({ success: false, message: "Clé API Monday non configurée côté serveur (secret MONDAY_API_TOKEN manquant)." }, 500);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { prospect_id } = await req.json();
    if (!prospect_id) return jsonResponse({ success: false, message: 'prospect_id manquant' }, 400);

    const { data: prospect, error: fetchError } = await supabase
      .from('prospects')
      .select('*')
      .eq('id', prospect_id)
      .single();
    if (fetchError || !prospect) {
      return jsonResponse({ success: false, message: 'Prospect introuvable' }, 404);
    }

    if (!['Dossier complet', 'Envoyé à Mathilde'].includes(prospect.statut_avancement)) {
      return jsonResponse({ success: false, message: `Le dossier n'est pas au statut "Dossier complet" (statut actuel : "${prospect.statut_avancement}").` }, 400);
    }

    const log = async (event: string, detail: string | null, success: boolean) => {
      await supabase.from('monday_sync_log').insert({ prospect_id, event, detail, success });
    };

    await supabase.from('prospects').update({ monday_sync_status: 'pending' }).eq('id', prospect_id);
    await log('Transmission Monday lancée', null, true);

    try {
      let itemId: number = prospect.monday_item_id;
      let columnsSynced = 0;

      if (itemId) {
        // Anti-doublon : l'item existe déjà -> mise à jour, jamais de recréation.
        const columnValues = buildColumnValues(prospect, true);
        columnsSynced = Object.keys(columnValues).length;
        await mondayRequest(mondayToken, `
          mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
            change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id }
          }
        `, { boardId: MONDAY_BOARD_ID, itemId, columnValues: JSON.stringify(columnValues) });
        await log('Élément Monday mis à jour', `${columnsSynced} colonne(s)`, true);
      } else {
        // Première transmission : création de l'item.
        const columnValues = buildColumnValues(prospect, false); // CA probable jamais mis à la 1ère création
        columnsSynced = Object.keys(columnValues).length;
        const created = await mondayRequest<{ create_item: { id: string } }>(mondayToken, `
          mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
            create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id }
          }
        `, { boardId: MONDAY_BOARD_ID, groupId: MONDAY_GROUP_ID, itemName: prospect.nom_societe, columnValues: JSON.stringify(columnValues) });
        itemId = Number(created.create_item.id);
        await log('Élément Monday créé', `${columnsSynced} colonne(s) synchronisées`, true);
      }

      // Note de synthèse (Updates Monday).
      const note = buildSyntheseNote(prospect);
      await mondayRequest(mondayToken, `
        mutation ($itemId: ID!, $body: String!) {
          create_update(item_id: $itemId, body: $body) { id }
        }
      `, { itemId, body: note });
      await log('Note de synthèse transférée', null, true);

      const itemUrl = `https://lyftt.monday.com/boards/${MONDAY_BOARD_ID}/pulses/${itemId}`;
      const nowIso = new Date().toISOString();
      await supabase.from('prospects').update({
        monday_item_id: itemId,
        monday_item_url: itemUrl,
        monday_sync_status: 'synced',
        monday_synced_at: nowIso,
        monday_last_sync_at: nowIso,
        monday_sync_error: null,
        statut_avancement: 'Envoyé à Mathilde',
      }).eq('id', prospect_id);

      await supabase.from('commercial_actions').insert({
        prospect_id, action_type: 'status_change', appel_repondu: false,
        from_status: 'Dossier complet', to_status: 'Envoyé à Mathilde',
        notes: 'Transmission Monday réussie', action_date: nowIso,
      });
      await log('Statut : Envoyé à Mathilde', null, true);

      return jsonResponse({ success: true, monday_item_id: itemId, monday_item_url: itemUrl });
    } catch (syncErr) {
      const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
      await supabase.from('prospects').update({
        monday_sync_status: 'error',
        monday_sync_error: message,
        monday_last_sync_at: new Date().toISOString(),
      }).eq('id', prospect_id);
      await log('Transmission Monday échouée', message, false);
      return jsonResponse({ success: false, message });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ success: false, message }, 500);
  }
});
