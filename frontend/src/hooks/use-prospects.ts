import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export interface Prospect {
  id: number;
  nom_societe: string;
  nom_dirigeant: string;
  telephone: string;
  email: string;
  zone_geographique: string;
  categorie_metier: string;
  commercial_assigne: string;
  statut_avancement: string;
  date_dernier_appel: string;
  date_prochaine_relance: string;
  date_relance_planifiee: string;
  nombre_appels: number;
  nombre_appels_repondus: number;
  nombre_relances: number;
  date_visio: string;
  date_demande_documents: string;
  date_signature: string;
  date_rdv: string;
  notes: string;
  forme_juridique: string;
  nombre_salaries: string;
  doc_cfp_recu: boolean;
  doc_kbis_recu: boolean;
  doc_cni_recu: boolean;
  signed_by_user_id: number | null;
  monday_item_id: number | null;
  monday_item_url: string | null;
  monday_sync_status: string | null;
  monday_synced_at: string | null;
  monday_last_sync_at: string | null;
  monday_sync_error: string | null;
  ca_encaisse: boolean;
  date_encaissement: string | null;
  priorite: string;
  source_lead: string;
  montant_potentiel: number;
  statut_gagne_perdu: string;
  opco_docs: string;
  budget_hors_opco: string;
  derniere_maj: string;
  created_at: string;
  updated_at: string;
}

export interface CommercialAction {
  id: number;
  user_id: string;
  prospect_id: number;
  action_type: string;
  appel_repondu: boolean;
  from_status: string;
  to_status: string;
  notes: string;
  action_date: string;
  created_at: string;
}

export interface MondaySyncLogEntry {
  id: number;
  prospect_id: number;
  event: string;
  detail: string | null;
  success: boolean;
  created_at: string;
}

export interface ObjectifCA {
  id: number;
  user_role_id: number;
  mois: string; // 'YYYY-MM-DD', toujours le 1er du mois
  objectif_ca: number;
  created_at: string;
  updated_at: string;
}

export interface PaiementClient {
  id: number;
  prospect_id: number;
  montant: number;
  date_paiement: string; // 'YYYY-MM-DD'
  note: string | null;
  created_at: string;
}

export interface RegisteredUser {
  id: number;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
  taux_commission?: number | null;
}

export interface CityAttribution {
  id: number;
  user_role_id: number;
  city: string;
  created_at: string | null;
}

// Keys for React Query cache
export const queryKeys = {
  prospects: ['prospects'] as const,
  actions: ['commercial_actions'] as const,
  prospectActions: (id: number) => ['commercial_actions', id] as const,
  users: ['registered_users'] as const,
  cityAttributions: ['city_attributions'] as const,
};

export function useProspects() {
  return useQuery({
    queryKey: queryKeys.prospects,
    queryFn: async () => {
      const res = await client.entities.prospects.queryAll({
        query: {},
        sort: '-updated_at',
        limit: 1000000,
      });
      return (res.data?.items || []) as Prospect[];
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes in cache
  });
}

export function useActions() {
  return useQuery({
    queryKey: queryKeys.actions,
    queryFn: async () => {
      const res = await client.entities.commercial_actions.queryAll({
        query: {},
        sort: '-action_date',
        limit: 1000000,
      });
      return (res.data?.items || []) as CommercialAction[];
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useProspectActions(prospectId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.prospectActions(prospectId || 0),
    queryFn: async () => {
      if (!prospectId) return [];
      const res = await client.entities.commercial_actions.queryAll({
        query: { prospect_id: prospectId },
        sort: '-action_date',
        limit: 100,
      });
      return (res.data?.items || []) as CommercialAction[];
    },
    enabled: !!prospectId,
    staleTime: 60 * 1000,
  });
}

export function useMondaySyncLog(prospectId: number | undefined) {
  return useQuery({
    queryKey: ['monday_sync_log', prospectId || 0] as const,
    queryFn: async () => {
      if (!prospectId) return [];
      const res = await client.entities.monday_sync_log.queryAll({
        query: { prospect_id: prospectId },
        sort: '-created_at',
        limit: 50,
      });
      return (res.data?.items || []) as MondaySyncLogEntry[];
    },
    enabled: !!prospectId,
    staleTime: 30 * 1000,
  });
}

export function useInvalidateMondaySyncLog() {
  const queryClient = useQueryClient();
  return (prospectId: number) => {
    queryClient.invalidateQueries({ queryKey: ['monday_sync_log', prospectId] });
  };
}

export function useObjectifsCA() {
  return useQuery({
    queryKey: ['objectifs_ca'] as const,
    queryFn: async () => {
      const res = await client.entities.objectifs_ca.queryAll({
        query: {},
        sort: '-mois',
        limit: 5000,
      });
      return (res.data?.items || []) as ObjectifCA[];
    },
    staleTime: 60 * 1000,
  });
}

export function useUpsertObjectifCA() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userRoleId: number; mois: string; objectifCa: number; existingId?: number }) => {
      if (params.existingId) {
        return client.entities.objectifs_ca.update({
          id: params.existingId,
          data: { objectif_ca: params.objectifCa, updated_at: new Date().toISOString() },
        });
      }
      return client.entities.objectifs_ca.create({
        user_role_id: params.userRoleId,
        mois: params.mois,
        objectif_ca: params.objectifCa,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['objectifs_ca'] });
    },
  });
}

export function usePaiements() {
  return useQuery({
    queryKey: ['paiements_clients'] as const,
    queryFn: async () => {
      const res = await client.entities.paiements_clients.queryAll({
        query: {},
        sort: '-date_paiement',
        limit: 50000,
      });
      return (res.data?.items || []) as PaiementClient[];
    },
    staleTime: 30 * 1000,
  });
}

export function useAddPaiement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { prospectId: number; montant: number; datePaiement: string; note?: string }) => {
      return client.entities.paiements_clients.create({
        prospect_id: params.prospectId, montant: params.montant, date_paiement: params.datePaiement, note: params.note || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paiements_clients'] });
    },
  });
}

export function useDeletePaiement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => client.entities.paiements_clients.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paiements_clients'] });
    },
  });
}

export function useRegisteredUsers() {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: async () => {
      const url = isAdmin
        ? '/api/v1/user-management/users'
        : '/api/v1/user-management/users/public';
      const res = await client.apiCall.invoke({
        url,
        method: 'GET',
        data: {},
      });
      return (res.data as RegisteredUser[]) || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

export function useUpdateTauxCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userId: number; taux: number }) => {
      return client.apiCall.invoke({
        url: `/api/v1/user-management/users/${params.userId}`,
        method: 'PUT',
        data: { taux_commission: params.taux },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useCityAttributions() {
  return useQuery({
    queryKey: queryKeys.cityAttributions,
    queryFn: async () => {
      const res = await client.apiCall.invoke({
        url: '/api/v1/entities/city_attributions?limit=2000',
        method: 'GET',
        data: {},
      });
      // Response could be { items: [...], total, skip, limit } or direct array
      const responseData = res.data as any;
      if (responseData?.items) return responseData.items as CityAttribution[];
      if (Array.isArray(responseData)) return responseData as CityAttribution[];
      return [] as CityAttribution[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

export function useInvalidateProspects() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
  };
}

export function useInvalidateActions() {
  const queryClient = useQueryClient();
  return (prospectId?: number) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.actions });
    if (prospectId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospectActions(prospectId) });
    }
  };
}