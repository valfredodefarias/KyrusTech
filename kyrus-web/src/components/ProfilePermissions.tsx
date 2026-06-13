import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Percent,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Store,
  Tag,
  Trash2,
  UserRoundCheck,
  Users,
  Wallet,
} from 'lucide-react';

import { api } from '../services/api';

interface PermissionItem {
  id: number;
  code: string;
  module: string;
  action: string;
  description?: string | null;
  is_page_level?: boolean;
  is_active?: boolean;
}

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
  permissions: PermissionItem[];
}

interface RbacUserResponse {
  permissions?: string[] | null;
}

type SectionKey = 'VENDAS' | 'DESCONTOS' | 'SANGRIA_E_SUPRIMENTO' | 'CANCELAMENTOS' | 'CAIXA' | 'OUTROS';

type Feedback = {
  type: 'success' | 'error' | 'warning';
  message: string;
};

type SectionMeta = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

type PermissionGroup = {
  key: SectionKey;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions: PermissionItem[];
};

const PDV_PERMISSION_ORDER: Record<string, number> = {
  PDV_VER_TODAS_VENDAS: 10,
  PDV_SER_VENDEDOR: 20,
  PDV_CONCEDER_DESCONTO: 30,
  PDV_REALIZAR_SANGRIA: 40,
  PDV_CANCELAR_VENDA: 50,
};

const SECTION_META: Record<SectionKey, SectionMeta> = {
  VENDAS: {
    title: 'Vendas',
    description: 'Permissões ligadas à operação e visibilidade do faturamento.',
    icon: Store,
  },
  DESCONTOS: {
    title: 'Descontos',
    description: 'Permite alterar preço e conceder abatimentos durante a venda.',
    icon: Percent,
  },
  SANGRIA_E_SUPRIMENTO: {
    title: 'Sangria e Suprimento',
    description: 'Controle do dinheiro que entra e sai do caixa físico.',
    icon: Wallet,
  },
  CANCELAMENTOS: {
    title: 'Cancelamentos',
    description: 'Acesso para estornar ou invalidar operações já lançadas.',
    icon: Trash2,
  },
  CAIXA: {
    title: 'Caixa',
    description: 'Acesso e controle das operações de caixa.',
    icon: Wallet,
  },
  OUTROS: {
    title: 'Outras permissões',
    description: 'Itens complementares do perfil atual.',
    icon: Shield,
  },
};

const ORDERED_SECTIONS: SectionKey[] = ['VENDAS', 'DESCONTOS', 'SANGRIA_E_SUPRIMENTO', 'CANCELAMENTOS', 'CAIXA', 'OUTROS'];

function getProfileDisplayName(profile: RbacProfile) {
  return profile.name?.trim() || 'Perfil sem nome';
}

function formatPermissionLabel(permission: PermissionItem) {
  if (permission.description?.trim()) {
    return permission.description.trim();
  }

  const fallback = permission.code.replace(/^PDV_/, '').replace(/_/g, ' ').toLowerCase();
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

function getPermissionSection(permission: PermissionItem): SectionKey {
  if (permission.code === 'page:caixa:view' || permission.module === 'caixa') {
    return 'CAIXA';
  }
  switch (permission.code) {
    case 'PDV_VER_TODAS_VENDAS':
    case 'PDV_SER_VENDEDOR':
      return 'VENDAS';
    case 'PDV_CONCEDER_DESCONTO':
      return 'DESCONTOS';
    case 'PDV_REALIZAR_SANGRIA':
      return 'SANGRIA_E_SUPRIMENTO';
    case 'PDV_CANCELAR_VENDA':
      return 'CANCELAMENTOS';
    default:
      return 'OUTROS';
  }
}

function getPermissionIcon(permission: PermissionItem) {
  if (permission.code === 'page:caixa:view' || permission.module === 'caixa') {
    return <Wallet className="h-4 w-4" />;
  }
  switch (permission.code) {
    case 'PDV_VER_TODAS_VENDAS':
      return <Users className="h-4 w-4" />;
    case 'PDV_SER_VENDEDOR':
      return <UserRoundCheck className="h-4 w-4" />;
    case 'PDV_CONCEDER_DESCONTO':
      return <Tag className="h-4 w-4" />;
    case 'PDV_REALIZAR_SANGRIA':
      return <Wallet className="h-4 w-4" />;
    case 'PDV_CANCELAR_VENDA':
      return <Trash2 className="h-4 w-4" />;
    default:
      return <Shield className="h-4 w-4" />;
  }
}

function profileSort(left: RbacProfile, right: RbacProfile) {
  const systemCompare = Number(right.is_system) - Number(left.is_system);
  if (systemCompare !== 0) return systemCompare;
  const nameCompare = left.name.localeCompare(right.name, 'pt-BR');
  if (nameCompare !== 0) return nameCompare;
  return left.code.localeCompare(right.code, 'pt-BR');
}

function permissionSort(left: PermissionItem, right: PermissionItem) {
  const leftOrder = PDV_PERMISSION_ORDER[left.code] ?? 1000;
  const rightOrder = PDV_PERMISSION_ORDER[right.code] ?? 1000;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const leftLabel = formatPermissionLabel(left);
  const rightLabel = formatPermissionLabel(right);
  return leftLabel.localeCompare(rightLabel, 'pt-BR');
}

function buildSections(permissions: PermissionItem[]): PermissionGroup[] {
  const buckets: Record<SectionKey, PermissionItem[]> = {
    VENDAS: [],
    DESCONTOS: [],
    SANGRIA_E_SUPRIMENTO: [],
    CANCELAMENTOS: [],
    CAIXA: [],
    OUTROS: [],
  };

  permissions.forEach((permission) => {
    buckets[getPermissionSection(permission)].push(permission);
  });

  return ORDERED_SECTIONS
    .map((key) => ({
      key,
      ...SECTION_META[key],
      permissions: buckets[key].sort(permissionSort),
    }))
    .filter((group) => group.permissions.length > 0);
}

function SwitchToggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (nextValue: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900 ${checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

export function ProfilePermissions() {
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [profiles, setProfiles] = useState<RbacProfile[]>([]);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [draftPermissionIds, setDraftPermissionIds] = useState<number[]>([]);
  const [expandedSections, setExpandedSections] = useState<SectionKey[]>(['VENDAS', 'DESCONTOS', 'CAIXA']);
  const [profileSearch, setProfileSearch] = useState('');

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId) || null, [profiles, selectedProfileId]);
  const groupedSections = useMemo(() => buildSections(permissions), [permissions]);

  const filteredProfiles = useMemo(() => {
    const query = profileSearch.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((profile) => {
      const haystack = `${profile.name} ${profile.code} ${profile.description || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [profileSearch, profiles]);

  useEffect(() => {
    let active = true;

    async function loadAccess() {
      try {
        const { data } = await api.get<RbacUserResponse>('/usuarios/me');
        const permissionList = data.permissions || [];
        if (!active) return;
        setCanManage(permissionList.includes('*') || permissionList.includes('profiles:manage'));
      } catch {
        if (active) setCanManage(false);
      } finally {
        if (active) setCheckingAccess(false);
      }
    }

    void loadAccess();

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
      setDraftPermissionIds([]);
      return;
    }

    setDraftPermissionIds(selectedProfile.permissions.map((permission) => permission.id));
  }, [selectedProfile]);

  useEffect(() => {
    if (!filteredProfiles.length) return;
    if (!selectedProfileId || !filteredProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(filteredProfiles[0].id);
    }
  }, [filteredProfiles, selectedProfileId]);

  async function loadData() {
    setLoading(true);
    setFeedback(null);
    try {
      const [permissionsResponse, profilesResponse] = await Promise.all([
        api.get<PermissionItem[]>('/rbac/permissions'),
        api.get<RbacProfile[]>('/rbac/profiles'),
      ]);

      setPermissions((permissionsResponse.data || []).sort(permissionSort));
      setProfiles((profilesResponse.data || []).sort(profileSort));

      const nextProfiles = (profilesResponse.data || []).sort(profileSort);
      if (!selectedProfileId && nextProfiles.length > 0) {
        setSelectedProfileId(nextProfiles[0].id);
      }
      if (selectedProfileId && !nextProfiles.some((profile) => profile.id === selectedProfileId) && nextProfiles.length > 0) {
        setSelectedProfileId(nextProfiles[0].id);
      }
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao carregar perfis de acesso.' });
    } finally {
      setLoading(false);
    }
  }

  function togglePermission(permissionId: number) {
    setDraftPermissionIds((current) => (
      current.includes(permissionId)
        ? current.filter((item) => item !== permissionId)
        : [...current, permissionId]
    ));
  }

  function toggleSection(sectionKey: SectionKey) {
    setExpandedSections((current) => (
      current.includes(sectionKey)
        ? current.filter((item) => item !== sectionKey)
        : [...current, sectionKey]
    ));
  }

  async function handleSavePermissions() {
    if (!selectedProfile) return;
    if (!selectedProfile.editable) {
      setFeedback({ type: 'warning', message: 'Esse perfil é de sistema e não pode ter permissões alteradas.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const { data } = await api.put<RbacProfile>(`/rbac/profiles/${selectedProfile.id}/permissions`, {
        permission_ids: draftPermissionIds,
      });

      setProfiles((current) => current.map((profile) => (profile.id === data.id ? data : profile)).sort(profileSort));
      setFeedback({ type: 'success', message: 'Permissões atualizadas com sucesso.' });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao atualizar permissões.' });
    } finally {
      setSaving(false);
    }
  }

  function isPermissionEnabled(permissionId: number) {
    return draftPermissionIds.includes(permissionId);
  }

  if (checkingAccess) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Verificando acesso...
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <ShieldAlert className="mx-auto h-11 w-11 text-slate-400" />
        <h2 className="mt-4 text-2xl font-black text-slate-900 dark:text-white">RBAC</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
          Você não tem permissão para administrar perfis de acesso.
        </p>
      </div>
    );
  }

  const selectedAvatar = selectedProfile ? getProfileDisplayName(selectedProfile).charAt(0).toUpperCase() : 'P';

  return (
    <div className="space-y-5 text-slate-800 dark:text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500">RBAC</p>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white">Configuração de perfis de acesso</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Escolha um perfil, abra os blocos e ligue ou desligue permissões com um clique.</p>
        </div>

        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
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

      <div className="grid gap-5 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">Perfis existentes</p>
            <h3 className="mt-1 text-lg font-black text-slate-900 dark:text-white">Administradores, vendedores, caixa</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Selecione um perfil para editar suas permissões em tempo real.</p>
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={profileSearch}
              onChange={(event) => setProfileSearch(event.target.value)}
              placeholder="Buscar perfil"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>

          <div className="space-y-3">
            {filteredProfiles.map((profile) => {
              const selected = profile.id === selectedProfileId;
              const initials = getProfileDisplayName(profile).slice(0, 2).toUpperCase();

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${selected ? 'border-blue-500 bg-blue-50 shadow-sm dark:border-blue-500 dark:bg-blue-950/30' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900'}`}
                >
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${selected ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900 dark:text-white">{profile.name}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{profile.description || 'Sem descrição'}</p>
                      </div>
                      {profile.is_system ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Sistema</span>
                      ) : profile.is_active ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Ativo</span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">Inativo</span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      <span className="rounded-full bg-white px-2 py-1 shadow-sm dark:bg-slate-900">{profile.permission_count} permissões</span>
                      <span className="rounded-full bg-white px-2 py-1 shadow-sm dark:bg-slate-900">{profile.user_count} usuários</span>
                    </div>
                  </div>
                </button>
              );
            })}

            {!filteredProfiles.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Nenhum perfil encontrado.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-5">
          {selectedProfile ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-xl font-black text-white shadow-sm">
                    {selectedAvatar}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">Perfil selecionado</p>
                    <h3 className="truncate text-2xl font-black text-slate-900 dark:text-white">{selectedProfile.name}</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{selectedProfile.description || 'Sem descrição.'}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span className="rounded-full bg-white px-2.5 py-1 shadow-sm dark:bg-slate-900">{selectedProfile.permission_count} permissões</span>
                  <span className="rounded-full bg-white px-2.5 py-1 shadow-sm dark:bg-slate-900">{selectedProfile.user_count} usuários</span>
                  {selectedProfile.is_system ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Sistema</span> : null}
                  {selectedProfile.is_active ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Ativo</span> : <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">Inativo</span>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/40">
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">Permissões</p>
                  <h4 className="mt-1 text-lg font-black text-slate-900 dark:text-white">Blocos de acesso do perfil</h4>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Abra um bloco para ativar ou desativar permissões com switches premium.</p>
                </div>

                <div className="space-y-3 p-4">
                  {groupedSections.map((section) => {
                    const isOpen = expandedSections.includes(section.key);
                    const SectionIcon = section.icon;
                    const sectionChecked = section.permissions.filter((permission) => isPermissionEnabled(permission.id)).length;

                    return (
                      <div key={section.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                        <button
                          type="button"
                          onClick={() => toggleSection(section.key)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              <SectionIcon className="h-5 w-5" />
                            </div>
                            <div>
                              <h5 className="text-sm font-black text-slate-900 dark:text-white">{section.title}</h5>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{section.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {sectionChecked}/{section.permissions.length}
                            </span>
                            {isOpen ? <ChevronDown className="h-5 w-5 text-slate-500" /> : <ChevronRight className="h-5 w-5 text-slate-500" />}
                          </div>
                        </button>

                        {isOpen ? (
                          <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                            <div className="grid gap-3 xl:grid-cols-2">
                              {section.permissions.map((permission) => {
                                const checked = isPermissionEnabled(permission.id);

                                return (
                                  <div
                                    key={permission.id}
                                    className={`flex items-start justify-between gap-4 rounded-2xl border p-4 transition ${checked ? 'border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950'}`}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${checked ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-200'}`}>
                                        {getPermissionIcon(permission)}
                                      </div>
                                      <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="font-semibold text-slate-900 dark:text-white">{formatPermissionLabel(permission)}</p>
                                          {permission.is_page_level ? (
                                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-300">Página</span>
                                          ) : null}
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{permission.code}</p>
                                      </div>
                                    </div>

                                    <SwitchToggle
                                      checked={checked}
                                      disabled={!selectedProfile.editable}
                                      onChange={() => togglePermission(permission.id)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {!groupedSections.length ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      Nenhuma permissão disponível para este perfil.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-2 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setDraftPermissionIds(selectedProfile.permissions.map((permission) => permission.id))}
                  disabled={!selectedProfile.editable || loading || saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-4 w-4" />
                  Recarregar perfil
                </button>

                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={saving || !selectedProfile.editable}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
              Selecione um perfil para visualizar as permissões.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
