import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  X,
  UserRoundCheck,
  ChevronDown,
  ChevronUp,
  Settings,
  TrendingUp,
  Wallet,
  CreditCard,
  Users,
  FileText,
  Layers,
  ShoppingBag,
  Mail,
  Building2,
  Sparkles,
  Info,
  Check,
} from 'lucide-react';

import { api, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { SearchableSelect } from './SearchableSelect';

interface PermissionItem {
  id: number;
  code: string;
  module: string;
  action: string;
  description?: string | null;
  is_page_level?: boolean;
  is_active?: boolean;
}

interface ProfilePermission extends PermissionItem {}

interface RbacProfile {
  id: number;
  empresa_id?: number | null;
  name: string;
  code: string;
  description?: string | null;
  is_active: boolean;
  is_system: boolean;
  is_template: boolean;
  base_template_code?: string | null;
  editable: boolean;
  permission_count: number;
  user_count: number;
  permissions: ProfilePermission[];
}

interface RbacUser {
  id: number;
  nome?: string | null;
  email: string;
  foto_url?: string | null;
  is_active: boolean;
  is_consultor: boolean;
  consultor_role: string;
  empresa_id?: number | null;
  profile_id?: number | null;
  profile_name?: string | null;
  profile_code?: string | null;
}

interface CurrentUserResponse {
  permissions?: string[] | null;
}

type Feedback = {
  type: 'success' | 'error' | 'warning';
  message: string;
};

function sortPermissions(items: PermissionItem[]) {
  return [...items]
    .filter((item) => item.module !== 'consultor')
    .sort((left, right) => {
      const moduleCompare = left.module.localeCompare(right.module, 'pt-BR');
      if (moduleCompare !== 0) return moduleCompare;
      const actionCompare = left.action.localeCompare(right.action, 'pt-BR');
      if (actionCompare !== 0) return actionCompare;
      return left.code.localeCompare(right.code, 'pt-BR');
    });
}

function groupPermissions(items: PermissionItem[]) {
  const grouped = new Map<string, PermissionItem[]>();
  sortPermissions(items).forEach((item) => {
    let moduleName = item.module;
    if (item.code === 'lancamentos:import_nfe') {
      moduleName = 'importacao_nfe';
    }
    const bucket = grouped.get(moduleName) || [];
    bucket.push(item);
    grouped.set(moduleName, bucket);
  });
  return Array.from(grouped.entries());
}

function getModuleIcon(module: string) {
  const mod = module.toLowerCase();
  if (mod.includes('home')) return <Layers className="h-4 w-4 text-cyan-500" />;
  if (mod.includes('boletim')) return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  if (mod.includes('dre')) return <TrendingUp className="h-4 w-4 text-indigo-500" />;
  if (mod.includes('lancamentos')) return <Wallet className="h-4 w-4 text-rose-500" />;
  if (mod.includes('contas')) return <Wallet className="h-4 w-4 text-amber-500" />;
  if (mod.includes('cartoes')) return <CreditCard className="h-4 w-4 text-purple-500" />;
  if (mod.includes('entidades')) return <Users className="h-4 w-4 text-blue-500" />;
  if (mod.includes('centro_custo')) return <FileText className="h-4 w-4 text-slate-500" />;
  if (mod.includes('importacao')) return <Layers className="h-4 w-4 text-teal-500" />;
  if (mod.includes('integracoes')) return <Settings className="h-4 w-4 text-indigo-500" />;
  if (mod.includes('configuracoes') || mod.includes('empresa')) return <Settings className="h-4 w-4 text-pink-500" />;
  if (mod.includes('usuarios') || mod.includes('profiles')) return <Shield className="h-4 w-4 text-violet-500" />;
  if (mod.includes('pdv')) return <ShoppingBag className="h-4 w-4 text-orange-500" />;
  return <Shield className="h-4 w-4 text-slate-400" />;
}

function formatLabel(value: string) {
  if (value.toLowerCase() === 'pdv') return 'PDV';
  return value
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === 'pdv') return 'PDV';
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function getPermissionTitle(permission: PermissionItem) {
  if (permission.description?.trim()) return permission.description.trim();

  if (permission.is_page_level) {
    return `Acesso a pagina de ${formatLabel(permission.module)}`;
  }

  return `${formatLabel(permission.action)} de ${formatLabel(permission.module)}`;
}

function getPermissionSubtitle(permission: PermissionItem) {
  if (permission.is_page_level) {
    return 'Permissão de acesso à página';
  }

  const moduleName = permission.code === 'lancamentos:import_nfe' ? 'importacao_nfe' : permission.module;
  return `Permissão do módulo ${formatLabel(moduleName)}`;
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return 'US';

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function getUserDisplayName(user: RbacUser) {
  return user.nome?.trim() || user.email;
}

export function RbacManager() {
  const [canManage, setCanManage] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [userEditEmail, setUserEditEmail] = useState('');
  const [userEditPassword, setUserEditPassword] = useState('');
  const [userEditIsActive, setUserEditIsActive] = useState(true);
  const [updatingCredentials, setUpdatingCredentials] = useState(false);
  const [activeView, setActiveView] = useState<'profiles' | 'users'>('profiles');
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showUserEditor, setShowUserEditor] = useState(false);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [profiles, setProfiles] = useState<RbacProfile[]>([]);
  const [users, setUsers] = useState<RbacUser[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | ''>('');
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [profileSearch, setProfileSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserProfileId, setSelectedUserProfileId] = useState<number | ''>('');
  const [profileName, setProfileName] = useState('');
  const [profileCode, setProfileCode] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [profileIsActive, setProfileIsActive] = useState(true);
  const [draftName, setDraftName] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftIsActive, setDraftIsActive] = useState(true);
  const [draftPermissionIds, setDraftPermissionIds] = useState<number[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserProfileId, setNewUserProfileId] = useState<number | ''>('');
  const [availableEmpresas, setAvailableEmpresas] = useState<Array<{ id: number; nome_fantasia: string; logo_url?: string | null }>>([]);
  const [selectedEmpresaIds, setSelectedEmpresaIds] = useState<number[]>([]);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{
    exists: boolean;
    usuario?: { id: number; nome?: string; email: string };
    empresas?: Array<{ id: number; nome_fantasia: string }>;
  } | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  const selectedProfile = useMemo(() => {
    return profiles.find((profile) => profile.id === selectedProfileId) || null;
  }, [profiles, selectedProfileId]);

  const selectedUser = useMemo(() => {
    return users.find((user) => user.id === selectedUserId) || null;
  }, [users, selectedUserId]);

  const loggedInRbacUser = useMemo(() => {
    const currentUserId = useAuthStore.getState().user?.id;
    return users.find((u) => u.id === currentUserId) || null;
  }, [users]);

  const isManager = useMemo(() => {
    const userState = useAuthStore.getState().user;
    if (userState?.is_consultor) return true;
    
    const hasPerm = userPermissions.includes('*') || userPermissions.includes('usuarios:update');
    if (!hasPerm) return false;

    if (loggedInRbacUser) {
      const code = loggedInRbacUser.profile_code?.toUpperCase() || '';
      const name = loggedInRbacUser.profile_name?.toLowerCase() || '';
      return code === 'FULL_ACCESS' || code === 'GERENTE' || name.includes('gerente');
    }
    return false;
  }, [loggedInRbacUser, userPermissions]);

  async function handleUpdateUserCredentials() {
    if (!selectedUser) return;
    if (!userEditEmail.trim()) {
      setFeedback({ type: 'warning', message: 'O e-mail não pode ficar vazio.' });
      return;
    }

    setUpdatingCredentials(true);
    setFeedback(null);
    try {
      const payload: { email: string; password?: string; is_active?: boolean } = {
        email: userEditEmail.trim(),
        is_active: userEditIsActive,
      };
      if (userEditPassword) {
        payload.password = userEditPassword;
      }

      await api.put(`/usuarios/${selectedUser.id}`, payload);
      await loadData();
      setUserEditPassword('');
      setFeedback({ type: 'success', message: 'Credenciais do usuário atualizadas com sucesso.' });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao atualizar credenciais.' });
    } finally {
      setUpdatingCredentials(false);
    }
  }

  const filteredProfiles = useMemo(() => {
    const query = profileSearch.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((profile) => {
      const haystack = `${profile.name} ${profile.code} ${profile.description || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [profiles, profileSearch]);

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => {
      const haystack = `${user.nome || ''} ${user.email} ${user.profile_name || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [users, userSearch]);

  const groupedPermissions = useMemo(() => groupPermissions(permissions), [permissions]);

  const filteredGroupedPermissions = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    if (!query) return groupedPermissions;
    return groupedPermissions
      .map(([module, modulePermissions]) => {
        const filtered = modulePermissions.filter((perm) => {
          const title = getPermissionTitle(perm).toLowerCase();
          const subtitle = getPermissionSubtitle(perm).toLowerCase();
          return title.includes(query) || subtitle.includes(query) || perm.code.toLowerCase().includes(query);
        });
        return [module, filtered] as [string, PermissionItem[]];
      })
      .filter(([_, perms]) => perms.length > 0);
  }, [groupedPermissions, permissionSearch]);

  function openProfileEditor(profileId: number) {
    setSelectedProfileId(profileId);
    setActiveView('profiles');
    setShowProfileEditor(true);
  }

  function closeProfileEditor() {
    setShowProfileEditor(false);
  }

  function openUserEditor(userId: number) {
    setSelectedUserId(userId);
    setActiveView('users');
    setShowUserEditor(true);
  }

  function closeUserEditor() {
    setShowUserEditor(false);
  }

  function openCreateProfile() {
    setProfileName('');
    setProfileCode('');
    setProfileDescription('');
    setProfileIsActive(true);
    setShowCreateProfile(true);
  }

  function closeCreateProfile() {
    setShowCreateProfile(false);
    setProfileName('');
    setProfileCode('');
    setProfileDescription('');
    setProfileIsActive(true);
  }

  async function openCreateUser() {
    setNewUserName('');
    setNewUserEmail('');
    setNewUserProfileId('');
    setEmailStatus(null);
    setShowCreateUser(true);

    try {
      const { data } = await api.get('/usuarios/me/empresas');
      if (Array.isArray(data)) {
        setAvailableEmpresas(data);
        const currentEmpId = useAuthStore.getState().user?.empresa_id;
        if (currentEmpId) {
          setSelectedEmpresaIds([currentEmpId]);
        } else if (data.length > 0) {
          setSelectedEmpresaIds([data[0].id]);
        }
      }
    } catch {
      const currentEmpId = useAuthStore.getState().user?.empresa_id;
      if (currentEmpId) setSelectedEmpresaIds([currentEmpId]);
    }
  }

  function closeCreateUser() {
    setShowCreateUser(false);
    setNewUserName('');
    setNewUserEmail('');
    setNewUserProfileId('');
    setEmailStatus(null);
    setSelectedEmpresaIds([]);
  }

  async function handleVerifyEmail(emailToVerify: string) {
    const clean = emailToVerify.trim().toLowerCase();
    if (!clean || !clean.includes('@') || clean.length < 5) {
      setEmailStatus(null);
      return;
    }

    setCheckingEmail(true);
    try {
      const { data } = await api.get(`/usuarios/verificar-email?email=${encodeURIComponent(clean)}`);
      setEmailStatus(data);
      if (data?.exists && data?.usuario?.nome && !newUserName.trim()) {
        setNewUserName(data.usuario.nome);
      }
    } catch {
      // Silencioso
    } finally {
      setCheckingEmail(false);
    }
  }

  function toggleModuleExpanded(module: string) {
    setExpandedModules((current) => ({
      ...current,
      [module]: !current[module],
    }));
  }

  function toggleAllModulePermissions(modulePermissions: PermissionItem[], allowed: boolean) {
    const ids = modulePermissions.map((p) => p.id);
    setDraftPermissionIds((current) => {
      if (allowed) {
        return [...current, ...ids.filter((id) => !current.includes(id))];
      } else {
        return current.filter((id) => !ids.includes(id));
      }
    });
  }

  useEffect(() => {
    let active = true;

    async function loadAccess() {
      try {
        const { data } = await api.get<CurrentUserResponse>('/usuarios/me');
        const permissionList = data.permissions || [];
        if (!active) return;
        setUserPermissions(permissionList);
        setCanManage(permissionList.includes('*') || permissionList.includes('profiles:manage'));
      } catch {
        if (active) setCanManage(false);
      } finally {
        if (active) setCheckingAccess(false);
      }
    }

    loadAccess();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!canManage || checkingAccess) return;
    void loadData();
  }, [canManage, checkingAccess]);

  useEffect(() => {
    if (!selectedProfile) {
      setDraftName('');
      setDraftCode('');
      setDraftDescription('');
      setDraftIsActive(true);
      setDraftPermissionIds([]);
      return;
    }

    setDraftName(selectedProfile.name);
    setDraftCode(selectedProfile.code);
    setDraftDescription(selectedProfile.description || '');
    setDraftIsActive(selectedProfile.is_active);
    setDraftPermissionIds(selectedProfile.permissions.map((permission) => permission.id));
  }, [selectedProfile]);

  useEffect(() => {
    if (selectedUser) {
      setSelectedUserProfileId(selectedUser.profile_id ?? '');
      setUserEditEmail(selectedUser.email);
      setUserEditPassword('');
      setUserEditIsActive(selectedUser.is_active);
    } else {
      setSelectedUserProfileId('');
      setUserEditEmail('');
      setUserEditPassword('');
      setUserEditIsActive(true);
    }
  }, [selectedUser]);

  async function loadData() {
    try {
      const [permissionsResponse, profilesResponse, usersResponse] = await Promise.all([
        api.get<PermissionItem[]>('/rbac/permissions'),
        api.get<RbacProfile[]>('/rbac/profiles'),
        api.get<RbacUser[]>('/rbac/users'),
      ]);

      setPermissions(sortPermissions(permissionsResponse.data || []));
      setProfiles((profilesResponse.data || []).sort((left, right) => {
        const bySystem = Number(right.is_system) - Number(left.is_system);
        if (bySystem !== 0) return bySystem;
        return left.name.localeCompare(right.name, 'pt-BR');
      }));
      setUsers((usersResponse.data || []).sort((left, right) => {
        const leftName = left.nome || left.email;
        const rightName = right.nome || right.email;
        return leftName.localeCompare(rightName, 'pt-BR');
      }));
      if (!selectedProfileId && (profilesResponse.data || []).length > 0) {
        setSelectedProfileId((profilesResponse.data || [])[0].id);
      }
      if (!selectedUserId && (usersResponse.data || []).length > 0) {
        setSelectedUserId((usersResponse.data || [])[0].id);
      }
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao carregar perfis de acesso.' });
    }
  }

  function togglePermission(permissionId: number) {
    setDraftPermissionIds((current) => (
      current.includes(permissionId)
        ? current.filter((item) => item !== permissionId)
        : [...current, permissionId]
    ));
  }

  async function handleCreateProfile() {
    if (!profileName.trim()) {
      setFeedback({ type: 'warning', message: 'Informe o nome do perfil antes de criar.' });
      return;
    }

    setCreatingProfile(true);
    setFeedback(null);
    try {
      const payload = {
        name: profileName.trim(),
        code: profileCode.trim() || null,
        description: profileDescription.trim() || null,
        is_active: profileIsActive,
      };
      const { data } = await api.post<RbacProfile>('/rbac/profiles', payload);
      setProfiles((current) => [...current, data].sort((left, right) => {
        const bySystem = Number(right.is_system) - Number(left.is_system);
        if (bySystem !== 0) return bySystem;
        return left.name.localeCompare(right.name, 'pt-BR');
      }));
      setSelectedProfileId(data.id);
      setProfileName('');
      setProfileCode('');
      setProfileDescription('');
      setProfileIsActive(true);
      setShowCreateProfile(false);
      setShowProfileEditor(true);
      setFeedback({ type: 'success', message: 'Perfil criado com sucesso.' });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao criar perfil.' });
    } finally {
      setCreatingProfile(false);
    }
  }

  async function handleCreateUser() {
    const cleanEmail = newUserEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFeedback({ type: 'warning', message: 'Informe um e-mail válido para o colaborador.' });
      return;
    }

    const currentEmpId = useAuthStore.getState().user?.empresa_id;
    const finalEmpresas = selectedEmpresaIds.length > 0 ? selectedEmpresaIds : (currentEmpId ? [currentEmpId] : []);
    if (finalEmpresas.length === 0) {
      setFeedback({ type: 'warning', message: 'Selecione ao menos uma empresa para conceder acesso.' });
      return;
    }

    if (!emailStatus?.exists && !newUserName.trim()) {
      setFeedback({ type: 'warning', message: 'Preencha o nome completo do novo usuário.' });
      return;
    }

    setCreatingUser(true);
    setFeedback(null);
    try {
      const payload = {
        nome: newUserName.trim() || (emailStatus?.usuario?.nome || null),
        email: cleanEmail,
        empresa_ids: finalEmpresas,
        profile_id: newUserProfileId ? Number(newUserProfileId) : null,
      };

      const { data } = await api.post('/usuarios/convidar', payload);

      await loadData();
      closeCreateUser();
      setFeedback({ 
        type: 'success', 
        message: data?.message || 'Convite enviado com sucesso! O colaborador receberá as instruções por e-mail.' 
      });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao processar convite.' });
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleSaveProfileAndPermissions() {
    if (!selectedProfile) return;
    if (!selectedProfile.editable && selectedProfile.code !== 'FULL_ACCESS') {
      setFeedback({ type: 'warning', message: 'Esse perfil é de sistema e não pode ser alterado.' });
      return;
    }
    if (!draftName.trim()) {
      setFeedback({ type: 'warning', message: 'O nome do perfil não pode ficar vazio.' });
      return;
    }

    setSavingProfile(true);
    setFeedback(null);
    try {
      const profilePayload = {
        name: draftName.trim(),
        code: draftCode.trim() || null,
        description: draftDescription.trim() || null,
        is_active: draftIsActive,
      };

      const promises = [];
      if (selectedProfile.editable) {
        promises.push(api.patch<RbacProfile>(`/rbac/profiles/${selectedProfile.id}`, profilePayload));
      }
      promises.push(api.put<RbacProfile>(`/rbac/profiles/${selectedProfile.id}/permissions`, {
        permission_ids: draftPermissionIds,
      }));

      await Promise.all(promises);

      await loadData();
      setFeedback({ type: 'success', message: 'Perfil e permissões salvos com sucesso.' });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao salvar perfil.' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAssignProfile(userId: number, profileId: number) {
    setUpdatingUserId(userId);
    setFeedback(null);
    try {
      const { data } = await api.put<RbacUser>(`/rbac/users/${userId}/profile`, { profile_id: profileId });
      setUsers((current) => current.map((user) => (user.id === data.id ? data : user)));
      setFeedback({ type: 'success', message: 'Perfil do usuário atualizado com sucesso.' });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao atualizar perfil do usuário.' });
      if (selectedUser) {
        setSelectedUserProfileId(selectedUser.profile_id ?? '');
      }
    } finally {
      setUpdatingUserId(null);
    }
  }

  if (checkingAccess) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Verificando acesso...
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <Shield className="mx-auto h-10 w-10 text-slate-400" />
        <h2 className="mt-4 text-2xl font-black text-slate-900 dark:text-white">RBAC</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
          Você não tem permissão para administrar perfis de acesso.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setActiveView('profiles')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition ${activeView === 'profiles' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
          >
            <Shield className="h-4 w-4" />
            Perfis
          </button>
          <button
            type="button"
            onClick={() => setActiveView('users')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition ${activeView === 'users' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
          >
            <UserRoundCheck className="h-4 w-4" />
            Usuários
          </button>
        </div>

        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar dados
        </button>
      </div>

      {feedback ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300' : feedback.type === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300' : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'}`}>
          {feedback.message}
        </div>
      ) : null}

      {activeView === 'profiles' ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-500">RBAC</p>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Perfis existentes</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Clique em um cartão para abrir a configuração em tela cheia.</p>
            </div>
            <button
              type="button"
              onClick={openCreateProfile}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-500"
            >
              <Plus className="h-4 w-4" />
              Novo perfil
            </button>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={profileSearch}
              onChange={(event) => setProfileSearch(event.target.value)}
              placeholder="Buscar perfil"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => openProfileEditor(profile.id)}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-md p-5 text-left transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:shadow-lg hover:shadow-cyan-500/10 dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-cyan-700"
              >
                <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-500/5 blur-xl transition-all duration-300 group-hover:scale-150 group-hover:bg-cyan-500/10" />
                
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black text-slate-900 transition-colors group-hover:text-cyan-600 dark:text-white dark:group-hover:text-cyan-400">{profile.name}</p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{profile.description || 'Sem descrição.'}</p>
                  </div>
                  {profile.is_system ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-200/50">Sistema</span>
                  ) : profile.is_active ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 border border-emerald-200/50">Ativo</span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-300/50">Inativo</span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  <span className="rounded-full bg-white px-2.5 py-1 shadow-sm dark:bg-slate-900">{profile.permission_count} permissões</span>
                  <span className="rounded-full bg-white px-2.5 py-1 shadow-sm dark:bg-slate-900">{profile.user_count} usuários</span>
                </div>
              </button>
            ))}

            {!filteredProfiles.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 sm:col-span-2 xl:col-span-3">
                Nenhum perfil encontrado.
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-500">RBAC</p>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Usuários</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Clique em um cartão para abrir o editor de acesso do usuário.</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Buscar usuário"
                  className="w-56 bg-transparent text-sm outline-none"
                />
              </label>
              <button
                type="button"
                onClick={openCreateUser}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-500"
              >
                <Plus className="h-4 w-4" />
                Novo usuário
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredUsers.map((user) => {
              const avatarUrl = toPublicAssetUrl(user.foto_url);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => openUserEditor(user.id)}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-md p-5 text-left transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:shadow-lg hover:shadow-cyan-500/10 dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-cyan-700"
                >
                  <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-500/5 blur-xl transition-all duration-300 group-hover:scale-150 group-hover:bg-cyan-500/10" />

                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-sm font-black text-slate-600 dark:bg-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-slate-700">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={getUserDisplayName(user)} className="h-full w-full object-cover" />
                      ) : (
                        <span>{getInitials(getUserDisplayName(user))}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-black text-slate-900 transition-colors group-hover:text-cyan-600 dark:text-white dark:group-hover:text-cyan-400">{getUserDisplayName(user)}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                      <p className="mt-1 truncate text-sm font-bold text-slate-600 dark:text-slate-300">{user.profile_name || 'Sem perfil'}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    <span className="rounded-full bg-white px-2 py-1 shadow-sm dark:bg-slate-900">{user.is_active ? 'Ativo' : 'Inativo'}</span>
                    {user.is_consultor ? (
                      <span className="rounded-full bg-cyan-100 px-2 py-1 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200 border border-cyan-200/50">Consultor</span>
                    ) : null}
                  </div>
                </button>
              );
            })}

            {!filteredUsers.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 sm:col-span-2 xl:col-span-3">
                Nenhum usuário encontrado para esta empresa.
              </div>
            ) : null}
          </div>
        </section>
      )}

      {showCreateProfile ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-sm">
          <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl animate-slide-in-right dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Novo perfil</p>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Criar perfil de acesso</h3>
              </div>
              <button type="button" onClick={closeCreateProfile} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateProfile();
              }}
              className="flex-1 overflow-y-auto p-6 custom-scrollbar"
            >
              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950">
                  <div className="space-y-3">
                    <input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder="Nome do perfil"
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <input
                      value={profileCode}
                      onChange={(event) => setProfileCode(event.target.value)}
                      placeholder="Código opcional"
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <textarea
                      value={profileDescription}
                      onChange={(event) => setProfileDescription(event.target.value)}
                      placeholder="Descrição"
                      rows={6}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                      <input
                        type="checkbox"
                        checked={profileIsActive}
                        onChange={(event) => setProfileIsActive(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                      />
                      Perfil ativo
                    </label>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={closeCreateProfile}
                    className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={creatingProfile || !profileName.trim()}
                    className="flex-1 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {creatingProfile ? 'Criando...' : 'Criar perfil'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showCreateUser ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-sm">
          <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl animate-slide-in-right dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Acesso e Usuários</p>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Convidar Colaborador</h3>
              </div>
              <button type="button" onClick={closeCreateUser} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateUser();
              }}
              className="flex-1 overflow-y-auto p-6 custom-scrollbar"
            >
              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950 space-y-4">
                  {/* Campo E-mail com verificação em tempo real */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                      E-mail / Login *
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        value={newUserEmail}
                        onChange={(event) => {
                          setNewUserEmail(event.target.value);
                          if (emailStatus) setEmailStatus(null);
                        }}
                        onBlur={(event) => {
                          void handleVerifyEmail(event.target.value);
                        }}
                        placeholder="exemplo@kyrustech.com"
                        required
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 pr-10"
                      />
                      {checkingEmail ? (
                        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-cyan-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : (
                        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                          <Mail className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Avisos e Tratamentos de Usuário Existente vs Novo */}
                  {emailStatus?.exists ? (
                    <div className="rounded-2xl border border-amber-300/80 bg-amber-50/70 p-4 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200 animate-fade-in">
                      <div className="flex items-start gap-3">
                        <Info className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                        <div className="space-y-1">
                          <p className="font-bold text-sm text-amber-950 dark:text-amber-100">
                            Usuário já cadastrado no KyrusERP
                          </p>
                          <p>
                            O colaborador <strong className="font-semibold">{emailStatus.usuario?.nome || emailStatus.usuario?.email}</strong> já possui cadastro no sistema.
                          </p>
                          {emailStatus.empresas && emailStatus.empresas.length > 0 && (
                            <p className="text-[11px] text-amber-800 dark:text-amber-300">
                              Empresas com acesso ativo: {emailStatus.empresas.map((e) => e.nome_fantasia).join(', ')}.
                            </p>
                          )}
                          <p className="mt-1 font-medium text-amber-900 dark:text-amber-200">
                            ✓ A senha atual <strong>será preservada</strong>. O usuário receberá um e-mail notificando a liberação de acesso às empresas selecionadas abaixo.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : emailStatus && !emailStatus.exists ? (
                    <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 text-xs text-cyan-950 dark:border-cyan-800/50 dark:bg-cyan-950/30 dark:text-cyan-200 animate-fade-in">
                      <div className="flex items-start gap-3">
                        <Sparkles className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400 mt-0.5" />
                        <div className="space-y-1">
                          <p className="font-bold text-sm text-cyan-950 dark:text-cyan-100">
                            Novo colaborador
                          </p>
                          <p>
                            Será enviado um convite seguro por e-mail com a identidade visual da KyrusTech. O convidado poderá cadastrar sua própria senha e foto de perfil.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Nome do Colaborador */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                      Nome Completo {!emailStatus?.exists && '*'}
                    </label>
                    <input
                      value={newUserName}
                      onChange={(event) => setNewUserName(event.target.value)}
                      placeholder="Nome completo do colaborador"
                      required={!emailStatus?.exists}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>

                  {/* Perfil de Acesso */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                      Perfil de Acesso *
                    </label>
                    <SearchableSelect
                      value={newUserProfileId ? String(newUserProfileId) : ''}
                      onChange={(val: any) => {
                        setNewUserProfileId(val ? Number(val) : '');
                      }}
                      options={[{
                        label: 'Perfil de acesso',
                        options: [
                          { id: '', label: 'Selecione o perfil de acesso' },
                          ...profiles.map((profile) => ({
                            id: String(profile.id),
                            label: `${profile.name} ${profile.is_system ? '(sistema)' : ''}`
                          }))
                        ]
                      }]}
                    />
                  </div>

                  {/* Seleção de Empresas */}
                  {availableEmpresas.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <Building2 className="h-4 w-4 text-cyan-500" />
                        Empresas com Acesso Concedido *
                      </label>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {availableEmpresas.map((emp) => {
                          const isSelected = selectedEmpresaIds.includes(emp.id);
                          const alreadyHasAccess = emailStatus?.empresas?.some((e) => e.id === emp.id);
                          return (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => {
                                setSelectedEmpresaIds((prev) =>
                                  prev.includes(emp.id)
                                    ? prev.filter((id) => id !== emp.id)
                                    : [...prev, emp.id]
                                );
                              }}
                              className={`flex items-center justify-between rounded-xl border p-3 text-left transition ${
                                isSelected
                                  ? 'border-cyan-500 bg-cyan-50/50 text-cyan-950 dark:border-cyan-500 dark:bg-cyan-950/20 dark:text-cyan-200'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                              }`}
                            >
                              <div className="min-w-0 flex-1 pr-2">
                                <p className="truncate text-xs font-bold">{emp.nome_fantasia}</p>
                                {alreadyHasAccess && (
                                  <span className="inline-block text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    ✓ Já possui acesso
                                  </span>
                                )}
                              </div>
                              <div
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                                  isSelected
                                    ? 'border-cyan-600 bg-cyan-600 text-white'
                                    : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800'
                                }`}
                              >
                                {isSelected && <Check className="h-3.5 w-3.5" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={closeCreateUser}
                    className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={
                      creatingUser ||
                      checkingEmail ||
                      !newUserEmail.trim() ||
                      !newUserProfileId ||
                      selectedEmpresaIds.length === 0 ||
                      (!emailStatus?.exists && !newUserName.trim())
                    }
                    className="flex-1 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {creatingUser ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processando...
                      </>
                    ) : emailStatus?.exists ? (
                      'Conceder Acesso e Notificar'
                    ) : (
                      'Enviar Convite por E-mail'
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showProfileEditor && selectedProfile ? (
        <div 
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm transition-all duration-300"
          onClick={closeProfileEditor}
        >
          <div 
            className="relative flex h-full w-full max-w-5xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl animate-slide-in-right dark:border-slate-800 dark:bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 bg-white px-6 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Editar perfil</p>
                  <div className="mt-1 flex flex-wrap items-center gap-4">
                    <input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      disabled={!selectedProfile.editable}
                      placeholder="Nome do perfil"
                      className="bg-transparent text-xl font-black text-slate-900 outline-none transition focus:border-b focus:border-cyan-400 dark:text-white border-b border-transparent pb-0.5 w-64 max-w-full"
                    />
                    <label className="flex items-center gap-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={draftIsActive}
                        onChange={(event) => setDraftIsActive(event.target.checked)}
                        disabled={!selectedProfile.editable}
                        className="h-4.5 w-4.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 disabled:cursor-not-allowed"
                      />
                      Perfil ativo
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadData}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Atualizar
                  </button>
                  <button type="button" onClick={closeProfileEditor} className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Sub-header row for Code, Description and Count Stats */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">Código:</span>
                  <input
                    value={draftCode}
                    onChange={(event) => setDraftCode(event.target.value)}
                    disabled={!selectedProfile.editable}
                    placeholder="CÓDIGO"
                    className="bg-transparent text-xs font-bold uppercase text-slate-700 dark:text-slate-200 outline-none transition focus:border-b focus:border-cyan-400 border-b border-transparent w-28"
                  />
                </div>
                <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
                <div className="flex items-center gap-1.5 flex-1 min-w-[240px]">
                  <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">Descrição:</span>
                  <input
                    value={draftDescription}
                    onChange={(event) => setDraftDescription(event.target.value)}
                    disabled={!selectedProfile.editable}
                    placeholder="Descrição do perfil..."
                    className="bg-transparent text-xs text-slate-700 dark:text-slate-200 outline-none transition focus:border-b focus:border-cyan-400 border-b border-transparent flex-1"
                  />
                </div>
                <span className="hidden md:inline text-slate-300 dark:text-slate-700">|</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-750">{selectedProfile.permission_count} permissões</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-750">{selectedProfile.user_count} usuários</span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-150 pb-4 dark:border-slate-800">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Permissões</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Marque apenas o que este perfil pode acessar.</p>
                  </div>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                    <Search className="h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={permissionSearch}
                      onChange={(event) => setPermissionSearch(event.target.value)}
                      placeholder="Buscar permissão..."
                      className="w-40 bg-transparent text-xs outline-none"
                    />
                  </label>
                </div>

                <div className="max-h-[calc(100vh-330px)] space-y-4 overflow-y-auto pr-1 custom-scrollbar">
                  {filteredGroupedPermissions.map(([module, modulePermissions]) => {
                    const isExpanded = expandedModules[module] !== false;
                    const allSelected = modulePermissions.every(p => draftPermissionIds.includes(p.id));
                    
                    return (
                      <div key={module} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/30">
                        <button
                          type="button"
                          onClick={() => toggleModuleExpanded(module)}
                          className="flex w-full items-center justify-between gap-3 bg-slate-100/70 px-4 py-3 hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-900"
                        >
                          <div className="flex items-center gap-2.5">
                            {getModuleIcon(module)}
                            <div className="text-left">
                              <h4 className="text-xs font-black uppercase tracking-[0.12em] text-slate-900 dark:text-white">{formatLabel(module)}</h4>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">{modulePermissions.length} permissões</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            {selectedProfile.editable && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleAllModulePermissions(modulePermissions, !allSelected);
                                }}
                                className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.05em] transition-all duration-200 ${allSelected ? 'bg-cyan-150 text-cyan-800 hover:bg-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-200 dark:hover:bg-cyan-900/50' : 'bg-slate-200 text-slate-700 hover:bg-slate-250 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                              >
                                {allSelected ? 'Desmarcar' : 'Marcar tudo'}
                              </button>
                            )}
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3 bg-white dark:bg-slate-950/40 animate-slide-down">
                            {modulePermissions.map((permission) => {
                              const isPermChecked = selectedProfile.code === 'FULL_ACCESS'
                                ? (permission.code === 'PDV_SER_VENDEDOR' ? draftPermissionIds.includes(permission.id) : true)
                                : draftPermissionIds.includes(permission.id);
                              const isPermDisabled = selectedProfile.code === 'FULL_ACCESS'
                                ? (permission.code !== 'PDV_SER_VENDEDOR')
                                : !selectedProfile.editable;
                              return (
                                <label
                                  key={permission.id}
                                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-sm transition-all duration-200 ${isPermChecked ? 'border-cyan-400/70 bg-cyan-500/5 dark:border-cyan-700/70' : 'border-slate-150 bg-slate-50/30 hover:border-slate-300 dark:border-slate-850 dark:bg-slate-900/10 dark:hover:border-slate-800'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isPermChecked}
                                    onChange={() => togglePermission(permission.id)}
                                    disabled={isPermDisabled}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 disabled:cursor-not-allowed"
                                  />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-bold text-slate-900 dark:text-white leading-tight">{getPermissionTitle(permission)}</span>
                                      {permission.is_page_level ? (
                                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200/50">Página</span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-normal">{getPermissionSubtitle(permission)}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {(selectedProfile.editable || selectedProfile.code === 'FULL_ACCESS') && (
                  <div className="flex justify-end pt-2 border-t border-slate-150 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={handleSaveProfileAndPermissions}
                      disabled={savingProfile}
                      className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 shadow-sm shadow-emerald-500/10 hover:shadow-emerald-500/20"
                    >
                      {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {savingProfile ? 'Salvando...' : 'Salvar perfil'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showUserEditor && selectedUser ? (
        <div 
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm transition-all duration-300"
          onClick={closeUserEditor}
        >
          <div 
            className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl animate-slide-in-right dark:border-slate-800 dark:bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Editar usuário</p>
                <h3 className="truncate text-lg font-black text-slate-900 dark:text-white">{getUserDisplayName(selectedUser)}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadData}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  Atualizar
                </button>
                <button type="button" onClick={closeUserEditor} className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <div className="grid gap-6">
                <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[26px] bg-slate-100 text-xl font-black text-slate-600 dark:bg-slate-800 dark:text-slate-200 border border-slate-200/50">
                      {toPublicAssetUrl(selectedUser.foto_url) ? (
                        <img src={toPublicAssetUrl(selectedUser.foto_url) || ''} alt={getUserDisplayName(selectedUser)} className="h-full w-full object-cover" />
                      ) : (
                        <span>{getInitials(getUserDisplayName(selectedUser))}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Resumo</p>
                      <h4 className="mt-1 truncate text-xl font-black text-slate-900 dark:text-white">{getUserDisplayName(selectedUser)}</h4>
                      <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{selectedUser.email}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800 border border-slate-200/50">{selectedUser.is_active ? 'Ativo' : 'Inativo'}</span>
                    {selectedUser.is_consultor ? <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200 border border-cyan-200/50">Consultor</span> : null}
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800 border border-slate-200/50">{selectedUser.profile_name || 'Sem perfil'}</span>
                  </div>
                </div>

                <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Perfil de acesso</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Troque o perfil desse usuário sem sair da tela de cartões.</p>
                  </div>

                  <SearchableSelect
                    value={selectedUserProfileId ? String(selectedUserProfileId) : ''}
                    onChange={(val: any) => {
                      if (!val) return;
                      const profileId = Number(val);
                      setSelectedUserProfileId(profileId);
                      void handleAssignProfile(selectedUser.id, profileId);
                    }}
                    options={[{
                      label: 'Perfil',
                      options: [
                        { id: '', label: 'Selecione um perfil' },
                        ...profiles.map((profile) => ({
                          id: String(profile.id),
                          label: `${profile.name} ${profile.is_system ? '(sistema)' : ''}`
                        }))
                      ]
                    }]}
                  />

                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                    Perfil atual: <span className="font-semibold text-slate-700 dark:text-slate-200">{selectedUser.profile_name || 'Sem perfil'}</span>
                  </div>

                  {updatingUserId === selectedUser.id ? (
                    <div className="flex items-center gap-2 text-sm text-cyan-600 dark:text-cyan-300">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Atualizando perfil do usuário...
                    </div>
                  ) : null}
                </div>

                {isManager && (
                  <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-500">Credenciais</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Atualize o e-mail e a senha de acesso deste usuário.</p>
                    </div>

                    <div className="space-y-3">
                      <label className="block">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">E-mail / Login</span>
                        <input
                          type="email"
                          value={userEditEmail}
                          onChange={(e) => setUserEditEmail(e.target.value)}
                          className="mt-1 w-full rounded-2xl border border-slate-350 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </label>

                      <label className="block">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Nova Senha (opcional)</span>
                        <input
                          type="password"
                          value={userEditPassword}
                          onChange={(e) => setUserEditPassword(e.target.value)}
                          placeholder="Digite para alterar"
                          className="mt-1 w-full rounded-2xl border border-slate-350 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </label>

                      <label className="flex items-center gap-2.5 text-sm font-bold text-slate-650 dark:text-slate-350 cursor-pointer select-none py-1">
                        <input
                          type="checkbox"
                          checked={userEditIsActive}
                          onChange={(e) => setUserEditIsActive(e.target.checked)}
                          className="h-4.5 w-4.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        Usuário Ativo (Permite Login)
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={handleUpdateUserCredentials}
                      disabled={updatingCredentials || !userEditEmail.trim()}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 shadow-sm"
                    >
                      {updatingCredentials ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {updatingCredentials ? 'Salvando...' : 'Salvar Credenciais'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}