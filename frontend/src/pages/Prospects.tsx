import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { usePersistentState } from '../hooks/use-persistent-state';
import { client } from '../lib/api';
import { Link, useNavigate } from 'react-router-dom';
import {
  useProspects,
  useRegisteredUsers,
  useCityAttributions,
  useInvalidateProspects,
  type Prospect,
} from '../hooks/use-prospects';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Search, Upload, Plus, Phone, ExternalLink, Filter, Trash2, X,
  MapPin, Building2, UserCircle, Download, ChevronLeft, ChevronRight, Copy,
} from 'lucide-react';
import ErrorState from '../components/ErrorState';
import type * as XLSXType from 'xlsx';

const STATUTS = [
  'Tous', 'Appel telephonique', 'Relance 1', 'Relance 2', 'Relance 3',
  'Relance 4', 'Visio', 'Demande de documents', 'Signature', 'Refus / Perdu',
];

const statusBadgeColors: Record<string, string> = {
  'Appel telephonique': 'bg-slate-100 text-slate-700 border-slate-200',
  'Relance 1': 'bg-blue-50 text-blue-700 border-blue-200',
  'Relance 2': 'bg-blue-100 text-blue-800 border-blue-200',
  'Relance 3': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Relance 4': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Visio: 'bg-purple-50 text-purple-700 border-purple-200',
  'Demande de documents': 'bg-amber-50 text-amber-700 border-amber-200',
  Signature: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Refus / Perdu': 'bg-red-50 text-red-700 border-red-200',
};

const resultColors: Record<string, string> = {
  actif: 'bg-blue-50 text-blue-700 border-blue-200',
  gagne: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  perdu: 'bg-red-50 text-red-700 border-red-200',
};

const SKIP_VALUES = new Set([
  'name', 'subitems', 'sous-éléments', 'sous-elements', 'direction',
  'priority', 'dernière mise à jour', 'derniere mise a jour',
  'commercial', 'dirigeant', 'tel', 'prospection',
]);

interface ParsedProspect {
  nom_societe: string;
  nom_dirigeant: string;
  telephone: string;
  email: string;
  commercial_assigne: string;
  zone_geographique: string;
  categorie_metier: string;
  effectif: string;
  forme: string;
  statut_monday: string;
}

// Import Monday robuste : mappe les colonnes des sous-éléments PAR LEUR NOM
// (Name, Dirigeant, TEL, Mail, COMMERCIAL, NB salariés, Format juridique, Statut),
// donc insensible à l'ordre / aux colonnes ajoutées sur le tableau.
function parseMondayExcel(XLSX: typeof XLSXType, workbook: XLSXType.WorkBook): ParsedProspect[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const zoneCell = sheet['A2'];
  const zone = zoneCell ? String(zoneCell.v ?? '').trim() : '';
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const findCol = (headers: string[], ...pats: string[]) =>
    headers.findIndex((h) => pats.some((p) => h.includes(p)));

  const prospects: ParsedProspect[] = [];
  let currentCategory = '';
  let colMap: Record<string, number> | null = null;

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const c0 = String(row[0] ?? '').trim();
    const c0l = c0.toLowerCase();

    // En-tête des sous-éléments -> construit le mapping colonne -> champ.
    if (c0l === 'subitems' || c0l === 'sous-éléments' || c0l === 'sous-elements') {
      const headers = row.map((c) => String(c ?? '').toLowerCase().trim());
      colMap = {
        name: findCol(headers, 'name', 'nom', 'société', 'societe'),
        dirigeant: findCol(headers, 'dirigeant', 'gérant', 'gerant', 'responsable'),
        tel: findCol(headers, 'tel', 'téléphone', 'telephone', 'phone', 'portable', 'mobile'),
        mail: findCol(headers, 'mail', 'email', 'courriel'),
        commercial: findCol(headers, 'commercial'),
        effectif: findCol(headers, 'salari', 'effectif'),
        forme: findCol(headers, 'juridique', 'forme'),
        statut: findCol(headers, 'statut'),
      };
      if (colMap.name === -1) colMap.name = 1;
      continue;
    }
    // En-tête principale -> ignorer.
    if (c0l === 'name') continue;
    // Ligne catégorie (colonne A remplie) -> mémorise la catégorie métier.
    if (c0) { currentCategory = c0; continue; }
    // Ligne de données (colonne A vide) -> mappée par nom de colonne.
    if (colMap) {
      const cm = colMap;
      const g = (k: string) => (cm[k] >= 0 ? String(row[cm[k]] ?? '').trim() : '');
      const nom = g('name');
      if (!nom) continue;
      prospects.push({
        nom_societe: nom,
        nom_dirigeant: g('dirigeant'),
        telephone: g('tel'),
        email: g('mail'),
        commercial_assigne: g('commercial'),
        zone_geographique: zone,
        categorie_metier: currentCategory,
        effectif: g('effectif'),
        forme: g('forme'),
        statut_monday: g('statut'),
      });
    }
  }
  return prospects;
}

// Lit la 2e feuille de l'export Monday (les "updates") et associe le contenu de
// la colonne "update content" à chaque société (par nom), pour l'injecter en note.
// Détection automatique des colonnes ; tolère plusieurs updates par société.
function parseUpdates(XLSX: typeof XLSXType, workbook: XLSXType.WorkBook): Map<string, string> {
  const map = new Map<string, string>();
  if (workbook.SheetNames.length < 2) return map;
  const sheet = workbook.Sheets[workbook.SheetNames[1]];
  if (!sheet) return map;
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  let headerIdx = -1, contentIdx = -1, nameIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const lowered = r.map((c) => String(c ?? '').toLowerCase().trim());
    const ci = lowered.findIndex((c) => c.includes('update content') || c === 'content' || c.includes('contenu'));
    if (ci !== -1) {
      headerIdx = i;
      contentIdx = ci;
      nameIdx = lowered.findIndex(
        (c) => c === 'name' || c.includes('item') || c.includes('élément') || c.includes('element') || c === 'nom' || c.includes('société') || c.includes('societe')
      );
      break;
    }
  }
  if (headerIdx === -1 || contentIdx === -1) return map;
  if (nameIdx === -1) nameIdx = 0;

  let lastKey = '';
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rawName = String(r[nameIdx] ?? '').trim();
    const content = String(r[contentIdx] ?? '').trim();
    const key = rawName ? rawName.toLowerCase() : lastKey;
    if (rawName) lastKey = rawName.toLowerCase();
    if (!key || !content) continue;
    const prev = map.get(key);
    map.set(key, prev ? `${prev}\n${content}` : content);
  }
  return map;
}


// Correspondance des statuts Monday -> statuts CRM.
//  - "RDV calé"          -> Visio
//  - "à rappeler"        -> Relance 1 (puis 2/3/4 au fil des relances NRP)
//  - "Entreprise fermée" -> sorti du pipeline actif (Refus / Perdu)
function mapMondayStatut(s: string): { statut_avancement: string; statut_gagne_perdu: string } {
  const v = (s || '').toLowerCase();
  if (v.includes('rdv')) return { statut_avancement: 'Visio', statut_gagne_perdu: 'actif' };
  if (v.includes('rappeler')) return { statut_avancement: 'Relance 1', statut_gagne_perdu: 'actif' };
  if (v.includes('ferm')) return { statut_avancement: 'Refus / Perdu', statut_gagne_perdu: 'perdu' };
  return { statut_avancement: 'Appel telephonique', statut_gagne_perdu: 'actif' };
}

// Clé de dédoublonnage : société + téléphone normalisés (insensible à la casse,
// aux espaces et au format du numéro). Utilisée pour éviter les doublons créés
// par ré-import Excel ou double clic sur "Ajouter".
function dedupKey(nom: string, tel: string) {
  const n = (nom || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const t = (tel || '').replace(/\D/g, '');
  return `${n}|${t}`;
}

interface DuplicateGroup {
  certain: boolean; // true = société ET téléphone identiques ; false = correspondance partielle (probable)
  items: Prospect[];
}

// Détecte les doublons existants dans la base (import répété, saisie manuelle
// en double...). Deux prospects sont liés s'ils partagent le même nom
// normalisé OU le même téléphone (non vide, >= 6 chiffres pour éviter les
// faux positifs sur des numéros incomplets) ; les prospects reliés forment un
// groupe (union-find). Un groupe est "certain" si tous ses membres ont le
// même nom ET le même téléphone, sinon "probable".
function findDuplicateGroups(prospects: Prospect[]): DuplicateGroup[] {
  const n = prospects.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const byName = new Map<string, number[]>();
  const byPhone = new Map<string, number[]>();
  prospects.forEach((p, i) => {
    const nm = (p.nom_societe || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (nm) { if (!byName.has(nm)) byName.set(nm, []); byName.get(nm)!.push(i); }
    const ph = (p.telephone || '').replace(/\D/g, '');
    if (ph.length >= 6) { if (!byPhone.has(ph)) byPhone.set(ph, []); byPhone.get(ph)!.push(i); }
  });
  for (const idxs of byName.values()) for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);
  for (const idxs of byPhone.values()) for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);

  const groups = new Map<number, number[]>();
  prospects.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });

  const result: DuplicateGroup[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const items = idxs.map((i) => prospects[i]);
    const keys = new Set(items.map((p) => dedupKey(p.nom_societe, p.telephone)));
    result.push({ certain: keys.size === 1, items });
  }
  result.sort((a, b) => (Number(b.certain) - Number(a.certain)) || (b.items.length - a.items.length));
  return result;
}

export default function Prospects() {
  const { data: prospects = [], isLoading: loading, error, refetch, isFetching } = useProspects();
  const { data: registeredUsers = [] } = useRegisteredUsers();
  const { data: cityAttributions = [] } = useCityAttributions();
  const invalidateProspects = useInvalidateProspects();

  const [search, setSearch] = usePersistentState('lyftt.prospects.recherche', '');
  const [statusFilter, setStatusFilter] = usePersistentState('lyftt.prospects.statut', 'Tous');
  const [sectorFilter, setSectorFilter] = usePersistentState('lyftt.prospects.secteur', 'Tous');
  const [cityFilter, setCityFilter] = usePersistentState('lyftt.prospects.ville', 'Toutes');
  const [commercialFilter, setCommercialFilter] = usePersistentState('lyftt.prospects.commercial', 'Tous');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDuplicatesDialog, setShowDuplicatesDialog] = useState(false);
  const [deletingDuplicateId, setDeletingDuplicateId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newProspect, setNewProspect] = useState({
    nom_societe: '', nom_dirigeant: '', telephone: '', email: '',
    zone_geographique: '', categorie_metier: '', source_lead: '',
    montant_potentiel: 0, notes: '', priorite: 'moyenne',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { sectors, cities } = useMemo(() => {
    const sectorSet = new Set<string>();
    const citySet = new Set<string>();
    prospects.forEach((p) => {
      if (p.categorie_metier?.trim()) sectorSet.add(p.categorie_metier.trim());
      if (p.zone_geographique?.trim()) citySet.add(p.zone_geographique.trim());
    });
    return { sectors: ['Tous', ...Array.from(sectorSet).sort()], cities: ['Toutes', ...Array.from(citySet).sort()] };
  }, [prospects]);

  const duplicateGroups = useMemo(() => findDuplicateGroups(prospects), [prospects]);
  const duplicateCount = useMemo(() => duplicateGroups.reduce((s, g) => s + g.items.length, 0), [duplicateGroups]);

  const handleDeleteDuplicate = useCallback(async (p: Prospect) => {
    if (deletingDuplicateId) return;
    if (!window.confirm(`Supprimer "${p.nom_societe}" (${p.telephone || 'sans téléphone'}) ? Cette action supprime aussi son historique d'appels et est irréversible.`)) return;
    setDeletingDuplicateId(p.id);
    try {
      await client.entities.prospects.delete({ id: String(p.id) });
      toast.success('Prospect supprimé');
      invalidateProspects();
    } catch {
      toast.error('Erreur lors de la suppression (droits admin requis)');
    } finally {
      setDeletingDuplicateId(null);
    }
  }, [deletingDuplicateId, invalidateProspects]);

  const commercials = useMemo(() => {
    const names = registeredUsers
      .filter((u) => u.first_name || u.last_name)
      .map((u) => `${u.first_name || ''} ${u.last_name || ''}`.trim())
      .filter((n) => n.length > 0).sort();
    return ['Tous', ...names];
  }, [registeredUsers]);

  // Villes attribuées au commercial sélectionné (le filtre commercial = ses zones).
  const normName = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const selectedCommercialCities = useMemo<string[] | null>(() => {
    if (commercialFilter === 'Tous') return null;
    const u = registeredUsers.find((r) => normName(`${r.first_name || ''} ${r.last_name || ''}`) === normName(commercialFilter));
    if (!u) return [];
    return cityAttributions.filter((a) => a.user_role_id === u.id).map((a) => a.city);
  }, [commercialFilter, registeredUsers, cityAttributions]);

  // Le menu "ville" ne propose que les villes du commercial sélectionné (affinage),
  // sinon toutes les villes.
  const cityOptions = useMemo(() => {
    if (selectedCommercialCities && selectedCommercialCities.length > 0) {
      return ['Toutes', ...Array.from(new Set(selectedCommercialCities)).sort()];
    }
    return cities;
  }, [selectedCommercialCities, cities]);

  const filtered = useMemo(() => {
    const sl = search.toLowerCase();
    const commSet = selectedCommercialCities ? new Set(selectedCommercialCities) : null;
    return prospects.filter((p) => {
      const ms = !search || p.nom_societe?.toLowerCase().includes(sl) || p.nom_dirigeant?.toLowerCase().includes(sl) || p.email?.toLowerCase().includes(sl) || p.telephone?.includes(search) || p.categorie_metier?.toLowerCase().includes(sl);
      // Filtre commercial = restreint à ses villes attribuées (pas au champ commercial_assigne, peu fiable).
      const okCommercial = commercialFilter === 'Tous' || (commSet ? commSet.has(p.zone_geographique) : false);
      return ms
        && (statusFilter === 'Tous' || p.statut_avancement === statusFilter)
        && (sectorFilter === 'Tous' || p.categorie_metier === sectorFilter)
        && (cityFilter === 'Toutes' || p.zone_geographique === cityFilter)
        && okCommercial;
    });
  }, [prospects, search, statusFilter, sectorFilter, cityFilter, commercialFilter, selectedCommercialCities]);

  // Pagination côté client : avec ~15 000 prospects, rendre TOUTES les lignes
  // filtrées d'un coup fait ramer le navigateur (des milliers de <tr> dans le
  // DOM). On n'affiche qu'une page à la fois.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, statusFilter, sectorFilter, cityFilter, commercialFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const parsed = parseMondayExcel(XLSX, workbook);
      const updates = parseUpdates(XLSX, workbook); // 2e feuille : "update content" -> notes
      if (parsed.length === 0) { toast.error('Aucun prospect trouvé dans le fichier.'); return; }
      // Anti-doublon : on connaît déjà les prospects en base, et on retient
      // au fil de l'import ceux qu'on vient de créer (ré-import du même
      // fichier, ou fichier contenant deux fois la même société).
      const existingKeys = new Set(prospects.map((p) => dedupKey(p.nom_societe, p.telephone)));
      let imported = 0;
      let skipped = 0;
      const toastId = toast.loading(`Import en cours... 0/${parsed.length}`);
      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        try {
          if (!p.nom_societe.trim()) continue;
          const key = dedupKey(p.nom_societe, p.telephone);
          if (existingKeys.has(key)) { skipped++; continue; }
          const upd = updates.get(p.nom_societe.trim().toLowerCase()) || '';
          const ctx = [
            p.effectif ? `Effectif: ${p.effectif}` : '',
            p.forme ? `Forme: ${p.forme}` : '',
            p.statut_monday ? `Statut Monday: ${p.statut_monday}` : '',
          ].filter(Boolean).join(' · ');
          const note = [ctx, upd].filter(Boolean).join('\n\n');
          const mapped = mapMondayStatut(p.statut_monday);
          await client.entities.prospects.create({
            data: { nom_societe: p.nom_societe, nom_dirigeant: p.nom_dirigeant, telephone: p.telephone, email: p.email || '', zone_geographique: p.zone_geographique, categorie_metier: p.categorie_metier, commercial_assigne: p.commercial_assigne, source_lead: 'Import Excel', montant_potentiel: 0, notes: note, statut_avancement: mapped.statut_avancement, priorite: 'moyenne', statut_gagne_perdu: mapped.statut_gagne_perdu, nombre_appels: 0, nombre_appels_repondus: 0, nombre_relances: 0 },
          });
          existingKeys.add(key);
          imported++;
          if (imported % 10 === 0) toast.loading(`Import en cours... ${imported}/${parsed.length}`, { id: toastId });
        } catch { console.error('Failed to import:', p.nom_societe); }
      }
      const skippedMsg = skipped > 0 ? ` (${skipped} doublon(s) ignoré(s))` : '';
      toast.success(`${imported} prospect(s) importé(s)${skippedMsg}`, { id: toastId });
      invalidateProspects();
    } catch { toast.error("Erreur lors de l'import"); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [invalidateProspects]);

  const handleAddProspect = useCallback(async () => {
    if (saving) return; // anti double-submit (double clic / double Enter)
    if (!newProspect.nom_societe.trim()) { toast.error('Le nom de la société est requis'); return; }
    const key = dedupKey(newProspect.nom_societe, newProspect.telephone);
    const isDuplicate = prospects.some((p) => dedupKey(p.nom_societe, p.telephone) === key);
    if (isDuplicate && !window.confirm(`Un prospect "${newProspect.nom_societe}" avec ce numéro existe déjà. Créer quand même un doublon ?`)) {
      return;
    }
    setSaving(true);
    try {
      await client.entities.prospects.create({
        data: { ...newProspect, statut_avancement: 'Appel telephonique', statut_gagne_perdu: 'actif', nombre_appels: 0, nombre_appels_repondus: 0, nombre_relances: 0 },
      });
      toast.success('Prospect ajouté');
      setShowAddDialog(false);
      setNewProspect({ nom_societe: '', nom_dirigeant: '', telephone: '', email: '', zone_geographique: '', categorie_metier: '', source_lead: '', montant_potentiel: 0, notes: '', priorite: 'moyenne' });
      invalidateProspects();
    } catch { toast.error("Erreur lors de l'ajout"); } finally { setSaving(false); }
  }, [newProspect, invalidateProspects, prospects, saving]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  // "Sélectionner tout" porte sur la page affichée (pas sur les ~15 000
  // lignes filtrées) — cohérent avec ce que l'utilisateur voit à l'écran.
  const toggleSelectAll = useCallback(() => {
    const pageIds = paginated.map((p) => p.id);
    const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [paginated, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Supprimer ${selectedIds.size} prospect(s) ? Cette action est irréversible.`)) return;
    setDeleting(true);
    let deleted = 0;
    const toastId = toast.loading(`Suppression... 0/${selectedIds.size}`);
    for (const id of selectedIds) {
      try { await client.entities.prospects.delete({ id: String(id) }); deleted++; if (deleted % 5 === 0) toast.loading(`Suppression... ${deleted}/${selectedIds.size}`, { id: toastId }); } catch { /* skip */ }
    }
    toast.success(`${deleted} prospect(s) supprimé(s)`, { id: toastId });
    setSelectedIds(new Set());
    setDeleting(false);
    invalidateProspects();
  }, [selectedIds, invalidateProspects]);

  const handleExportExcel = useCallback(async () => {
    try {
      const XLSX = await import('xlsx');
      const rows = filtered.map((p) => ({
        'Société': p.nom_societe || '', 'Dirigeant': p.nom_dirigeant || '', 'Téléphone': p.telephone || '',
        'Email': p.email || '', 'Zone': p.zone_geographique || '', 'Catégorie': p.categorie_metier || '',
        'Commercial': p.commercial_assigne || '', 'Statut': p.statut_avancement || '', 'Résultat': p.statut_gagne_perdu || '',
        'Appels': p.nombre_appels || 0, 'Répondus': p.nombre_appels_repondus || 0, 'Relances': p.nombre_relances || 0,
        'Montant (€)': p.montant_potentiel || 0, 'Priorité': p.priorite || '', 'Source': p.source_lead || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.min(Math.max(k.length, ...rows.map((r) => String(r[k as keyof typeof r] ?? '').length)) + 2, 40) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Prospects');
      XLSX.writeFile(wb, `prospects_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`${rows.length} prospect(s) exporté(s)`);
    } catch { toast.error("Erreur lors de l'export"); }
  }, [filtered]);

  const allSelected = paginated.length > 0 && paginated.every((p) => selectedIds.has(p.id));
  const someSelected = paginated.some((p) => selectedIds.has(p.id)) && !allSelected;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Chargement des prospects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message="Impossible de charger les prospects."
        onRetry={() => refetch()}
        retrying={isFetching}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Prospects</h1>
          <p className="text-slate-500 mt-1">{prospects.length} prospect(s) au total</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          {duplicateCount > 0 && (
            <Button variant="outline" onClick={() => setShowDuplicatesDialog(true)} className="gap-2 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50">
              <Copy className="w-4 h-4" /> Doublons <Badge className="bg-amber-100 text-amber-700 border-amber-200 rounded-lg ml-0.5">{duplicateCount}</Badge>
            </Button>
          )}
          <Button variant="outline" onClick={handleExportExcel} disabled={filtered.length === 0} className="gap-2 rounded-xl border-slate-200"><Download className="w-4 h-4" /> Exporter</Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2 rounded-xl border-slate-200"><Upload className="w-4 h-4" /> Importer</Button>
          <Button onClick={() => setShowAddDialog(true)} className="gap-2 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl shadow-md shadow-[#6AABB4]/20"><Plus className="w-4 h-4" /> Ajouter</Button>
        </div>
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-2xl p-3 flex items-center justify-between border border-teal-100">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-teal-800">{selectedIds.size} sélectionné(s)</span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="text-teal-600 gap-1 h-8"><X className="w-3 h-3" /> Désélectionner</Button>
          </div>
          <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={deleting} className="gap-2 rounded-xl"><Trash2 className="w-4 h-4" /> {deleting ? 'Suppression...' : `Supprimer (${selectedIds.size})`}</Button>
        </div>
      )}

      {/* Filters */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 rounded-xl border-slate-200" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-52 rounded-xl border-slate-200"><Filter className="w-4 h-4 mr-2 text-slate-400" /><SelectValue /></SelectTrigger>
                <SelectContent>{STATUTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger className="w-48 rounded-xl border-slate-200"><Building2 className="w-4 h-4 mr-2 text-slate-400" /><SelectValue /></SelectTrigger>
                <SelectContent>{sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              {commercials.length > 1 && (
                <Select value={commercialFilter} onValueChange={(v) => { setCommercialFilter(v); setCityFilter('Toutes'); }}>
                  <SelectTrigger className="w-48 rounded-xl border-slate-200"><UserCircle className="w-4 h-4 mr-2 text-slate-400" /><SelectValue /></SelectTrigger>
                  <SelectContent>{commercials.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-44 rounded-xl border-slate-200"><MapPin className="w-4 h-4 mr-2 text-slate-400" /><SelectValue placeholder="Ville" /></SelectTrigger>
                <SelectContent>{cityOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-slate-100/50 border-b border-slate-200">
                <th className="px-3 py-3 w-10">
                  <Checkbox checked={allSelected} ref={(el) => { if (el) { const input = el as unknown as { dataset: DOMStringMap }; if (input.dataset) input.dataset.indeterminate = someSelected ? 'true' : 'false'; } }} onCheckedChange={toggleSelectAll} aria-label="Sélectionner tout" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Société</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Dirigeant</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Zone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Catégorie</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Statut</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Résultat</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Appels</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center"><Search className="w-5 h-5 text-slate-400" /></div>
                    <p className="text-slate-400">Aucun prospect trouvé</p>
                  </div>
                </td></tr>
              ) : paginated.map((p) => (
                <ProspectRow key={p.id} prospect={p} selected={selectedIds.has(p.id)} onToggle={toggleSelect} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination — évite de rendre les ~15 000 lignes filtrées d'un coup */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} sur {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="gap-1 rounded-xl border-slate-200">
                <ChevronLeft className="w-4 h-4" /> Précédent
              </Button>
              <span className="text-xs font-medium text-slate-500 px-1">Page {currentPage} / {pageCount}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount} className="gap-1 rounded-xl border-slate-200">
                Suivant <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle>Ajouter un prospect</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Société *</Label><Input value={newProspect.nom_societe} onChange={(e) => setNewProspect({ ...newProspect, nom_societe: e.target.value })} placeholder="Nom de la société" className="rounded-xl" /></div>
              <div><Label>Dirigeant</Label><Input value={newProspect.nom_dirigeant} onChange={(e) => setNewProspect({ ...newProspect, nom_dirigeant: e.target.value })} placeholder="Nom du dirigeant" className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Téléphone</Label><Input value={newProspect.telephone} onChange={(e) => setNewProspect({ ...newProspect, telephone: e.target.value })} placeholder="01 23 45 67 89" className="rounded-xl" /></div>
              <div><Label>Email</Label><Input value={newProspect.email} onChange={(e) => setNewProspect({ ...newProspect, email: e.target.value })} placeholder="email@example.com" className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Zone géographique</Label><Input value={newProspect.zone_geographique} onChange={(e) => setNewProspect({ ...newProspect, zone_geographique: e.target.value })} placeholder="Paris, Lyon..." className="rounded-xl" /></div>
              <div><Label>Catégorie métier</Label><Input value={newProspect.categorie_metier} onChange={(e) => setNewProspect({ ...newProspect, categorie_metier: e.target.value })} placeholder="BTP, Restaurant..." className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Source du lead</Label><Input value={newProspect.source_lead} onChange={(e) => setNewProspect({ ...newProspect, source_lead: e.target.value })} placeholder="LinkedIn, Salon..." className="rounded-xl" /></div>
              <div><Label>Montant potentiel (€)</Label><Input type="number" value={newProspect.montant_potentiel} onChange={(e) => setNewProspect({ ...newProspect, montant_potentiel: Number(e.target.value) })} className="rounded-xl" /></div>
            </div>
            <div>
              <Label>Priorité</Label>
              <Select value={newProspect.priorite} onValueChange={(v) => setNewProspect({ ...newProspect, priorite: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="haute">Haute</SelectItem>
                  <SelectItem value="moyenne">Moyenne</SelectItem>
                  <SelectItem value="basse">Basse</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={newProspect.notes} onChange={(e) => setNewProspect({ ...newProspect, notes: e.target.value })} placeholder="Notes..." rows={3} className="rounded-xl" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} disabled={saving} className="rounded-xl">Annuler</Button>
            <Button onClick={handleAddProspect} disabled={saving} className="bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl">{saving ? 'Ajout...' : 'Ajouter'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doublons — groupes détectés par nom et/ou téléphone identiques.
          "Certain" = société + téléphone identiques. "Probable" = correspondance
          partielle (même nom, téléphone différent, ou l'inverse). */}
      <Dialog open={showDuplicatesDialog} onOpenChange={setShowDuplicatesDialog}>
        <DialogContent className="max-w-2xl rounded-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Doublons détectés ({duplicateGroups.length} groupe{duplicateGroups.length > 1 ? 's' : ''}, {duplicateCount} prospects)</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 -mr-1">
            {duplicateGroups.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Aucun doublon détecté.</p>
            ) : duplicateGroups.map((group, gi) => (
              <div key={gi} className={`rounded-2xl border p-3 ${group.certain ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge className={`text-[10px] rounded-md ${group.certain ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                    {group.certain ? 'Doublon certain' : 'Doublon probable'}
                  </Badge>
                  <span className="text-xs text-slate-500">{group.items.length} fiches</span>
                </div>
                <div className="space-y-1.5">
                  {group.items.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 bg-white rounded-xl px-3 py-2 border border-slate-100">
                      <Link to={`/prospects/${p.id}`} className="min-w-0 flex-1 hover:text-[#5A9BA3]">
                        <p className="text-sm font-semibold text-slate-900 truncate">{p.nom_societe}</p>
                        <p className="text-xs text-slate-500 truncate">{p.telephone || 'sans tél.'} · {p.zone_geographique || '—'} · {p.statut_avancement} · {p.nombre_appels || 0} appel(s)</p>
                      </Link>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => handleDeleteDuplicate(p)}
                        disabled={deletingDuplicateId === p.id}
                        className="shrink-0 gap-1.5 rounded-lg border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> {deletingDuplicateId === p.id ? '...' : 'Supprimer'}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDuplicatesDialog(false)} className="rounded-xl">Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Memoized row component to prevent re-renders
import { memo } from 'react';

const ProspectRow = memo(function ProspectRow({ prospect: p, selected, onToggle }: { prospect: Prospect; selected: boolean; onToggle: (id: number) => void }) {
  const navigate = useNavigate();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <tr
      onClick={() => navigate(`/prospects/${p.id}`)}
      className={`cursor-pointer hover:bg-teal-50/40 transition-colors ${selected ? 'bg-teal-50/50' : ''}`}
    >
      <td className="px-3 py-3" onClick={stop}><Checkbox checked={selected} onCheckedChange={() => onToggle(p.id)} aria-label={`Sélectionner ${p.nom_societe}`} /></td>
      <td className="px-4 py-3"><div><p className="font-semibold text-slate-900 text-sm">{p.nom_societe}</p><p className="text-xs text-slate-400 lg:hidden">{p.categorie_metier}</p></div></td>
      <td className="px-4 py-3 text-sm text-slate-600 hidden md:table-cell">{p.nom_dirigeant}</td>
      <td className="px-4 py-3 text-sm text-slate-600 hidden lg:table-cell">{p.zone_geographique}</td>
      <td className="px-4 py-3 hidden lg:table-cell"><Badge variant="outline" className="text-xs rounded-lg">{p.categorie_metier}</Badge></td>
      <td className="px-4 py-3"><Badge className={`text-xs rounded-lg ${statusBadgeColors[p.statut_avancement] || 'bg-slate-100 text-slate-700'}`}>{p.statut_avancement}</Badge></td>
      <td className="px-4 py-3 hidden sm:table-cell"><Badge className={`text-xs rounded-lg ${resultColors[p.statut_gagne_perdu] || 'bg-slate-100 text-slate-700'}`}>{p.statut_gagne_perdu}</Badge></td>
      <td className="px-4 py-3 hidden md:table-cell"><div className="flex items-center gap-1 text-sm text-slate-600"><Phone className="w-3 h-3" />{p.nombre_appels || 0}</div></td>
      <td className="px-4 py-3 text-center" onClick={stop}><Link to={`/prospects/${p.id}`}><Button variant="ghost" size="sm" className="gap-1 text-[#5A9BA3] hover:text-[#4A8B93] hover:bg-teal-50 rounded-lg"><ExternalLink className="w-4 h-4" /><span className="hidden sm:inline">Voir</span></Button></Link></td>
    </tr>
  );
});