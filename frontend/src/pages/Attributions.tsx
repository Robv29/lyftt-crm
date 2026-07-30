import { useState, useMemo, useCallback } from 'react';
import { client } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import {
  useProspects, useRegisteredUsers, useCityAttributions,
  type RegisteredUser, type CityAttribution,
} from '../hooks/use-prospects';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/use-prospects';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { MapPin, Plus, Trash2, Search, Users, Building2 } from 'lucide-react';
import ErrorState from '../components/ErrorState';

export default function Attributions() {
  const { isAdmin, userRole } = useAuth();
  const { data: allProspects = [], isLoading: loadingP, error: errorP, refetch: refetchP, isFetching: fetchingP } = useProspects();
  const { data: users = [], isLoading: loadingU, error: errorU, refetch: refetchU, isFetching: fetchingU } = useRegisteredUsers();
  const { data: attributions = [], isLoading: loadingA, error: errorA, refetch: refetchA, isFetching: fetchingA } = useCityAttributions();
  const queryClient = useQueryClient();

  const loading = loadingP || loadingU || loadingA;
  const hasError = errorP || errorU || errorA;
  const handleRetryAll = useCallback(() => {
    if (errorP) refetchP();
    if (errorU) refetchU();
    if (errorA) refetchA();
  }, [errorP, errorU, errorA, refetchP, refetchU, refetchA]);

  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  // For non-admin users, lock selectedUser to their own userRole.id
  const effectiveSelectedUser = useMemo(() => {
    if (!isAdmin && userRole) return String(userRole.id);
    return selectedUser;
  }, [isAdmin, userRole, selectedUser]);

  const availableCities = useMemo(() => {
    const citySet = new Set<string>();
    allProspects.forEach((p) => {
      if (p.zone_geographique?.trim()) citySet.add(p.zone_geographique.trim());
    });
    return Array.from(citySet).sort();
  }, [allProspects]);

  const getUserName = useCallback((userRoleId: number): string => {
    const u = users.find((usr) => usr.id === userRoleId);
    if (!u) return 'Inconnu';
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return '';
  }, [users]);

  const commercialUsers = useMemo(() => users.filter((u) => u.is_active), [users]);

  const currentUserLabel = useMemo(() => {
    if (!userRole) return '';
    const u = users.find((usr) => usr.id === userRole.id);
    if (!u) return '';
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return '';
  }, [users, userRole]);

  const attributedCities = useMemo(() => new Set(attributions.map((a) => a.city)), [attributions]);
  const unattributedCities = useMemo(() => availableCities.filter((c) => !attributedCities.has(c)), [availableCities, attributedCities]);
  const filteredCitiesForSelect = useMemo(() => availableCities.filter((c) => !attributedCities.has(c)), [availableCities, attributedCities]);

  const attributionsByUser = useMemo(() => {
    const map = new Map<number, CityAttribution[]>();
    attributions.forEach((a) => {
      const existing = map.get(a.user_role_id) || [];
      existing.push(a);
      map.set(a.user_role_id, existing);
    });
    return map;
  }, [attributions]);

  const filteredAttributionsByUser = useMemo(() => {
    if (!searchTerm) return attributionsByUser;
    const term = searchTerm.toLowerCase();
    const filtered = new Map<number, CityAttribution[]>();
    attributionsByUser.forEach((attrs, userId) => {
      const userName = getUserName(userId).toLowerCase();
      const matchingAttrs = attrs.filter(
        (a) => a.city.toLowerCase().includes(term) || userName.includes(term)
      );
      if (matchingAttrs.length > 0) filtered.set(userId, matchingAttrs);
    });
    return filtered;
  }, [attributionsByUser, searchTerm, getUserName]);

  const canModify = useCallback((targetUserRoleId: number): boolean => {
    if (isAdmin) return true;
    if (!userRole) return false;
    return userRole.id === targetUserRoleId;
  }, [isAdmin, userRole]);

  const handleAdd = useCallback(async () => {
    if (!effectiveSelectedUser || !selectedCity) {
      toast.error('Veuillez sélectionner une ville');
      return;
    }
    if (!isAdmin && userRole && String(userRole.id) !== effectiveSelectedUser) {
      toast.error('Vous ne pouvez attribuer des villes qu\'à vous-même');
      return;
    }
    try {
      await client.apiCall.invoke({
        url: '/api/v1/entities/city_attributions',
        method: 'POST',
        data: { user_role_id: parseInt(effectiveSelectedUser), city: selectedCity, created_at: new Date().toISOString() },
      });
      setSelectedCity('');
      toast.success(`${selectedCity} attribuée à ${getUserName(parseInt(effectiveSelectedUser))}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.cityAttributions });
    } catch {
      toast.error("Erreur lors de l'attribution");
    }
  }, [effectiveSelectedUser, selectedCity, isAdmin, userRole, getUserName, queryClient]);

  const handleRemove = useCallback(async (attr: CityAttribution) => {
    if (!canModify(attr.user_role_id)) {
      toast.error('Vous ne pouvez supprimer que vos propres attributions');
      return;
    }
    try {
      await client.apiCall.invoke({
        url: `/api/v1/entities/city_attributions/${attr.id}`,
        method: 'DELETE',
        data: {},
      });
      toast.success('Attribution supprimée');
      await queryClient.invalidateQueries({ queryKey: queryKeys.cityAttributions });
    } catch {
      toast.error('Erreur lors de la suppression');
      await queryClient.invalidateQueries({ queryKey: queryKeys.cityAttributions });
    }
  }, [canModify, queryClient]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Chargement des attributions...</p>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <ErrorState
        message="Impossible de charger les attributions."
        onRetry={handleRetryAll}
        retrying={fetchingP || fetchingU || fetchingA}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Attributions</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isAdmin ? 'Attribuez les villes/zones aux commerciaux' : 'Gérez vos attributions de villes/zones'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1.5 px-3 rounded-xl">
            <MapPin className="w-3.5 h-3.5" /> {attributions.length} attribution(s)
          </Badge>
          <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-amber-600 border-amber-200 bg-amber-50 rounded-xl">
            <Building2 className="w-3.5 h-3.5" /> {unattributedCities.length} non attribuée(s)
          </Badge>
        </div>
      </div>

      {/* Add form */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-[#5A9BA3] to-[#6AABB4] rounded-lg flex items-center justify-center">
              <Plus className="w-3.5 h-3.5 text-white" />
            </div>
            Nouvelle attribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            {isAdmin ? (
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="sm:w-64 rounded-xl border-slate-200"><SelectValue placeholder="Sélectionner un commercial" /></SelectTrigger>
                <SelectContent>
                  {commercialUsers.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : ''}{u.role === 'admin' && ' (Admin)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="sm:w-64 flex items-center gap-2 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-700">
                <Users className="w-4 h-4 text-slate-400" />
                <span className="font-medium">{currentUserLabel || 'Vous'}</span>
              </div>
            )}
            <Select value={selectedCity} onValueChange={setSelectedCity}>
              <SelectTrigger className="sm:w-64 rounded-xl border-slate-200"><SelectValue placeholder="Sélectionner une ville" /></SelectTrigger>
              <SelectContent>
                {filteredCitiesForSelect.length === 0 && (
                  <SelectItem value="__empty__" disabled>Toutes les villes sont attribuées</SelectItem>
                )}
                {filteredCitiesForSelect.map((city) => (
                  <SelectItem key={city} value={city}>{city}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAdd} disabled={!effectiveSelectedUser || !selectedCity} className="gap-2">
              <Plus className="w-4 h-4" /> Attribuer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input placeholder="Rechercher par commercial ou ville..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 rounded-xl border-slate-200" />
      </div>

      {/* Attributions by user */}
      <div className="grid gap-4">
        {commercialUsers
          .filter((u) => {
            if (!searchTerm) return true;
            const userAttrs = filteredAttributionsByUser.get(u.id) || [];
            const allUserAttrs = attributionsByUser.get(u.id) || [];
            return userAttrs.length > 0 || allUserAttrs.length > 0;
          })
          .map((u) => {
            const userAttrs = filteredAttributionsByUser.get(u.id) || [];
            const allUserAttrs = attributionsByUser.get(u.id) || [];
            const displayAttrs = searchTerm ? userAttrs : allUserAttrs;
            const isOwnSection = userRole && u.id === userRole.id;
            const canEdit = canModify(u.id);

            return (
              <Card key={u.id} className={`border-0 shadow-sm rounded-2xl ${isOwnSection ? 'ring-1 ring-teal-200' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOwnSection ? 'bg-gradient-to-br from-[#5A9BA3] to-[#6AABB4]' : 'bg-gradient-to-br from-teal-100 to-cyan-100'}`}>
                      <Users className={`w-4 h-4 ${isOwnSection ? 'text-white' : 'text-[#5A9BA3]'}`} />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">
                        {u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : ''}
                        {isOwnSection ? <span className="text-xs text-[#5A9BA3] ml-2">(vous)</span> : null}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs rounded-lg">{allUserAttrs.length} ville(s)</Badge>
                  </div>
                  {displayAttrs.length === 0 ? (
                    <p className="text-sm text-slate-400 italic pl-12">Aucune ville attribuée</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 pl-12">
                      {displayAttrs.map((attr) => (
                        <Badge key={attr.id} variant="outline" className={`gap-1.5 py-1 px-2.5 bg-slate-50 transition-all rounded-lg ${canEdit ? 'hover:bg-red-50 hover:border-red-200 group' : ''}`}>
                          <MapPin className={`w-3 h-3 ${canEdit ? 'text-slate-400 group-hover:text-red-400 transition-colors' : 'text-slate-400'}`} />
                          <span className="text-sm">{attr.city}</span>
                          {canEdit ? (
                            <button onClick={() => handleRemove(attr)} className="ml-1 text-slate-300 hover:text-red-500 transition-colors" title="Supprimer">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          ) : null}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
      </div>

      {/* Unattributed cities */}
      {unattributedCities.length > 0 && (
        <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-400" />
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-700 flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Villes non attribuées ({unattributedCities.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unattributedCities.map((city) => (
                <Badge key={city} variant="outline" className="py-1 px-2.5 bg-amber-50 border-amber-200 text-amber-700 rounded-lg">
                  <MapPin className="w-3 h-3 mr-1" /> {city}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
