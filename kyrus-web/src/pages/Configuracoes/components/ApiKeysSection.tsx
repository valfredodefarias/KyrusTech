import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Key,
  Plus,
  Copy,
  Check,
  RotateCw,
  Trash2,
  Edit2,
  ExternalLink,
  Shield,
  Clock,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';

export interface ApiKeyItem {
  id: number;
  name: string;
  description?: string | null;
  key_prefix: string;
  masked_key: string;
  environment: 'production' | 'test';
  profile_id: number;
  profile_name?: string | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  last_used_ip?: string | null;
  revoked_at?: string | null;
  is_active: boolean;
  created_by_user_id: number;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyProfileOption {
  id: number;
  name: string;
  description?: string | null;
  is_template: boolean;
  permissions_count: number;
}

export const ApiKeysSection: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const canManageApiKeys = Boolean(
    user?.permissions?.includes('*') || user?.permissions?.includes('config.api_keys.manage')
  );

  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [profiles, setProfiles] = useState<ApiKeyProfileOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modais
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKeyItem | null>(null);
  const [confirmRotateKey, setConfirmRotateKey] = useState<ApiKeyItem | null>(null);
  const [confirmRevokeKey, setConfirmRevokeKey] = useState<ApiKeyItem | null>(null);

  // Modal de exibição única da chave (apenas em memória transitória)
  const [plainKeyModal, setPlainKeyModal] = useState<{ key: string; name: string; isRotation?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // Formulário de Criação/Edição
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formProfileId, setFormProfileId] = useState<number | ''>('');
  const [formExpirationDays, setFormExpirationDays] = useState<string>('never');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = async () => {
    if (!canManageApiKeys) return;
    try {
      setLoading(true);
      setError(null);
      const [resKeys, resProfiles] = await Promise.all([
        api.get<ApiKeyItem[]>('/api-keys'),
        api.get<ApiKeyProfileOption[]>('/api-keys/profiles'),
      ]);
      setKeys(resKeys.data || []);
      setProfiles(resProfiles.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar Chaves de API:', err);
      setError(err?.response?.data?.detail || 'Erro ao carregar Chaves de API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [canManageApiKeys]);

  if (!canManageApiKeys) {
    return null;
  }

  const openCreateModal = () => {
    setFormName('');
    setFormDesc('');
    // Seleciona preferencialmente o primeiro perfil template ou o primeiro disponível
    const defaultProfile = profiles.find((p) => p.is_template) || profiles[0];
    setFormProfileId(defaultProfile ? defaultProfile.id : '');
    setFormExpirationDays('never');
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const openEditModal = (keyItem: ApiKeyItem) => {
    setEditingKey(keyItem);
    setFormName(keyItem.name);
    setFormDesc(keyItem.description || '');
    setFormProfileId(keyItem.profile_id);
    setFormExpirationDays('keep');
    setFormError(null);
  };

  const handleSaveCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Informe um nome para a chave');
      return;
    }
    if (!formProfileId) {
      setFormError('Selecione um perfil de permissões RBAC');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);

      let expires_at: string | null = null;
      if (formExpirationDays !== 'never') {
        const days = parseInt(formExpirationDays, 10);
        if (!isNaN(days) && days > 0) {
          const d = new Date();
          d.setDate(d.getDate() + days);
          expires_at = d.toISOString();
        }
      }

      const res = await api.post('/api-keys', {
        name: formName.trim(),
        description: formDesc.trim() || null,
        profile_id: Number(formProfileId),
        expires_at,
      });

      setIsCreateModalOpen(false);
      setPlainKeyModal({
        key: res.data.key,
        name: res.data.name,
        isRotation: false,
      });
      void loadData();
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || 'Falha ao criar chave de API');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;
    if (!formName.trim()) {
      setFormError('Informe um nome para a chave');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);

      const payload: any = {
        name: formName.trim(),
        description: formDesc.trim() || null,
        profile_id: formProfileId ? Number(formProfileId) : undefined,
      };

      if (formExpirationDays === 'never') {
        payload.expires_at = null;
      } else if (formExpirationDays !== 'keep') {
        const days = parseInt(formExpirationDays, 10);
        if (!isNaN(days) && days > 0) {
          const d = new Date();
          d.setDate(d.getDate() + days);
          payload.expires_at = d.toISOString();
        }
      }

      await api.patch(`/api-keys/${editingKey.id}`, payload);
      setEditingKey(null);
      void loadData();
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || 'Falha ao atualizar chave de API');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecuteRotate = async () => {
    if (!confirmRotateKey) return;
    try {
      setSubmitting(true);
      const res = await api.post(`/api-keys/${confirmRotateKey.id}/rotate`);
      const rotatedKeyData = res.data;
      setConfirmRotateKey(null);
      setPlainKeyModal({
        key: rotatedKeyData.key,
        name: rotatedKeyData.name,
        isRotation: true,
      });
      void loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Falha ao rotacionar chave de API');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecuteRevoke = async () => {
    if (!confirmRevokeKey) return;
    try {
      setSubmitting(true);
      await api.delete(`/api-keys/${confirmRevokeKey.id}`);
      setConfirmRevokeKey(null);
      void loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Falha ao revogar chave de API');
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return isoString;
    }
  };

  return (
    <div className="rounded-none border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700/60 pb-5">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-900 dark:text-white">Chaves de API para Integração</h2>
              <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                Oficial
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
              Emita chaves de autenticação de longa duração para conectar automações e plataformas parceiras (n8n, webhooks, ERPs externos).
              Cada chave opera através de uma conta de serviço isolada e segura.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/developers')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm"
          >
            <span>Portal do Dev</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-500 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Chave de API</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {/* Tabela de Chaves */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="text-xs font-medium text-slate-400">Carregando chaves de API...</span>
        </div>
      ) : keys.length === 0 ? (
        <div className="py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8">
          <Key className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Nenhuma chave de API configurada</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            Crie sua primeira chave para integrar o Kyrus ERP com o n8n ou emitir lançamentos e pedidos automaticamente.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-500 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Minha Primeira Chave</span>
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Nome / Chave</th>
                <th className="px-4 py-3">Perfil RBAC</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Último Uso</th>
                <th className="px-4 py-3">Expiração</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {keys.map((k) => {
                const isExpired = k.expires_at ? new Date(k.expires_at) < new Date() : false;
                const isRevoked = Boolean(k.revoked_at || !k.is_active);

                return (
                  <tr key={k.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          {k.name}
                          {k.environment === 'test' ? (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              Teste
                            </span>
                          ) : null}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">
                            {k.masked_key}
                          </code>
                          <button
                            type="button"
                            title="Copiar prefixo identificador"
                            onClick={() => copyToClipboard(k.key_prefix)}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {k.description ? (
                          <span className="text-[11px] text-slate-400 mt-1 line-clamp-1">{k.description}</span>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        <Shield className="w-3 h-3 text-blue-500" />
                        {k.profile_name || `Perfil #${k.profile_id}`}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      {isRevoked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400">
                          <XCircle className="w-3.5 h-3.5" />
                          Revogada
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Expirada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Ativa
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                      {k.last_used_at ? (
                        <div>
                          <div>{formatDate(k.last_used_at)}</div>
                          {k.last_used_ip ? (
                            <span className="text-[10px] text-slate-400 font-mono">IP: {k.last_used_ip}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="italic text-slate-400">Nunca utilizada</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                      {k.expires_at ? (
                        <span className={isExpired ? 'text-rose-500 font-bold' : ''}>
                          {formatDate(k.expires_at)}
                        </span>
                      ) : (
                        <span className="text-slate-400">Sem expiração</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(k)}
                          title="Editar metadados ou perfil"
                          disabled={isRevoked}
                          className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfirmRotateKey(k)}
                          title="Rotacionar chave (gera novo segredo imediatamente)"
                          disabled={isRevoked}
                          className="p-1.5 text-amber-600 hover:text-amber-800 dark:hover:text-amber-400 rounded-md hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-40"
                        >
                          <RotateCw className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfirmRevokeKey(k)}
                          title="Revogar chave definitivamente"
                          disabled={isRevoked}
                          className="p-1.5 text-rose-600 hover:text-rose-800 dark:hover:text-rose-400 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: EXIBIÇÃO ÚNICA DA CHAVE PLANA GERADA */}
      {plainKeyModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {plainKeyModal.isRotation ? 'Chave Rotacionada com Sucesso' : 'Chave de API Criada'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{plainKeyModal.name}</p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                Copie sua chave agora — ela NÃO será exibida novamente!
              </p>
              <p className="text-amber-700 dark:text-amber-400">
                Por motivos de segurança e criptografia irreversível (HMAC com pepper), nós não armazenamos este segredo em texto plano.
                Guarde-a em um gerenciador seguro ou configure imediatamente no n8n.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Sua Chave de API</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={plainKeyModal.key}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-sm font-mono text-slate-900 dark:text-white outline-none select-all"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(plainKeyModal.key)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-3 text-xs font-bold transition shrink-0 shadow-sm ${
                    copied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-blue-600 text-white hover:bg-blue-500'
                  }`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copiada!' : 'Copiar'}</span>
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setPlainKeyModal(null)}
                className="w-full sm:w-auto rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-6 py-2.5 text-xs font-bold hover:bg-slate-800 transition"
              >
                Concluir e Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL: CRIAR OU EDITAR CHAVE */}
      {isCreateModalOpen || editingKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in">
          <form
            onSubmit={isCreateModalOpen ? handleSaveCreate : handleSaveEdit}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {isCreateModalOpen ? 'Nova Chave de API' : `Editar Chave: ${editingKey?.name}`}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingKey(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {formError ? (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 text-xs font-medium text-red-600 dark:text-red-400">
                {formError}
              </div>
            ) : null}

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1 block">
                  Nome da Chave / Integração *
                </span>
                <input
                  type="text"
                  required
                  placeholder="Ex: n8n Produção, Hubspot Webhook, PDV Remoto"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:border-blue-500"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1 block">
                  Descrição (opcional)
                </span>
                <input
                  type="text"
                  placeholder="Ex: Criada para sincronizar lançamentos de vendas do Shopify"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:border-blue-500"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1 block">
                  Perfil de Acesso RBAC *
                </span>
                <select
                  value={formProfileId}
                  onChange={(e) => setFormProfileId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:border-blue-500"
                >
                  <option value="">Selecione um perfil de permissões</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.is_template ? '(Padrão Integração)' : ''} ({p.permissions_count} permissões)
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Por regra de segurança anti-escalada, você só pode conceder permissões que seu próprio usuário já possui.
                </p>
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1 block">
                  Expiração da Chave
                </span>
                <select
                  value={formExpirationDays}
                  onChange={(e) => setFormExpirationDays(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:border-blue-500"
                >
                  {editingKey ? <option value="keep">Manter data de expiração atual</option> : null}
                  <option value="never">Sem expiração (recomendado para automações críticas)</option>
                  <option value="30">30 dias</option>
                  <option value="90">90 dias</option>
                  <option value="180">180 dias</option>
                  <option value="365">1 ano</option>
                </select>
              </label>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingKey(null);
                }}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>{isCreateModalOpen ? 'Gerar Chave de API' : 'Salvar Alterações'}</span>
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* CONFIRMAÇÃO DE ROTAÇÃO */}
      {confirmRotateKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800">
                <RotateCw className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">Rotacionar Chave de API?</h3>
                <p className="text-xs text-slate-500">{confirmRotateKey.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Ao rotacionar, um novo segredo será emitido e a chave antiga será imediatamente invalidada.
              Você precisará atualizar todas as automações e scripts que utilizam o segredo anterior.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRotateKey(null)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteRotate}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-5 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Sim, Rotacionar Chave</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* CONFIRMAÇÃO DE REVOGAÇÃO */}
      {confirmRevokeKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-800">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">Revogar Chave Definitivamente?</h3>
                <p className="text-xs text-slate-500">{confirmRevokeKey.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Esta ação é irreversível. A chave <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">{confirmRevokeKey.masked_key}</code> perderá o acesso a todos os endpoints imediatamente.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRevokeKey(null)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteRevoke}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Sim, Revogar Acesso</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
