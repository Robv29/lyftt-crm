// =====================================================================
// Adaptateur Supabase — remplace @metagptx/web-sdk (createClient()).
// Garde EXACTEMENT la même interface que le SDK MGX pour que les pages
// existantes fonctionnent sans être réécrites :
//   client.entities.<table>.queryAll / create / update / delete
//   client.apiCall.invoke({ url, method, data })
//   client.auth.me / login / toLogin / logout
// Le moteur dessous est supabase-js (PostgREST + RLS + Auth).
// =====================================================================
import { supabase } from './supabase';

// ---- Utilitaires -----------------------------------------------------
type AnyObj = Record<string, unknown>;

function wrapError(error: { message?: string; code?: string; details?: string } | null) {
  const e = new Error(error?.message || 'Requête échouée') as Error & {
    data?: { detail?: string };
    status?: number;
  };
  e.data = { detail: error?.message || error?.details };
  // 42501 / PGRST301 = violation de politique RLS -> on remonte un 403
  if (error?.code === '42501' || error?.code === 'PGRST301') e.status = 403;
  return e;
}

// ---- entities.<table> ------------------------------------------------
interface QueryAllOptions {
  query?: AnyObj;
  sort?: string; // ex: '-updated_at' (préfixe '-' = décroissant)
  limit?: number;
  skip?: number;
}

function makeEntity(table: string) {
  return {
    async queryAll(opts: QueryAllOptions = {}) {
      const { query = {}, sort, limit = 1000, skip = 0 } = opts;
      let q = supabase.from(table).select('*');

      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          q = q.eq(key, value as never);
        }
      }
      if (sort) {
        const desc = sort.startsWith('-');
        const col = desc ? sort.slice(1) : sort;
        q = q.order(col, { ascending: !desc });
      }
      if (limit) q = q.range(skip, skip + limit - 1);

      const { data, error } = await q;
      if (error) throw wrapError(error);
      return { data: { items: data ?? [], total: (data ?? []).length } };
    },

    async create(payload: { data?: AnyObj } | AnyObj) {
      const body = { ...((payload as { data?: AnyObj }).data ?? (payload as AnyObj)) };
      delete (body as AnyObj).id;
      const { data, error } = await supabase.from(table).insert(body).select().single();
      if (error) throw wrapError(error);
      return { data };
    },

    async update({ id, data: patch }: { id: string | number; data: AnyObj }) {
      const body = { ...patch };
      delete (body as AnyObj).id;
      const { data, error } = await supabase
        .from(table)
        .update(body)
        .eq('id', id)
        .select()
        .single();
      if (error) throw wrapError(error);
      return { data };
    },

    async delete({ id }: { id: string | number }) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw wrapError(error);
      return { data: { success: true } };
    },
  };
}

const entities = new Proxy({} as Record<string, ReturnType<typeof makeEntity>>, {
  get: (_target, table: string) => makeEntity(table),
});

// ---- apiCall.invoke : routage des anciens endpoints backend ----------
interface InvokeArgs {
  url: string;
  method?: string;
  data?: AnyObj;
}

async function invoke({ url, method = 'GET', data = {} }: InvokeArgs) {
  const m = method.toUpperCase();
  const path = url.split('?')[0];

  // --- Rôle de l'utilisateur courant ---
  if (path === '/api/v1/user-management/me' && m === 'GET') {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      const e = new Error('Non authentifié') as Error & { status?: number };
      e.status = 401;
      throw e;
    }
    const { data: role, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (error) throw wrapError(error);
    if (!role) {
      const e = new Error('Aucun rôle attribué') as Error & { status?: number };
      e.status = 403;
      throw e;
    }
    return { data: role };
  }

  // --- Liste des utilisateurs (admin) ---
  if (path === '/api/v1/user-management/users') {
    if (m === 'GET') {
      const { data: rows, error } = await supabase
        .from('user_roles')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw wrapError(error);
      return { data: rows ?? [] };
    }
    if (m === 'POST') {
      // Pré-création d'un utilisateur par email : lié à son compte auth
      // dès qu'il s'inscrit (voir trigger handle_new_user en SQL).
      const body = {
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role ?? 'commercial',
      };
      const { data: row, error } = await supabase
        .from('user_roles')
        .insert(body)
        .select()
        .single();
      if (error) throw wrapError(error);
      return { data: row };
    }
  }

  // --- Liste publique (champs limités) ---
  if (path === '/api/v1/user-management/users/public' && m === 'GET') {
    const { data: rows, error } = await supabase
      .from('user_roles')
      .select('id,email,first_name,last_name,role,is_active')
      .order('created_at', { ascending: true });
    if (error) throw wrapError(error);
    return { data: rows ?? [] };
  }

  // --- Utilisateur par id (update / delete) ---
  const umMatch = path.match(/^\/api\/v1\/user-management\/users\/(\d+)$/);
  if (umMatch) {
    const id = umMatch[1];
    if (m === 'DELETE') {
      const { error } = await supabase.from('user_roles').delete().eq('id', id);
      if (error) throw wrapError(error);
      return { data: { success: true } };
    }
    if (m === 'PUT' || m === 'PATCH') {
      const { data: row, error } = await supabase
        .from('user_roles')
        .update(data)
        .eq('id', id)
        .select()
        .single();
      if (error) throw wrapError(error);
      return { data: row };
    }
  }

  // --- Attributions de villes ---
  if (path === '/api/v1/entities/city_attributions') {
    if (m === 'GET') {
      const { data: rows, error } = await supabase
        .from('city_attributions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw wrapError(error);
      return { data: { items: rows ?? [] } };
    }
    if (m === 'POST') {
      const body = { user_role_id: data.user_role_id, city: data.city };
      const { data: row, error } = await supabase
        .from('city_attributions')
        .insert(body)
        .select()
        .single();
      if (error) throw wrapError(error);
      return { data: row };
    }
  }
  const caMatch = path.match(/^\/api\/v1\/entities\/city_attributions\/(\d+)$/);
  if (caMatch && m === 'DELETE') {
    const { error } = await supabase.from('city_attributions').delete().eq('id', caMatch[1]);
    if (error) throw wrapError(error);
    return { data: { success: true } };
  }

  throw new Error(`Route non gérée par l'adaptateur Supabase : ${m} ${url}`);
}

// ---- auth ------------------------------------------------------------
const auth = {
  async me() {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
      const e = new Error('Non authentifié') as Error & { status?: number };
      e.status = 401;
      throw e;
    }
    const u = data.user;
    const meta = (u.user_metadata ?? {}) as AnyObj;
    const name =
      [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim() || u.email;
    return { data: { id: u.id, email: u.email, name, ...meta } };
  },
  async login() {
    window.location.href = '/login';
  },
  async toLogin() {
    window.location.href = '/login';
  },
  async logout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  },
};

// ---- Client exporté (même forme que MGX) -----------------------------
export const client = {
  entities,
  apiCall: { invoke },
  auth,
};

export default client;
