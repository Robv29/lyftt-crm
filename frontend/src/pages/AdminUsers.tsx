import { useEffect, useState } from 'react';
import { client } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  UserPlus,
  Trash2,
  Users,
  ShieldCheck,
  Briefcase,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import ErrorState from '../components/ErrorState';

interface UserRole {
  id: number;
  user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
}

export default function AdminUsers() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [formFirstName, setFormFirstName] = useState('');
  const [formLastName, setFormLastName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('commercial');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const res = await client.apiCall.invoke({
        url: '/api/v1/user-management/users',
        method: 'GET',
        data: {},
      });
      setUsers((res.data as UserRole[]) || []);
    } catch (err: any) {
      console.error('Failed to fetch users:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async () => {
    if (!formEmail.trim() || !formFirstName.trim() || !formLastName.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      setCreating(true);
      await client.apiCall.invoke({
        url: '/api/v1/user-management/users',
        method: 'POST',
        data: {
          email: formEmail.trim(),
          first_name: formFirstName.trim(),
          last_name: formLastName.trim(),
          role: formRole,
        },
      });
      toast.success('Utilisateur créé avec succès');
      setFormFirstName('');
      setFormLastName('');
      setFormEmail('');
      setFormRole('commercial');
      setDialogOpen(false);
      fetchUsers();
    } catch (err: any) {
      const detail =
        err?.data?.detail ||
        err?.response?.data?.detail ||
        'Erreur lors de la création';
      toast.error(detail);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (userId: number, email: string) => {
    if (!confirm(`Supprimer l'utilisateur ${email} ?`)) return;

    try {
      await client.apiCall.invoke({
        url: `/api/v1/user-management/users/${userId}`,
        method: 'DELETE',
        data: {},
      });
      toast.success('Utilisateur supprimé');
      fetchUsers();
    } catch (err: any) {
      const detail =
        err?.data?.detail ||
        err?.response?.data?.detail ||
        'Erreur lors de la suppression';
      toast.error(detail);
    }
  };

  const adminCount = users.filter((u) => u.role === 'admin').length;
  const commercialCount = users.filter((u) => u.role === 'commercial').length;

  // Guard: only admins can access this page
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Accès réservé aux administrateurs</h2>
          <p className="text-sm text-slate-500">Vous n&apos;avez pas les permissions nécessaires pour accéder à cette page.</p>
        </div>
      </div>
    );
  }

  if (loadError && users.length === 0) {
    return (
      <ErrorState
        message="Impossible de charger les utilisateurs."
        onRetry={fetchUsers}
        retrying={loading}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Gestion des utilisateurs
          </h1>
          <p className="text-slate-500 mt-1">
            Créez et gérez les comptes de vos commerciaux
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
              <UserPlus className="w-4 h-4 mr-2" />
              Nouveau compte
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Créer un compte utilisateur</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Prénom</Label>
                  <Input
                    id="firstName"
                    placeholder="Jean"
                    value={formFirstName}
                    onChange={(e) => setFormFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Nom</Label>
                  <Input
                    id="lastName"
                    placeholder="Dupont"
                    value={formLastName}
                    onChange={(e) => setFormLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jean.dupont@example.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Rôle</Label>
                <Select value={formRole} onValueChange={setFormRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">
                      <span className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4" />
                        Commercial
                      </span>
                    </SelectItem>
                    <SelectItem value="admin">
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4" />
                        Administrateur
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-700">
                  <strong>Note :</strong> L'utilisateur devra se connecter avec
                  cet email via la page de connexion. Son compte sera
                  automatiquement activé.
                </p>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Annuler</Button>
              </DialogClose>
              <Button
                onClick={handleCreate}
                disabled={creating}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {creating ? 'Création...' : 'Créer le compte'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-sm text-slate-500">Total utilisateurs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{adminCount}</p>
                <p className="text-sm text-slate-500">Administrateurs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Briefcase className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{commercialCount}</p>
                <p className="text-sm text-slate-500">Commerciaux</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Liste des utilisateurs</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              Aucun utilisateur enregistré
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.first_name || ''} {u.last_name || ''}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {u.email}
                      </TableCell>
                      <TableCell>
                        {u.role === 'admin' ? (
                          <Badge className="bg-amber-100 text-amber-700 border-0">
                            <ShieldCheck className="w-3 h-3" />
                            Admin
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-100 text-blue-700 border-0">
                            <Briefcase className="w-3 h-3" />
                            Commercial
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.user_id ? (
                          <span className="flex items-center gap-1 text-emerald-600 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            Connecté
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-400 text-sm">
                            <XCircle className="w-4 h-4" />
                            En attente
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(u.id, u.email)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
