import { useEffect, useMemo, useRef, useState } from 'react';
import { BankAvatar } from '../components/BrandAvatar';
import { SearchableSelect } from '../components/SearchableSelect';
import { api, normalizeListResponse, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useBankPresetStore, type BankPreset } from '../store/bankPresetStore';
import { PlanoContasManager } from './Importacao';
import type { ItemSistema } from './Importacao';
import {
  Building2, Search, Users, CheckCircle2, Briefcase, Shield, Loader2,
  Landmark, UserPlus, Pencil, Trash2, ChevronUp, ChevronDown, Plus, Upload,
  KeyRound, X, ArrowRightLeft, Layers, Download, BarChart3, AlertTriangle,
  Lock, Eye, EyeOff, RefreshCw, SlidersHorizontal, Check
} from 'lucide-react';

// --- TIPAGENS ---
interface Empresa {
  id: number;
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  tipo_pessoa?: 'PF' | 'PJ';
  logo_url?: string;
  cor_primaria?: string;
  is_active?: boolean;
}

interface Consultor {
  id: number;
  nome: string;
  email: string;
  consultor_role: string;
  num_empresas_acesso?: number;
}

interface ConsultorEmpresa {
  empresa_id: number;
  empresa_nome: string;
  ativo: boolean;
}

interface NovoUsuario {
  nome: string;
  email: string;
  password: string;
  empresa_id: number;
  is_consultor: boolean;
}

interface UsuarioItem {
  id: number;
  nome?: string | null;
  email: string;
  is_active: boolean;
  is_consultor: boolean;
  consultor_role: string;
  empresa_id?: number | null;
  empresa_nome?: string | null;
}

interface FormEmpresa {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  tipo_pessoa: 'PF' | 'PJ';
  cor_primaria: string;
  logo_url: string;
}

interface BankPresetForm {
  key: string;
  label: string;
  bank_name: string;
  aliases: string;
  logo_url: string;
  sort_order: string;
  is_active: boolean;
}

interface AutoAdjustmentConfig {
  tipo_pessoa: 'PF' | 'PJ';
  juros_multa_template_id: number | null;
  descontos_template_id: number | null;
  juros_multa_categoria_nome: string;
  descontos_categoria_nome: string;
  juros_multa_tipo: string;
  descontos_tipo: string;
  juros_multa_dre_grupo: string;
  descontos_dre_grupo: string;
}

interface AutoAdjustmentEmpresaConfig {
  empresa_id: number;
  tipo_pessoa: 'PF' | 'PJ';
  juros_multa_plano_contas_id: number | null;
  descontos_plano_contas_id: number | null;
  juros_multa_categoria_nome: string;
  descontos_categoria_nome: string;
  juros_multa_tipo: string;
  descontos_tipo: string;
  juros_multa_dre_grupo: string;
  descontos_dre_grupo: string;
}

interface EmpresaPlanoContasOption {
  id: number;
  nome: string;
  tipo: string;
  dre_grupo: string;
  conta_pai_id?: number | null;
}

function getApiErrorDetails(error: any, fallback: string) {
  const detail = error?.response?.data?.detail;
  const message = error?.response?.data?.message;
  const status = error?.response?.status;

  if (Array.isArray(detail)) {
    const parsed = detail
      .map((item) => item?.msg || item?.message || String(item))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (parsed) return parsed;
  }

  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (status === 405) return 'O servidor recusou o método HTTP desta operação.';
  if (status === 403) return 'Você não possui permissão para executar esta ação.';
  if (status) return `${fallback} (HTTP ${status})`;
  return fallback;
}

// --- COMPONENTE AVATAR DA EMPRESA ---
const AvatarEmpresa = ({ nome, src, cor }: { nome: string, src?: string, cor: string }) => {
  const [error, setError] = useState(false);
  const iniciais = (nome || 'EP').substring(0, 2).toUpperCase();
  const fullSrc = toPublicAssetUrl(src) || undefined;

  if (!src || error) {
    return (
      <div 
        className="w-13 h-13 rounded-2xl shrink-0 flex items-center justify-center font-black text-base shadow-sm text-white transition transform hover:scale-105"
        style={{ backgroundColor: cor }}
      >
        {iniciais}
      </div>
    );
  }

  return (
    <div className="w-13 h-13 rounded-2xl shrink-0 bg-white flex items-center justify-center border border-slate-200 overflow-hidden shadow-sm dark:border-slate-700">
      <img 
        src={fullSrc} 
        alt={nome} 
        className="w-full h-full object-contain p-1.5" 
        onError={() => setError(true)}
      />
    </div>
  );
};

type CategoryOption = {
  id: number;
  label: string;
  searchText: string;
};

const SearchableCategorySelect = ({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  options: CategoryOption[];
  onChange: (value: number | null) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = options.find((item) => item.id === value) || null;
  const filtered = options.filter((item) => {
    if (!query.trim()) return true;
    const normalized = query.trim().toLowerCase();
    return item.searchText.includes(normalized) || item.label.toLowerCase().includes(normalized);
  });

  return (
    <div className="space-y-1.5" ref={wrapperRef}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">{label}</p>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 shadow-xs"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900 z-30 relative">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar categoria..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <span>{placeholder}</span>
              {value === null ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
            </button>
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChange(item.id);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="truncate">{item.label}</span>
                {value === item.id ? <CheckCircle2 className="h-4 w-4 text-blue-500" /> : null}
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">Nenhuma categoria encontrada.</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export function Consultor() {
  const setBankPresetStore = useBankPresetStore((state) => state.setPresets);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [consultores, setConsultores] = useState<Consultor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [empresaStatusFilter, setEmpresaStatusFilter] = useState<'todas' | 'ativas' | 'inativas'>('todas');
  const [isSuperConsultor, setIsSuperConsultor] = useState(false);

  // Modais
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [showEmpresaModal, setShowEmpresaModal] = useState(false);
  const [showTrocaModal, setShowTrocaModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [targetEmpresa, setTargetEmpresa] = useState<Empresa | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<'empresas' | 'consultores' | 'planos-padrao' | 'bancos' | 'usuarios'>('empresas');

  // Super-Consultor Management
  const [selectedConsultor, setSelectedConsultor] = useState<Consultor | null>(null);
  const [consultorEmpresas, setConsultorEmpresas] = useState<ConsultorEmpresa[]>([]);
  const [loadingConsultorEmpresas, setLoadingConsultorEmpresas] = useState(false);
  const [expandedConsultorId, setExpandedConsultorId] = useState<number | null>(null);
  const [selectedCompanyToAdd, setSelectedCompanyToAdd] = useState<number | null>(null);

  // Usuários
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);
  const [usuarioSearchTerm, setUsuarioSearchTerm] = useState('');
  const [usuarioStatusFilter, setUsuarioStatusFilter] = useState<'todos' | 'ativos' | 'inativos'>('todos');
  const [usuarioRoleFilter, setUsuarioRoleFilter] = useState<'todos' | 'consultores' | 'clientes'>('todos');
  const [editingUser, setEditingUser] = useState<UsuarioItem | null>(null);
  const [editUserForm, setEditUserForm] = useState({
    nome: '',
    email: '',
    empresa_id: 0,
    is_consultor: false,
    consultor_role: 'USUARIO_NORMAL',
    is_active: true,
    nova_senha: '',
  });
  const [savingUser, setSavingUser] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);

  const storeUser = useAuthStore((state) => state.user);
  const currentUser = storeUser;

  // Formulários Empresa
  const [newUser, setNewUser] = useState<NovoUsuario>({
    nome: '', email: '', password: '', empresa_id: 0, is_consultor: false
  });
  
  const [formEmpresa, setFormEmpresa] = useState<FormEmpresa>({
    nome_fantasia: '', razao_social: '', cnpj: '', tipo_pessoa: 'PJ', cor_primaria: '#2563eb', logo_url: ''
  });
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Planos Padrão (Templates)
  const [templateTipoPessoa, setTemplateTipoPessoa] = useState<'PF' | 'PJ'>('PJ');
  const [templateCategorias, setTemplateCategorias] = useState<ItemSistema[]>([]);
  const [loadingTemplateCategorias, setLoadingTemplateCategorias] = useState(false);
  const [templateCategoriasError, setTemplateCategoriasError] = useState<string | null>(null);
  const [autoAdjustConfig, setAutoAdjustConfig] = useState<AutoAdjustmentConfig | null>(null);
  const [loadingAutoAdjustConfig, setLoadingAutoAdjustConfig] = useState(false);
  const [savingAutoAdjustConfig, setSavingAutoAdjustConfig] = useState(false);
  const [selectedEmpresaAutoAdjustId, setSelectedEmpresaAutoAdjustId] = useState<number | null>(null);
  const [empresaAutoAdjustConfig, setEmpresaAutoAdjustConfig] = useState<AutoAdjustmentEmpresaConfig | null>(null);
  const [empresaPlanoOptions, setEmpresaPlanoOptions] = useState<EmpresaPlanoContasOption[]>([]);
  const [loadingEmpresaAutoAdjust, setLoadingEmpresaAutoAdjust] = useState(false);
  const [savingEmpresaAutoAdjust, setSavingEmpresaAutoAdjust] = useState(false);

  // Sincronização e Utilitários de Template
  const [syncTargetEmpresaId, setSyncTargetEmpresaId] = useState<number | null>(null);
  const [syncingTemplate, setSyncingTemplate] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // Bancos Globais
  const [bankPresets, setBankPresets] = useState<BankPreset[]>([]);
  const [loadingBankPresets, setLoadingBankPresets] = useState(false);
  const [savingBankPreset, setSavingBankPreset] = useState(false);
  const [editingBankPresetKey, setEditingBankPresetKey] = useState<string | null>(null);
  const [bancosSearchTerm, setBancosSearchTerm] = useState('');
  const [bankPresetForm, setBankPresetForm] = useState<BankPresetForm>({
    key: '',
    label: '',
    bank_name: '',
    aliases: '',
    logo_url: '',
    sort_order: '0',
    is_active: true,
  });

  // Efeitos de Carga Inicial
  useEffect(() => {
    carregarEmpresas();
    if (currentUser) {
      const isSuper = currentUser.consultor_role === 'SUPER_CONSULTOR';
      setIsSuperConsultor(isSuper);
      if (isSuper) {
        carregarConsultores();
        carregarUsuarios();
      }
    }
  }, [currentUser]);

  // Efeito Reativo ao Mudar de Aba ou Tipo de Template
  useEffect(() => {
    if (activeTab === 'planos-padrao' && isSuperConsultor) {
      carregarTemplatePlanoContas(templateTipoPessoa);
      carregarAutoAdjustmentConfig(templateTipoPessoa);
    } else if (activeTab === 'bancos' && isSuperConsultor) {
      carregarBankPresets();
    } else if (activeTab === 'usuarios' && isSuperConsultor) {
      carregarUsuarios();
    } else if (activeTab === 'consultores' && isSuperConsultor) {
      carregarConsultores();
    }
  }, [activeTab, templateTipoPessoa, isSuperConsultor]);

  // Efeito Reativo ao Selecionar Empresa para Ajuste Automático
  useEffect(() => {
    if (selectedEmpresaAutoAdjustId) {
      carregarAutoAdjustmentEmpresaConfig(selectedEmpresaAutoAdjustId);
      carregarPlanoContasEmpresaOpcoes(selectedEmpresaAutoAdjustId);
    } else {
      setEmpresaAutoAdjustConfig(null);
      setEmpresaPlanoOptions([]);
    }
  }, [selectedEmpresaAutoAdjustId]);

  async function carregarConsultores() {
    try {
      const res = await api.get('/consultor/super/consultores');
      const formatted = normalizeListResponse<Consultor>(res.data).map((c) => ({
        id: c.id,
        nome: c.nome || c.email,
        email: c.email,
        consultor_role: c.consultor_role,
        num_empresas_acesso: (c as any).num_empresas_acesso ?? 0
      }));
      setConsultores(formatted);
    } catch (error) {
      console.error("Erro ao listar consultores", error);
    }
  }

  async function carregarEmpresas() {
    try {
      const res = await api.get('/consultor/empresas'); 
      setEmpresas(normalizeListResponse<Empresa>(res.data));
    } catch (error) {
      console.error("Erro ao listar empresas", error);
    } finally {
      setLoading(false);
    }
  }

  async function carregarUsuarios() {
    try {
      setLoadingUsuarios(true);
      const res = await api.get('/consultor/super/usuarios');
      setUsuarios(normalizeListResponse<UsuarioItem>(res.data));
    } catch (error) {
      console.error("Erro ao listar usuários", error);
    } finally {
      setLoadingUsuarios(false);
    }
  }

  async function carregarTemplatePlanoContas(tipoPessoa: 'PF' | 'PJ') {
    try {
      setLoadingTemplateCategorias(true);
      setTemplateCategoriasError(null);
      const res = await api.get(`/consultor/super/plano-contas-templates/${tipoPessoa}`);
      setTemplateCategorias(normalizeListResponse<ItemSistema>(res.data));
    } catch (error) {
      const message = getApiErrorDetails(error, `Não foi possível carregar o template ${tipoPessoa}.`);
      setTemplateCategoriasError(message);
      setTemplateCategorias([]);
    } finally {
      setLoadingTemplateCategorias(false);
    }
  }

  async function carregarAutoAdjustmentConfig(tipoPessoa: 'PF' | 'PJ') {
    try {
      setLoadingAutoAdjustConfig(true);
      const res = await api.get<AutoAdjustmentConfig>(`/consultor/super/auto-adjustment-config/${tipoPessoa}`);
      setAutoAdjustConfig(res.data);
    } catch (error) {
      console.error(`[CONSULTOR][AUTO-AJUSTE] Falha ao carregar config ${tipoPessoa}`, error);
      setAutoAdjustConfig(null);
    } finally {
      setLoadingAutoAdjustConfig(false);
    }
  }

  async function salvarAutoAdjustmentConfig() {
    if (!autoAdjustConfig) return;
    try {
      setSavingAutoAdjustConfig(true);
      const payload = {
        juros_multa_template_id: autoAdjustConfig.juros_multa_template_id,
        descontos_template_id: autoAdjustConfig.descontos_template_id,
      };
      const res = await api.put<AutoAdjustmentConfig>(`/consultor/super/auto-adjustment-config/${templateTipoPessoa}`, payload);
      setAutoAdjustConfig(res.data);
      alert('Configuração global de ajuste automático salva com sucesso.');
    } catch (error) {
      alert(getApiErrorDetails(error, 'Não foi possível salvar a configuração de ajuste automático.'));
    } finally {
      setSavingAutoAdjustConfig(false);
    }
  }

  async function carregarAutoAdjustmentEmpresaConfig(empresaId: number) {
    try {
      setLoadingEmpresaAutoAdjust(true);
      const res = await api.get<AutoAdjustmentEmpresaConfig>(`/consultor/super/empresas/${empresaId}/auto-adjustment-config`);
      setEmpresaAutoAdjustConfig(res.data);
    } catch (error) {
      setEmpresaAutoAdjustConfig(null);
    } finally {
      setLoadingEmpresaAutoAdjust(false);
    }
  }

  async function carregarPlanoContasEmpresaOpcoes(empresaId: number) {
    try {
      const res = await api.get<EmpresaPlanoContasOption[]>(`/consultor/super/empresas/${empresaId}/plano-contas-opcoes`);
      setEmpresaPlanoOptions(normalizeListResponse<EmpresaPlanoContasOption>(res.data));
    } catch (error) {
      setEmpresaPlanoOptions([]);
    }
  }

  async function salvarAutoAdjustmentEmpresaConfig() {
    if (!selectedEmpresaAutoAdjustId || !empresaAutoAdjustConfig) return;
    try {
      setSavingEmpresaAutoAdjust(true);
      const payload = {
        juros_multa_plano_contas_id: empresaAutoAdjustConfig.juros_multa_plano_contas_id,
        descontos_plano_contas_id: empresaAutoAdjustConfig.descontos_plano_contas_id,
      };
      const res = await api.put<AutoAdjustmentEmpresaConfig>(
        `/consultor/super/empresas/${selectedEmpresaAutoAdjustId}/auto-adjustment-config`,
        payload,
      );
      setEmpresaAutoAdjustConfig(res.data);
      alert('Configuração por empresa salva com sucesso.');
    } catch (error) {
      alert(getApiErrorDetails(error, 'Não foi possível salvar a configuração por empresa.'));
    } finally {
      setSavingEmpresaAutoAdjust(false);
    }
  }

  // Exportar Template em JSON
  async function exportarTemplateJSON() {
    try {
      const res = await api.get(`/consultor/super/plano-contas-templates/${templateTipoPessoa}/exportar`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plano_contas_padrao_${templateTipoPessoa}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao exportar template de plano de contas."));
    }
  }

  // Importar Template de Arquivo JSON
  async function handleImportTemplateFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed.items;
      if (!items || !Array.isArray(items)) {
        alert("Arquivo JSON inválido. O arquivo deve conter uma lista de categorias.");
        return;
      }
      if (!window.confirm(`ATENÇÃO: Deseja importar ${items.length} categorias para o template ${templateTipoPessoa}? A estrutura atual deste template será substituída.`)) {
        return;
      }
      await api.post(`/consultor/super/plano-contas-templates/${templateTipoPessoa}/importar`, { items });
      alert("Template importado com sucesso!");
      carregarTemplatePlanoContas(templateTipoPessoa);
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao importar template. Verifique o formato do arquivo JSON."));
    } finally {
      e.target.value = '';
    }
  }

  // Sincronizar Template com Empresa
  async function handleSincronizarTemplate() {
    if (!syncTargetEmpresaId) return;
    try {
      setSyncingTemplate(true);
      const res = await api.post(`/consultor/super/empresas/${syncTargetEmpresaId}/sincronizar-template`, {
        tipo_pessoa: templateTipoPessoa
      });
      alert(res.data.message || "Template sincronizado com sucesso!");
      setShowSyncModal(false);
      setSyncTargetEmpresaId(null);
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao sincronizar template com a empresa."));
    } finally {
      setSyncingTemplate(false);
    }
  }

  function resetBankPresetForm() {
    setEditingBankPresetKey(null);
    setBankPresetForm({
      key: '',
      label: '',
      bank_name: '',
      aliases: '',
      logo_url: '',
      sort_order: '0',
      is_active: true,
    });
  }

  async function carregarBankPresets() {
    try {
      setLoadingBankPresets(true);
      const res = await api.get<BankPreset[]>('/bank-presets/', { params: { include_inactive: true } });
      const presets = normalizeListResponse<BankPreset>(res.data);
      setBankPresets(presets);
      setBankPresetStore(presets.filter((item) => item.is_active));
    } catch (error) {
      console.error('Erro ao listar presets de banco', error);
    } finally {
      setLoadingBankPresets(false);
    }
  }

  function startEditBankPreset(item: BankPreset) {
    setEditingBankPresetKey(item.key);
    setBankPresetForm({
      key: item.key,
      label: item.label,
      bank_name: item.bank_name,
      aliases: (item.aliases || []).join(', '),
      logo_url: item.logo_url || '',
      sort_order: String(item.sort_order ?? 0),
      is_active: item.is_active,
    });
  }

  async function handleBankPresetLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/anexos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setBankPresetForm((prev) => ({ ...prev, logo_url: res.data.url || '' }));
    } catch (error) {
      console.error('Erro upload logo banco', error);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleSubmitBankPreset(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSavingBankPreset(true);
      const payload = {
        ...(editingBankPresetKey ? {} : { key: bankPresetForm.key || undefined }),
        label: bankPresetForm.label,
        bank_name: bankPresetForm.bank_name,
        aliases: bankPresetForm.aliases.split(',').map((item) => item.trim()).filter(Boolean),
        logo_url: bankPresetForm.logo_url || null,
        sort_order: Number(bankPresetForm.sort_order || 0),
        is_active: bankPresetForm.is_active,
      };

      if (editingBankPresetKey) {
        await api.patch(`/bank-presets/${editingBankPresetKey}`, payload);
      } else {
        await api.post('/bank-presets/', payload);
      }

      await carregarBankPresets();
      resetBankPresetForm();
    } catch (error) {
      alert(getApiErrorDetails(error, 'Não foi possível salvar o preset do banco.'));
    } finally {
      setSavingBankPreset(false);
    }
  }

  async function handleDeleteBankPreset(presetKey: string) {
    if (!window.confirm('Confirmação de Segurança: Deseja realmente excluir este banco global do sistema?')) return;
    try {
      await api.delete(`/bank-presets/${presetKey}`);
      await carregarBankPresets();
      if (editingBankPresetKey === presetKey) {
        resetBankPresetForm();
      }
    } catch (error) {
      alert(getApiErrorDetails(error, 'Não foi possível remover o preset do banco.'));
    }
  }

  async function desativarEmpresa(empresaId: number) {
    try {
      await api.post(`/consultor/super/empresas/${empresaId}/desativar`);
      carregarEmpresas();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao desativar empresa"));
    }
  }

  async function ativarEmpresa(empresaId: number) {
    try {
      await api.post(`/consultor/super/empresas/${empresaId}/ativar`);
      carregarEmpresas();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao ativar empresa"));
    }
  }

  async function deletarEmpresa(empresaId: number) {
    try {
      await api.delete(`/consultor/super/empresas/${empresaId}`);
      carregarEmpresas();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao deletar empresa"));
    }
  }

  async function desativarUsuario(userId: number) {
    try {
      await api.post(`/consultor/super/usuarios/${userId}/desativar`);
      carregarUsuarios();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao desativar usuário"));
    }
  }

  async function ativarUsuario(userId: number) {
    try {
      await api.post(`/consultor/super/usuarios/${userId}/ativar`);
      carregarUsuarios();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao ativar usuário"));
    }
  }

  async function deletarUsuario(userId: number) {
    try {
      await api.delete(`/consultor/super/usuarios/${userId}`);
      carregarUsuarios();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao deletar usuário"));
    }
  }

  // --- ABRIR MODAL (CRIAR OU EDITAR EMPRESA) ---
  function handleOpenEdit(emp: Empresa) {
    setIsEditing(true);
    setEditingId(emp.id);
    setFormEmpresa({
      nome_fantasia: emp.nome_fantasia,
      razao_social: emp.razao_social || '',
      cnpj: emp.cnpj || '',
      tipo_pessoa: (emp as any).tipo_pessoa || 'PJ',
      cor_primaria: emp.cor_primaria || '#2563eb',
      logo_url: emp.logo_url || ''
    });

    if (emp.logo_url) {
      setPreviewUrl(toPublicAssetUrl(emp.logo_url));
    } else {
      setPreviewUrl(null);
    }
    setShowEmpresaModal(true);
  }

  function handleOpenCreate() {
    setIsEditing(false);
    setEditingId(null);
    setFormEmpresa({ nome_fantasia: '', razao_social: '', cnpj: '', tipo_pessoa: 'PJ', cor_primaria: '#2563eb', logo_url: '' });
    setPreviewUrl(null);
    setShowEmpresaModal(true);
  }

  // --- ABRIR MODAL (EDITAR USUÁRIO) ---
  function handleOpenEditUser(u: UsuarioItem) {
    setEditingUser(u);
    setEditUserForm({
      nome: u.nome || '',
      email: u.email,
      empresa_id: u.empresa_id || 0,
      is_consultor: u.is_consultor,
      consultor_role: u.consultor_role || 'USUARIO_NORMAL',
      is_active: u.is_active,
      nova_senha: '',
    });
    setShowPasswordInput(false);
    setShowEditUserModal(true);
  }

  async function handleSaveEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    try {
      setSavingUser(true);
      const payload: any = {
        nome: editUserForm.nome.trim(),
        email: editUserForm.email.trim(),
        empresa_id: editUserForm.is_consultor ? null : (editUserForm.empresa_id || null),
        is_consultor: editUserForm.is_consultor,
        consultor_role: editUserForm.is_consultor 
          ? (editUserForm.consultor_role === 'SUPER_CONSULTOR' ? 'SUPER_CONSULTOR' : 'CONSULTOR') 
          : 'USUARIO_NORMAL',
        is_active: editUserForm.is_active,
      };

      if (editUserForm.nova_senha && editUserForm.nova_senha.trim()) {
        payload.password = editUserForm.nova_senha.trim();
      }

      await api.put(`/usuarios/${editingUser.id}`, payload);
      setShowEditUserModal(false);
      carregarUsuarios();
      if (isSuperConsultor) carregarConsultores();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao salvar alterações do usuário."));
    } finally {
      setSavingUser(false);
    }
  }

  // --- UPLOAD LOGO ---
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/anexos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const serverUrl = res.data.url;
      setFormEmpresa({ ...formEmpresa, logo_url: serverUrl });
      setPreviewUrl(toPublicAssetUrl(serverUrl));
    } catch (error) {
      console.error("Erro upload", error);
    } finally {
      setUploading(false);
    }
  };

  // --- SUBMIT EMPRESA ---
  async function handleSubmitEmpresa(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isEditing && editingId) {
        await api.patch(`/empresas/${editingId}`, formEmpresa);
      } else {
        await api.post('/empresas/', formEmpresa);
      }
      setShowEmpresaModal(false);
      carregarEmpresas();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao salvar empresa"));
    }
  }

  // --- SUBMIT NOVO USUÁRIO ---
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        ...newUser,
        empresa_id: isSuperConsultor
          ? (newUser.is_consultor ? null : (newUser.empresa_id || null))
          : (currentUser?.empresa_id || null),
        is_consultor: isSuperConsultor ? newUser.is_consultor : false,
        consultor_role: isSuperConsultor && newUser.is_consultor ? 'CONSULTOR' : 'USUARIO_NORMAL',
      };
      await api.post('/usuarios/', payload);
      setShowUserModal(false);
      setNewUser({ nome: '', email: '', password: '', empresa_id: 0, is_consultor: false });
      if (isSuperConsultor) {
        carregarConsultores();
        carregarUsuarios();
      }
    } catch (error) {
      alert(getApiErrorDetails(error, 'Erro ao criar usuário'));
    }
  }

  async function toggleConsultorAccordion(consultor: Consultor) {
    if (expandedConsultorId === consultor.id) {
      setExpandedConsultorId(null);
      setSelectedConsultor(null);
      return;
    }

    setSelectedConsultor(consultor);
    setLoadingConsultorEmpresas(true);
    setExpandedConsultorId(consultor.id);
    setSelectedCompanyToAdd(null);
    
    try {
      const res = await api.get(`/consultor/super/consultores/${consultor.id}/empresas`);
      const formatted = normalizeListResponse<any>(res.data).map((ce) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
    } catch (error) {
      console.error("Erro ao listar empresas do consultor", error);
    } finally {
      setLoadingConsultorEmpresas(false);
    }
  }

  async function adicionarEmpresaAoConsultor(consultorId: number, empresaId: number) {
    try {
      await api.post(`/consultor/super/consultores/${consultorId}/empresas/${empresaId}/adicionar`);
      const res = await api.get(`/consultor/super/consultores/${consultorId}/empresas`);
      const formatted = normalizeListResponse<any>(res.data).map((ce) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
      setSelectedCompanyToAdd(null);
      carregarConsultores();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao vincular empresa ao consultor"));
    }
  }

  async function removerEmpresaDoConsultor(consultorId: number, empresaId: number) {
    if (!window.confirm("Deseja revogar o acesso deste consultor a esta empresa?")) return;
    try {
      await api.post(`/consultor/super/consultores/${consultorId}/empresas/${empresaId}/revogar`);
      const res = await api.get(`/consultor/super/consultores/${consultorId}/empresas`);
      const formatted = normalizeListResponse<any>(res.data).map((ce) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
      carregarConsultores();
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao remover acesso da empresa"));
    }
  }

  async function mudarRoleConsultor(consultorId: number) {
    const consultor = consultores.find(c => c.id === consultorId);
    if (!consultor) return;
    
    const novoRole = consultor.consultor_role === 'SUPER_CONSULTOR' ? 'CONSULTOR' : 'SUPER_CONSULTOR';
    const labelAcao = novoRole === 'SUPER_CONSULTOR' ? 'promover a Super Consultor' : 'rebaixar a Consultor';

    if (!window.confirm(`Confirmação: Deseja realmente ${labelAcao} o usuário ${consultor.nome}?`)) return;

    try {
      await api.post(`/consultor/super/consultores/${consultorId}/role`, { role: novoRole });
      carregarConsultores();
      if (selectedConsultor?.id === consultorId) {
        setSelectedConsultor({ ...consultor, consultor_role: novoRole });
      }
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao alterar papel do consultor"));
    }
  }

  async function confirmarTroca() {
    if (!targetEmpresa) return;
    try {
      await api.post('/consultor/trocar-empresa', { empresa_id: targetEmpresa.id });
      window.location.href = '/home'; 
    } catch (error) {
      alert(getApiErrorDetails(error, "Erro ao trocar empresa"));
      setShowTrocaModal(false);
    }
  }

  function solicitarTroca(emp: Empresa) {
    setTargetEmpresa(emp);
    setShowTrocaModal(true);
  }

  // Filtragem de Empresas
  const empresasFiltradas = useMemo(() => {
    return empresas.filter(emp => {
      const matchSearch = emp.nome_fantasia.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.razao_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.cnpj?.includes(searchTerm);
      if (!matchSearch) return false;

      const isActive = emp.is_active !== false;
      if (empresaStatusFilter === 'ativas') return isActive;
      if (empresaStatusFilter === 'inativas') return !isActive;
      return true;
    });
  }, [empresas, searchTerm, empresaStatusFilter]);

  // Filtragem de Usuários
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter(u => {
      const nome = (u.nome || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const query = usuarioSearchTerm.toLowerCase();
      const matchSearch = nome.includes(query) || email.includes(query);
      if (!matchSearch) return false;

      if (usuarioStatusFilter === 'ativos' && !u.is_active) return false;
      if (usuarioStatusFilter === 'inativos' && u.is_active) return false;

      if (usuarioRoleFilter === 'consultores' && !u.is_consultor) return false;
      if (usuarioRoleFilter === 'clientes' && u.is_consultor) return false;

      return true;
    });
  }, [usuarios, usuarioSearchTerm, usuarioStatusFilter, usuarioRoleFilter]);

  // Filtragem de Bancos
  const bancosFiltrados = useMemo(() => {
    return bankPresets.filter(b => {
      if (!bancosSearchTerm.trim()) return true;
      const q = bancosSearchTerm.toLowerCase();
      return b.label.toLowerCase().includes(q) ||
        b.bank_name.toLowerCase().includes(q) ||
        (b.aliases || []).some(a => a.toLowerCase().includes(q));
    });
  }, [bankPresets, bancosSearchTerm]);

  // Estatísticas de Cobertura do Template
  const templateStats = useMemo(() => {
    let total = 0;
    let analiticas = 0;
    let sinteticas = 0;
    let operacionais = 0;
    const dreCount: Record<string, number> = {};

    const countRecursive = (items: ItemSistema[]) => {
      for (const item of items || []) {
        total++;
        if (item.permite_lancamentos) analiticas++;
        else sinteticas++;
        if (item.eh_operacional) operacionais++;
        const dre = item.dre_grupo || 'DESPESAS_OPERACIONAIS';
        dreCount[dre] = (dreCount[dre] || 0) + 1;
        if (item.children?.length) {
          countRecursive(item.children);
        }
      }
    };
    countRecursive(templateCategorias);
    return { total, analiticas, sinteticas, operacionais, dreCount };
  }, [templateCategorias]);

  const templateCategoriaOptions = useMemo(() => {
    const walk = (items: ItemSistema[], depth: number, trail: string): CategoryOption[] => {
      const out: CategoryOption[] = [];
      for (const item of items || []) {
        const currentTrail = trail ? `${trail} ${item.nome}` : item.nome;
        out.push({
          id: Number(item.id),
          label: `${'  '.repeat(depth)}${item.nome}`,
          searchText: currentTrail.toLowerCase(),
        });
        if (item.children?.length) {
          out.push(...walk(item.children, depth + 1, currentTrail));
        }
      }
      return out;
    };
    return walk(templateCategorias || [], 0, '');
  }, [templateCategorias]);

  const empresaCategoriaOptions = useMemo(() => {
    return (empresaPlanoOptions || []).map((item) => ({
      id: Number(item.id),
      label: String(item.nome || ''),
      searchText: `${String(item.nome || '').toLowerCase()} ${String(item.tipo || '').toLowerCase()} ${String(item.dre_grupo || '').toLowerCase()}`,
    }));
  }, [empresaPlanoOptions]);

  // Empresas ainda não vinculadas ao consultor expandido
  const empresasNaoVinculadas = useMemo(() => {
    const idsVinculados = new Set(consultorEmpresas.map(ce => ce.empresa_id));
    return empresas.filter(emp => !idsVinculados.has(emp.id) && emp.is_active !== false);
  }, [empresas, consultorEmpresas]);

  if (loading) return (
    <div className="flex h-96 items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto" />
        <p className="text-sm font-bold text-slate-500">Carregando painel consultivo...</p>
      </div>
    </div>
  );

  const empresasAtivas = empresas.filter((empresa) => empresa.is_active !== false).length;
  const usuariosAtivos = usuarios.filter((usuario) => usuario.is_active).length;
  const modeLabel = isSuperConsultor ? 'Super Consultor (Gestão Global)' : 'Consultor (Escopo Autorizado)';

  const tabItems = [
    { key: 'empresas' as const, label: 'Minhas Empresas', icon: Building2, count: empresas.length, visible: true },
    { key: 'consultores' as const, label: 'Gerenciar Consultores', icon: Users, count: consultores.length, visible: isSuperConsultor },
    { key: 'planos-padrao' as const, label: 'Planos Padrão & Ajustes', icon: Layers, visible: isSuperConsultor },
    { key: 'bancos' as const, label: 'Bancos Globais', icon: Landmark, count: bankPresets.length, visible: isSuperConsultor },
    { key: 'usuarios' as const, label: 'Usuários', icon: Shield, count: usuarios.length, visible: isSuperConsultor },
  ].filter((item) => item.visible);

  return (
    <div className="w-full space-y-6 animate-fade-in pb-16">
      {/* HEADER DE OPERAÇÃO CONSULTIVA */}
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_26%),linear-gradient(135deg,#ffffff_0%,#f8fafc_46%,#eff6ff_100%)] p-5 shadow-xs dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_34%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_46%,rgba(30,41,59,0.92)_100%)] sm:p-6">
        <div className="absolute -right-8 top-0 h-40 w-40 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="absolute -left-6 bottom-0 h-36 w-36 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <Briefcase className="h-3.5 w-3.5 text-blue-600" />
                Área Administrativa e Consultiva
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Painel do Consultor</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Gerencie empresas, configure estruturas padrão de plano de contas, consulte bancos globais e controle acessos com segurança estrutural.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              {isSuperConsultor && (
                <button onClick={handleOpenCreate} className="rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-98 cursor-pointer">
                  <Building2 size={18} /> Nova Empresa
                </button>
              )}
              <button onClick={() => setShowUserModal(true)} className="rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-98 cursor-pointer">
                <UserPlus size={18} /> Novo Usuário
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Modo Operacional</p>
              <p className="mt-2 text-base font-black text-slate-900 dark:text-white truncate">{modeLabel}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Logado: {currentUser?.email}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Empresas Ativas</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{empresasAtivas}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{empresas.length} empresas na rede total</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Consultores</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{consultores.length}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Equipe consultiva cadastrada</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Usuários Ativos</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{usuariosAtivos}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{usuarios.length} usuários totais</p>
            </div>
          </div>
        </div>
      </section>

      {/* SELETOR DE ABAS */}
      <div className="rounded-3xl border border-slate-200 bg-white/90 p-2.5 shadow-xs dark:border-slate-700 dark:bg-slate-800/90">
        <div className="flex flex-wrap gap-2 overflow-x-auto">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition cursor-pointer ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon size={18} /> 
                {item.label}
                {item.count !== undefined ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {item.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================= */}
      {/* ABA: MINHAS EMPRESAS */}
      {/* ========================================================= */}
      {activeTab === 'empresas' && (
        <div className="space-y-4">
          {/* BARRA DE FILTROS E BUSCA */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
              <input 
                type="text" 
                placeholder="Pesquisar empresa por nome fantasia, razão social ou CNPJ..." 
                className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition text-sm shadow-xs"
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
              {(['todas', 'ativas', 'inativas'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => setEmpresaStatusFilter(status)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition capitalize cursor-pointer ${
                    empresaStatusFilter === status 
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-xs' 
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* GRID DE EMPRESAS (SEM BOTÕES DE DELETAR/DESATIVAR NO CARD) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {empresasFiltradas.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-slate-500">
                Nenhuma empresa encontrada com os critérios informados.
              </div>
            ) : (
              empresasFiltradas.map(emp => {
                const cor = emp.cor_primaria || '#2563eb';
                const isActive = emp.is_active !== false;
                return (
                  <div 
                    key={emp.id} 
                    className="relative rounded-2xl p-5 shadow-xs hover:shadow-lg transition-all duration-300 border flex flex-col justify-between group bg-white dark:bg-slate-800"
                    style={{ 
                      borderColor: `${cor}40`,
                      background: `linear-gradient(145deg, ${cor}08 0%, #ffffff 70%)` 
                    }}
                  >
                    {/* Botão de Editar protegido no topo */}
                    <button 
                      onClick={() => handleOpenEdit(emp)} 
                      className="absolute top-4 right-4 p-2 rounded-xl bg-white/80 hover:bg-blue-50 border border-slate-200 text-slate-500 hover:text-blue-600 transition dark:bg-slate-800/80 dark:border-slate-700 dark:hover:bg-slate-700 cursor-pointer shadow-xs" 
                      title="Editar dados da empresa"
                    >
                      <Pencil size={15} />
                    </button>

                    <div className="flex items-center gap-2 mb-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                      }`}>
                        {isActive ? 'Ativa' : 'Inativa'}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">
                        {emp.tipo_pessoa === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3.5 mb-6">
                      <AvatarEmpresa nome={emp.nome_fantasia} src={emp.logo_url} cor={cor} />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight truncate" title={emp.nome_fantasia}>
                          {emp.nome_fantasia}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5" title={emp.razao_social}>
                          {emp.razao_social || 'Razão social não informada'}
                        </p>
                        <p className="text-[11px] font-mono text-slate-400 mt-1">
                          {emp.cnpj ? `CNPJ: ${emp.cnpj}` : `ID: #${emp.id}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-auto pt-3 border-t border-slate-100 dark:border-slate-700/60">
                      <button 
                        onClick={() => solicitarTroca(emp)}
                        disabled={!isActive}
                        className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm active:scale-98 cursor-pointer ${
                          !isActive ? 'opacity-50 cursor-not-allowed bg-slate-400 text-white' : ''
                        }`}
                        style={{ backgroundColor: isActive ? cor : undefined, color: '#fff' }}
                      >
                        <ArrowRightLeft size={14} /> Acessar Empresa
                      </button>
                      <button 
                        onClick={() => handleOpenEdit(emp)}
                        className="px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ABA: GERENCIAR CONSULTORES */}
      {/* ========================================================= */}
      {activeTab === 'consultores' && isSuperConsultor && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-800/80">
            <p className="text-sm font-bold text-slate-800 dark:text-white">Rede de Consultores</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Vincule empresas e defina privilégios de consultoria global ou específica. O e-mail e dados de acesso são exibidos integralmente para gestão.
            </p>
          </div>

          {consultores.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 text-center text-slate-400">
              Nenhum consultor encontrado.
            </div>
          ) : (
            <div className="space-y-3">
              {consultores.map(consultor => {
                const isExpanded = expandedConsultorId === consultor.id;
                const isSuper = consultor.consultor_role === 'SUPER_CONSULTOR';
                return (
                  <div key={consultor.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden">
                    <div 
                      onClick={() => toggleConsultorAccordion(consultor)}
                      className="p-4 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-xs ${
                          isSuper ? 'bg-linear-to-br from-amber-500 to-amber-600' : 'bg-linear-to-br from-blue-500 to-blue-600'
                        }`}>
                          {consultor.nome.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900 dark:text-white text-sm">{consultor.nome}</p>
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              isSuper ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                            }`}>
                              {isSuper ? '👑 Super Consultor' : '📊 Consultor'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{consultor.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 hidden sm:inline">
                          {isSuper ? 'Acesso a todas as empresas' : `${consultor.num_empresas_acesso ?? 0} empresas vinculadas`}
                        </span>
                        <div className="p-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500">
                          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </div>
                      </div>
                    </div>

                    {/* DETALHES DO CONSULTOR EXPANDIDO */}
                    {isExpanded && (
                      <div className="p-5 bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700 space-y-4">
                        {/* EMPRESAS VINCULADAS */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                              Empresas Autorizadas ({consultorEmpresas.length})
                            </p>
                            {isSuper && (
                              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-bold">
                                Super Consultor já possui acesso a todas as empresas do ERP.
                              </span>
                            )}
                          </div>

                          {loadingConsultorEmpresas ? (
                            <div className="py-4 text-center text-xs text-slate-400"><Loader2 className="animate-spin inline mr-1" size={14} /> Carregando empresas...</div>
                          ) : consultorEmpresas.length === 0 ? (
                            <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-400">
                              Nenhuma empresa vinculada individualmente.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                              {consultorEmpresas.map(ce => (
                                <div key={ce.empresa_id} className="flex items-center justify-between bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate mr-2" title={ce.empresa_nome}>
                                    {ce.empresa_nome}
                                  </span>
                                  <button 
                                    onClick={() => removerEmpresaDoConsultor(consultor.id, ce.empresa_id)}
                                    className="p-1 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
                                    title="Revogar acesso"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* VINCULAR NOVA EMPRESA COM SELETOR PESQUISÁVEL */}
                        <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
                            Vincular Nova Empresa
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
                            <div className="flex-1">
                              <SearchableSelect
                                value={selectedCompanyToAdd ? String(selectedCompanyToAdd) : ''}
                                onChange={(val) => setSelectedCompanyToAdd(val ? Number(val) : null)}
                                options={[{
                                  label: 'Empresas Disponíveis',
                                  options: [
                                    { id: '', label: '-- Selecione uma empresa para vincular --' },
                                    ...empresasNaoVinculadas.map(emp => ({
                                      id: String(emp.id),
                                      label: emp.nome_fantasia || emp.razao_social || `Empresa #${emp.id}`
                                    }))
                                  ]
                                }]}
                              />
                            </div>
                            <button
                              onClick={() => selectedCompanyToAdd && adicionarEmpresaAoConsultor(consultor.id, selectedCompanyToAdd)}
                              disabled={!selectedCompanyToAdd}
                              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-xs"
                            >
                              <Plus size={15} /> Vincular Empresa
                            </button>
                          </div>
                        </div>

                        {/* MUDANÇA DE ROLE */}
                        <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                          <button 
                            onClick={() => mudarRoleConsultor(consultor.id)}
                            className="px-4 py-2 rounded-xl text-xs font-bold border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-300 transition flex items-center gap-2 cursor-pointer"
                          >
                            <Shield size={14} /> 
                            {isSuper ? 'Rebaixar para Consultor Comum' : 'Promover a Super Consultor Global'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* ABA: PLANOS PADRÃO & AJUSTES */}
      {/* ========================================================= */}
      {activeTab === 'planos-padrao' && isSuperConsultor && (
        <div className="space-y-6">
          {/* BARRA DE CONTROLE E ESTATÍSTICAS */}
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800/90 space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-blue-700 dark:border-blue-900 dark:bg-blue-500/10 dark:text-blue-300">
                  <Layers className="h-3.5 w-3.5" />
                  Matriz de Plano de Contas
                </div>
                <h2 className="mt-2 text-xl font-black text-slate-900 dark:text-white">
                  Templates Globais e Ajustes Automáticos
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Gerencie a árvore de categorias base de PF e PJ e use as ferramentas de sincronização e exportação/importação JSON.
                </p>
              </div>

              {/* SELETOR PF/PJ E AÇÕES RÁPIDAS */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-slate-100 dark:bg-slate-700/60 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setTemplateTipoPessoa('PJ')}
                    className={`rounded-xl px-4 py-2 text-xs font-bold transition cursor-pointer ${
                      templateTipoPessoa === 'PJ' 
                        ? 'bg-blue-600 text-white shadow-xs' 
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    Pessoa Jurídica (PJ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateTipoPessoa('PF')}
                    className={`rounded-xl px-4 py-2 text-xs font-bold transition cursor-pointer ${
                      templateTipoPessoa === 'PF' 
                        ? 'bg-emerald-600 text-white shadow-xs' 
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    Pessoa Física (PF)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowSyncModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-3.5 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-700 shadow-xs cursor-pointer"
                >
                  <RefreshCw size={14} /> Sincronizar com Empresa
                </button>

                <button
                  type="button"
                  onClick={exportarTemplateJSON}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition shadow-xs cursor-pointer"
                >
                  <Download size={14} /> Exportar JSON
                </button>

                <label className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition shadow-xs cursor-pointer">
                  <Upload size={14} /> Importar JSON
                  <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportTemplateFile} />
                </label>
              </div>
            </div>

            {/* CARDS DE ESTATÍSTICAS DO TEMPLATE */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Categorias</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{templateStats.total}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Template {templateTipoPessoa}</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Analíticas (Lançáveis)</p>
                <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{templateStats.analiticas}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Aceitam lançamentos</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sintéticas (Agrupadoras)</p>
                <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{templateStats.sinteticas}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Pastas e grupos</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Operacionais</p>
                <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{templateStats.operacionais}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Compõem resultado operacional</p>
              </div>
            </div>
          </div>

          {/* AJUSTE AUTOMÁTICO GLOBAL */}
          <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5 shadow-xs dark:border-amber-900 dark:bg-amber-500/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Ajuste Automático Global ({templateTipoPessoa})</p>
                <h3 className="mt-1 text-base font-black text-slate-900 dark:text-white">Categorias Padrão para Diferenças de Liquidação</h3>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Despesa paga a maior gera Juros/Multa; Receita recebida a menor gera Descontos.</p>
              </div>
              <button
                type="button"
                onClick={salvarAutoAdjustmentConfig}
                disabled={!autoAdjustConfig || loadingAutoAdjustConfig || savingAutoAdjustConfig}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {savingAutoAdjustConfig ? 'Salvando...' : 'Salvar Configuração Global'}
              </button>
            </div>

            {loadingAutoAdjustConfig ? (
              <div className="mt-4 text-xs text-slate-500"><Loader2 className="animate-spin inline mr-1" size={14} /> Carregando...</div>
            ) : autoAdjustConfig ? (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                  <SearchableCategorySelect
                    label="Juros e Multa (Despesa maior que prevista)"
                    placeholder="Sem categoria fixa (usar padrão interno)"
                    value={autoAdjustConfig.juros_multa_template_id}
                    options={templateCategoriaOptions}
                    onChange={(nextValue) => setAutoAdjustConfig((prev) => prev ? ({ ...prev, juros_multa_template_id: nextValue }) : prev)}
                  />
                  <p className="mt-2 text-[11px] text-slate-500">Atual: {autoAdjustConfig.juros_multa_categoria_nome} ({autoAdjustConfig.juros_multa_dre_grupo})</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                  <SearchableCategorySelect
                    label="Descontos Concedidos (Receita menor que prevista)"
                    placeholder="Sem categoria fixa (usar padrão interno)"
                    value={autoAdjustConfig.descontos_template_id}
                    options={templateCategoriaOptions}
                    onChange={(nextValue) => setAutoAdjustConfig((prev) => prev ? ({ ...prev, descontos_template_id: nextValue }) : prev)}
                  />
                  <p className="mt-2 text-[11px] text-slate-500">Atual: {autoAdjustConfig.descontos_categoria_nome} ({autoAdjustConfig.descontos_dre_grupo})</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-xs text-rose-600">Não foi possível carregar a configuração global de ajuste automático.</div>
            )}
          </div>

          {/* AJUSTE AUTOMÁTICO POR EMPRESA */}
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-xs dark:border-emerald-900 dark:bg-emerald-500/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Ajuste Automático por Empresa</p>
                <h3 className="mt-1 text-base font-black text-slate-900 dark:text-white">Configuração Específica no Plano da Empresa</h3>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Sobrescreva as categorias de ajuste para uma empresa específica.</p>
              </div>
              <button
                type="button"
                onClick={salvarAutoAdjustmentEmpresaConfig}
                disabled={!empresaAutoAdjustConfig || !selectedEmpresaAutoAdjustId || loadingEmpresaAutoAdjust || savingEmpresaAutoAdjust}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {savingEmpresaAutoAdjust ? 'Salvando...' : 'Salvar por Empresa'}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_2fr_2fr]">
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="mb-2 text-xs font-bold uppercase text-slate-700 dark:text-slate-300">Selecione a Empresa</p>
                <SearchableSelect
                  value={selectedEmpresaAutoAdjustId === null ? '' : String(selectedEmpresaAutoAdjustId)}
                  onChange={(val) => setSelectedEmpresaAutoAdjustId(val ? Number(val) : null)}
                  options={[{
                    label: 'Empresas',
                    options: [
                      { id: '', label: '-- Selecione a empresa --' },
                      ...empresas.map((empresa) => ({
                        id: String(empresa.id),
                        label: empresa.nome_fantasia || empresa.razao_social || `Empresa #${empresa.id}`
                      }))
                    ]
                  }]}
                />
                {empresaAutoAdjustConfig?.tipo_pessoa && (
                  <p className="mt-2 text-xs text-slate-500">Tipo: {empresaAutoAdjustConfig.tipo_pessoa === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}</p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                {loadingEmpresaAutoAdjust ? (
                  <p className="text-xs text-slate-500"><Loader2 className="animate-spin inline mr-1" size={14} /> Carregando opções...</p>
                ) : empresaAutoAdjustConfig ? (
                  <>
                    <SearchableCategorySelect
                      label="Juros e Multa (Empresa)"
                      placeholder="Sem categoria fixa (criar automaticamente)"
                      value={empresaAutoAdjustConfig.juros_multa_plano_contas_id}
                      options={empresaCategoriaOptions}
                      onChange={(nextValue) => setEmpresaAutoAdjustConfig((prev) => prev ? ({ ...prev, juros_multa_plano_contas_id: nextValue }) : prev)}
                    />
                    <p className="mt-2 text-[11px] text-slate-500">Atual: {empresaAutoAdjustConfig.juros_multa_categoria_nome}</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-400 py-3">Selecione uma empresa à esquerda para configurar.</p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                {loadingEmpresaAutoAdjust ? (
                  <p className="text-xs text-slate-500"><Loader2 className="animate-spin inline mr-1" size={14} /> Carregando opções...</p>
                ) : empresaAutoAdjustConfig ? (
                  <>
                    <SearchableCategorySelect
                      label="Descontos (Empresa)"
                      placeholder="Sem categoria fixa (criar automaticamente)"
                      value={empresaAutoAdjustConfig.descontos_plano_contas_id}
                      options={empresaCategoriaOptions}
                      onChange={(nextValue) => setEmpresaAutoAdjustConfig((prev) => prev ? ({ ...prev, descontos_plano_contas_id: nextValue }) : prev)}
                    />
                    <p className="mt-2 text-[11px] text-slate-500">Atual: {empresaAutoAdjustConfig.descontos_categoria_nome}</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-400 py-3">Selecione uma empresa à esquerda para configurar.</p>
                )}
              </div>
            </div>
          </div>

          {/* GERENCIADOR DA ÁRVORE DO PLANO PADRÃO */}
          {loadingTemplateCategorias ? (
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-12 text-center shadow-xs dark:border-slate-700 dark:bg-slate-800/90">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
              <p className="mt-3 text-sm text-slate-500">Carregando árvore de categorias {templateTipoPessoa}...</p>
            </div>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800/90">
              {templateCategoriasError && (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">
                  {templateCategoriasError}
                </div>
              )}
              <PlanoContasManager
                categorias={templateCategorias}
                onUpdateList={setTemplateCategorias}
                apiBasePath={`/consultor/super/plano-contas-templates/${templateTipoPessoa}`}
                syncWithLookupStore={false}
              />
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* ABA: BANCOS GLOBAIS */}
      {/* ========================================================= */}
      {activeTab === 'bancos' && isSuperConsultor && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800/90">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <Landmark className="h-3.5 w-3.5" />
                  Presets Globais
                </div>
                <h2 className="mt-2 text-xl font-black text-slate-900 dark:text-white">Bancos Usados no Sistema</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Logos e identificadores globais sugeridos na criação de contas e conciliação.
                </p>
              </div>
              <button
                type="button"
                onClick={resetBankPresetForm}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                + Novo Preset
              </button>
            </div>

            {/* BUSCA DE BANCOS */}
            <div className="relative mt-4 group">
              <Search className="absolute left-3.5 top-3 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
              <input
                type="text"
                value={bancosSearchTerm}
                onChange={(e) => setBancosSearchTerm(e.target.value)}
                placeholder="Filtrar por nome ou alias..."
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
              />
            </div>

            <div className="mt-4 space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {loadingBankPresets ? (
                <div className="py-10 text-center text-xs text-slate-500"><Loader2 className="animate-spin inline mr-1" size={16} /> Carregando bancos globais...</div>
              ) : bancosFiltrados.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">Nenhum banco global cadastrado.</div>
              ) : (
                bancosFiltrados.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <BankAvatar logoUrl={item.logo_url} bankName={item.bank_name} accountName={item.label} size="md" className="h-12 w-12" imageClassName="rounded-xl" fallbackClassName="rounded-xl border-0 shadow-none" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-slate-900 dark:text-white text-sm">{item.label}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${item.is_active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                              {item.is_active ? 'ATIVO' : 'INATIVO'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Chave: <code className="font-mono">{item.key}</code> | Nome base: {item.bank_name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">Aliases: {(item.aliases || []).join(', ') || 'Nenhum'}</p>
                        </div>
                      </div>

                      {/* Apenas botão Editar no card, exclusão protegida dentro do form */}
                      <button
                        type="button"
                        onClick={() => startEditBankPreset(item)}
                        className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-600 transition hover:bg-blue-50 dark:border-blue-900 dark:bg-slate-800 dark:text-blue-300 cursor-pointer shadow-xs"
                      >
                        <Pencil size={13} /> Editar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* FORMULÁRIO DE CADASTRO / EDIÇÃO */}
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800/90">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">{editingBankPresetKey ? 'Editar Banco Global' : 'Cadastrar Banco Global'}</h3>
                <p className="mt-0.5 text-xs text-slate-500">Defina os identificadores, logo padrão e apelidos para conciliação.</p>
              </div>
              {editingBankPresetKey && (
                <button type="button" onClick={resetBankPresetForm} className="text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer">Cancelar edição</button>
              )}
            </div>

            <form onSubmit={handleSubmitBankPreset} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome exibido</label>
                  <input
                    type="text"
                    value={bankPresetForm.label}
                    onChange={(e) => setBankPresetForm((prev) => ({ ...prev, label: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Ex: Banco do Brasil"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome técnico do banco</label>
                  <input
                    type="text"
                    value={bankPresetForm.bank_name}
                    onChange={(e) => setBankPresetForm((prev) => ({ ...prev, bank_name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Ex: Banco do Brasil"
                    required
                  />
                </div>
                {!editingBankPresetKey && (
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Chave (Identificador único)</label>
                    <input
                      type="text"
                      value={bankPresetForm.key}
                      onChange={(e) => setBankPresetForm((prev) => ({ ...prev, key: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                      placeholder="Ex: banco-do-brasil"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Ordem de exibição</label>
                  <input
                    type="number"
                    value={bankPresetForm.sort_order}
                    onChange={(e) => setBankPresetForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Aliases (separados por vírgula)</label>
                <input
                  type="text"
                  value={bankPresetForm.aliases}
                  onChange={(e) => setBankPresetForm((prev) => ({ ...prev, aliases: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Ex: BB, Banco Brasil, 001"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Logo Padrão</label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <BankAvatar logoUrl={bankPresetForm.logo_url} bankName={bankPresetForm.bank_name} accountName={bankPresetForm.label} size="md" className="h-14 w-14" imageClassName="rounded-xl" fallbackClassName="rounded-xl border-0 shadow-none" />
                    <div className="text-xs text-slate-400">Preview do avatar bancário</div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 shadow-xs">
                    <Upload size={14} /> Enviar Logo
                    <input type="file" accept="image/*" className="hidden" onChange={handleBankPresetLogoUpload} />
                  </label>
                </div>
                <input
                  type="text"
                  value={bankPresetForm.logo_url}
                  onChange={(e) => setBankPresetForm((prev) => ({ ...prev, logo_url: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-mono outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="/static/uploads/... ou URL pública"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bankPresetForm.is_active}
                  onChange={(e) => setBankPresetForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                Banco Preset Ativo
              </label>

              <button
                type="submit"
                disabled={savingBankPreset || uploading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60 cursor-pointer shadow-lg shadow-blue-600/20"
              >
                {(savingBankPreset || uploading) && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingBankPresetKey ? 'Salvar Alterações no Banco' : 'Cadastrar Banco Global'}
              </button>

              {/* ZONA DE RISCO DO BANCO GLOBAL */}
              {editingBankPresetKey && (
                <div className="pt-4 mt-4 border-t border-red-200/60 dark:border-red-900/40 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleDeleteBankPreset(editingBankPresetKey)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl border border-red-200 transition dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30 cursor-pointer"
                  >
                    <Trash2 size={13} /> Excluir este banco global
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ABA: USUÁRIOS */}
      {/* ========================================================= */}
      {activeTab === 'usuarios' && isSuperConsultor && (
        <div className="space-y-4">
          {/* FILTROS E BUSCA DE USUÁRIOS */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
              <input
                type="text"
                placeholder="Pesquisar usuário por nome ou e-mail..."
                className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
                value={usuarioSearchTerm}
                onChange={(e) => setUsuarioSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                {(['todos', 'ativos', 'inativos'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => setUsuarioStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition capitalize cursor-pointer ${
                      usuarioStatusFilter === status ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-xs' : 'text-slate-500'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                {(['todos', 'consultores', 'clientes'] as const).map(role => (
                  <button
                    key={role}
                    onClick={() => setUsuarioRoleFilter(role)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition capitalize cursor-pointer ${
                      usuarioRoleFilter === role ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-xs' : 'text-slate-500'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* GRID DE USUÁRIOS (SEM BOTÕES DIRETOS DE DELETAR/DESATIVAR) */}
          {loadingUsuarios ? (
            <div className="py-12 text-center text-slate-500"><Loader2 className="animate-spin inline mr-2" /> Carregando usuários...</div>
          ) : usuariosFiltrados.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700 rounded-2xl p-10 text-center text-slate-400">
              Nenhum usuário encontrado com os filtros selecionados.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {usuariosFiltrados.map(user => {
                const isSelf = currentUser?.id === user.id;
                const isSuper = user.consultor_role === 'SUPER_CONSULTOR';
                const isConsultor = user.is_consultor;
                return (
                  <div key={user.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4.5 flex flex-col justify-between shadow-xs hover:shadow-md transition">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm text-white ${
                            isSuper ? 'bg-amber-500' : isConsultor ? 'bg-blue-600' : 'bg-slate-600'
                          }`}>
                            {(user.nome || user.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 dark:text-white text-sm truncate" title={user.nome || user.email}>
                              {user.nome || 'Sem nome cadastrado'}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate" title={user.email}>
                              {user.email}
                            </p>
                          </div>
                        </div>

                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${
                          user.is_active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                        }`}>
                          {user.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>

                      <div className="mt-3.5 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                          <span>Perfil:</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {isSuper ? '👑 Super Consultor' : isConsultor ? '📊 Consultor' : '👤 Usuário Cliente'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                          <span>Empresa:</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[170px]" title={user.empresa_nome || 'Acesso Multi-Empresas'}>
                            {user.empresa_nome || (isConsultor ? 'Multi-Empresas' : '—')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* BOTÃO ÚNICO DE EDITAR (PROTEGENDO DELETAR/DESATIVAR) */}
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400">ID: #{user.id}</span>
                      <button
                        onClick={() => handleOpenEditUser(user)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-600 transition dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 cursor-pointer shadow-xs"
                      >
                        <Pencil size={13} /> Editar Usuário
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EDITAR USUÁRIO & ZONA DE SEGURANÇA */}
      {/* ========================================================= */}
      {showEditUserModal && editingUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 animate-scale-in border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="text-blue-500" size={18} /> Editar Usuário
              </h2>
              <button onClick={() => setShowEditUserModal(false)} className="text-slate-400 hover:text-red-500 transition cursor-pointer p-1">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome Completo</label>
                <input
                  required
                  type="text"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500"
                  value={editUserForm.nome}
                  onChange={e => setEditUserForm({ ...editUserForm, nome: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">E-mail de Acesso</label>
                <input
                  required
                  type="email"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500"
                  value={editUserForm.email}
                  onChange={e => setEditUserForm({ ...editUserForm, email: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Empresa Vinculada</label>
                <SearchableSelect
                  value={editUserForm.is_consultor ? '' : (editUserForm.empresa_id ? String(editUserForm.empresa_id) : '')}
                  onChange={(val) => setEditUserForm({ ...editUserForm, empresa_id: Number(val) })}
                  disabled={editUserForm.is_consultor}
                  options={[{
                    label: 'Empresas',
                    options: [
                      { id: '', label: editUserForm.is_consultor ? '-- Consultor possui acesso multi-empresas --' : '-- Selecione a empresa --' },
                      ...(!editUserForm.is_consultor ? empresas.map(emp => ({ id: String(emp.id), label: emp.nome_fantasia || emp.razao_social })) : [])
                    ]
                  }]}
                />
              </div>

              {/* PERMISSÃO CONSULTOR */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editUserForm.is_consultor}
                    onChange={e => setEditUserForm({ ...editUserForm, is_consultor: e.target.checked })}
                    className="h-4 w-4 rounded text-blue-600 border-slate-300"
                  />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Permissão Especial de Consultoria
                  </span>
                </label>

                {editUserForm.is_consultor && (
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-400 mb-1 block">Papel de Consultor</label>
                    <select
                      value={editUserForm.consultor_role}
                      onChange={e => setEditUserForm({ ...editUserForm, consultor_role: e.target.value })}
                      className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold outline-none"
                    >
                      <option value="CONSULTOR">📊 Consultor de Empresas Autorizadas</option>
                      <option value="SUPER_CONSULTOR">👑 Super Consultor (Acesso Global Irrestrito)</option>
                    </select>
                  </div>
                )}
              </div>

              {/* REDEFINIÇÃO DE SENHA INTEGRADA (SEM WINDOW.PROMPT) */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <KeyRound size={14} className="text-blue-500" /> Redefinir Senha
                  </span>
                  {!showPasswordInput && (
                    <button
                      type="button"
                      onClick={() => setShowPasswordInput(true)}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                    >
                      Alterar senha deste usuário
                    </button>
                  )}
                </div>

                {showPasswordInput && (
                  <div className="pt-2">
                    <input
                      type="password"
                      placeholder="Digite a nova senha..."
                      value={editUserForm.nova_senha}
                      onChange={e => setEditUserForm({ ...editUserForm, nova_senha: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Se deixar em branco, a senha atual continuará a mesma.</p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={savingUser}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition shadow-lg shadow-blue-600/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {savingUser ? <Loader2 className="animate-spin" size={16} /> : null}
                Salvar Alterações
              </button>

              {/* ZONA DE RISCO DO USUÁRIO */}
              <div className="pt-4 mt-4 border-t border-red-200/60 dark:border-red-900/40 rounded-2xl bg-red-50/50 dark:bg-red-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-xs">
                  <AlertTriangle size={15} /> Ações Críticas de Segurança
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={currentUser?.id === editingUser.id}
                    onClick={() => {
                      if (currentUser?.id === editingUser.id) return;
                      const nextActive = !editUserForm.is_active;
                      if (window.confirm(`Deseja realmente ${nextActive ? 'ativar' : 'desativar'} o usuário ${editingUser.nome || editingUser.email}?`)) {
                        if (nextActive) ativarUsuario(editingUser.id);
                        else desativarUsuario(editingUser.id);
                        setShowEditUserModal(false);
                      }
                    }}
                    className="flex-1 py-2 px-3 text-xs font-bold rounded-xl border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100/50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {editUserForm.is_active ? 'Desativar Usuário' : 'Ativar Usuário'}
                  </button>

                  <button
                    type="button"
                    disabled={currentUser?.id === editingUser.id}
                    onClick={() => {
                      if (currentUser?.id === editingUser.id) return;
                      if (window.confirm(`ATENÇÃO: Deseja realmente excluir definitivamente o usuário ${editingUser.nome || editingUser.email}?`)) {
                        deletarUsuario(editingUser.id);
                        setShowEditUserModal(false);
                      }
                    }}
                    className="flex-1 py-2 px-3 text-xs font-bold rounded-xl border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100/50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Trash2 size={13} /> Excluir Usuário
                  </button>
                </div>
                {currentUser?.id === editingUser.id && (
                  <p className="text-[10px] text-slate-400 text-center">Você não pode desativar ou deletar sua própria conta em uso.</p>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: SINCRONIZAR TEMPLATE COM EMPRESA */}
      {/* ========================================================= */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 animate-scale-in border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <RefreshCw className="text-indigo-600" size={18} /> Sincronizar Plano Padrão
              </h2>
              <button onClick={() => setShowSyncModal(false)} className="text-slate-400 hover:text-red-500 cursor-pointer p-1"><X size={20} /></button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
              O sistema aplicará a matriz <strong>{templateTipoPessoa}</strong> na empresa selecionada, criando automaticamente as categorias faltantes sem apagar categorias customizadas nem lançamentos financeiros existentes.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Empresa de Destino</label>
                <SearchableSelect
                  value={syncTargetEmpresaId ? String(syncTargetEmpresaId) : ''}
                  onChange={(val) => setSyncTargetEmpresaId(val ? Number(val) : null)}
                  options={[{
                    label: 'Empresas',
                    options: [
                      { id: '', label: '-- Selecione a empresa de destino --' },
                      ...empresas.filter(e => e.is_active !== false).map(e => ({
                        id: String(e.id),
                        label: e.nome_fantasia || e.razao_social
                      }))
                    ]
                  }]}
                />
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSyncModal(false)}
                  className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSincronizarTemplate}
                  disabled={!syncTargetEmpresaId || syncingTemplate}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition shadow-md disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {syncingTemplate ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Sincronizar Agora
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: CONFIRMAÇÃO DE ACESSO / TROCA DE CONTEXTO */}
      {/* ========================================================= */}
      {showTrocaModal && targetEmpresa && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-sm w-full p-6 animate-scale-in border border-slate-200 dark:border-slate-700 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mx-auto mb-4 border border-blue-100 dark:border-blue-900">
               <ArrowRightLeft size={28} className="text-blue-600" />
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white mb-2">Acessar Empresa?</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              Seu contexto operacional será alterado para:<br/>
              <strong className="text-slate-900 dark:text-white text-base font-black">{targetEmpresa.nome_fantasia}</strong>
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => setShowTrocaModal(false)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-xl text-xs font-bold transition cursor-pointer">
                Cancelar
              </button>
              <button onClick={confirmarTroca} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 cursor-pointer">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EMPRESA (CRIAR & EDITAR COM ZONA DE SEGURANÇA) */}
      {/* ========================================================= */}
      {showEmpresaModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 animate-scale-in border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className={isEditing ? "text-blue-500" : "text-emerald-500"} size={20} /> 
                {isEditing ? "Editar Empresa" : "Nova Empresa"}
              </h2>
              <button onClick={() => setShowEmpresaModal(false)} className="text-slate-400 hover:text-red-500 transition cursor-pointer p-1"><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmitEmpresa} className="space-y-4">
              <div className="flex justify-center mb-3">
                <label className="relative cursor-pointer group">
                  <div className={`w-22 h-22 rounded-2xl bg-slate-100 dark:bg-slate-700 border-2 border-dashed ${uploading ? 'border-blue-500' : 'border-slate-300 dark:border-slate-600'} flex items-center justify-center overflow-hidden hover:border-blue-500 transition shadow-xs`}>
                    {uploading ? (
                      <div className="text-blue-500 animate-spin"><Loader2 size={24} /></div>
                    ) : previewUrl ? (
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-contain p-1" />
                    ) : (
                      <div className="text-center text-slate-400"><Upload size={22} className="mx-auto mb-1" /><span className="text-[10px] font-bold uppercase">Logo</span></div>
                    )}
                  </div>
                  <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} disabled={uploading} />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome Fantasia</label>
                  <input required type="text" className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500" value={formEmpresa.nome_fantasia} onChange={e => setFormEmpresa({...formEmpresa, nome_fantasia: e.target.value})} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Razão Social</label>
                  <input type="text" className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500" value={formEmpresa.razao_social} onChange={e => setFormEmpresa({...formEmpresa, razao_social: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">{formEmpresa.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'}</label>
                  <input type="text" placeholder={formEmpresa.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500" value={formEmpresa.cnpj} onChange={e => setFormEmpresa({...formEmpresa, cnpj: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Tipo de Pessoa</label>
                  <SearchableSelect
                    value={formEmpresa.tipo_pessoa}
                    onChange={val => setFormEmpresa({ ...formEmpresa, tipo_pessoa: String(val) as 'PF' | 'PJ' })}
                    options={[{
                      label: 'Tipo',
                      options: [
                        { id: 'PF', label: 'Pessoa Física' },
                        { id: 'PJ', label: 'Pessoa Jurídica' }
                      ]
                    }]}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Cor da Marca</label>
                  <div className="flex h-11 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <input type="color" className="h-full w-14 cursor-pointer border-none p-0" value={formEmpresa.cor_primaria} onChange={e => setFormEmpresa({...formEmpresa, cor_primaria: e.target.value})} />
                    <input type="text" className="flex-1 bg-transparent px-3 text-xs uppercase dark:text-white outline-none font-mono" value={formEmpresa.cor_primaria} onChange={e => setFormEmpresa({...formEmpresa, cor_primaria: e.target.value})} />
                  </div>
                </div>
              </div>

              <button type="submit" disabled={uploading} className={`w-full py-3 text-white font-bold rounded-2xl transition shadow-lg mt-3 disabled:opacity-50 cursor-pointer ${isEditing ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'}`}>
                {uploading ? 'Enviando...' : (isEditing ? 'Salvar Alterações' : 'Cadastrar Empresa')}
              </button>

              {/* ZONA DE RISCO DA EMPRESA (APENAS EM EDIÇÃO) */}
              {isEditing && editingId && (
                <div className="mt-5 pt-4 border-t border-red-200/60 dark:border-red-900/40 rounded-2xl bg-red-50/50 dark:bg-red-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-xs">
                    <AlertTriangle size={15} /> Zona de Segurança da Empresa
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Ações de desativação e remoção protegidas para evitar acidentes operacionais.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const emp = empresas.find(e => e.id === editingId);
                        if (!emp) return;
                        const nextActive = !emp.is_active;
                        if (window.confirm(`Deseja realmente ${nextActive ? 'ativar' : 'desativar'} a empresa ${emp.nome_fantasia}?`)) {
                          if (nextActive) ativarEmpresa(editingId);
                          else desativarEmpresa(editingId);
                          setShowEmpresaModal(false);
                        }
                      }}
                      className="flex-1 py-2 px-3 text-xs font-bold rounded-xl border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100/50 transition cursor-pointer"
                    >
                      {empresas.find(e => e.id === editingId)?.is_active ? 'Desativar Empresa' : 'Reativar Empresa'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const emp = empresas.find(e => e.id === editingId);
                        if (!emp) return;
                        if (window.confirm(`ATENÇÃO CRÍTICA: Deseja realmente excluir a empresa ${emp.nome_fantasia}? Todos os acessos serão bloqueados.`)) {
                          deletarEmpresa(editingId);
                          setShowEmpresaModal(false);
                        }
                      }}
                      className="flex-1 py-2 px-3 text-xs font-bold rounded-xl border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100/50 transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={13} /> Excluir Empresa
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: NOVO USUÁRIO */}
      {/* ========================================================= */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 animate-scale-in border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="text-blue-500" size={20} /> Novo Usuário
              </h2>
              <button onClick={() => setShowUserModal(false)} className="text-slate-400 hover:text-red-500 transition cursor-pointer p-1"><X size={20} /></button>
            </div>
            
            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome Completo</label>
                <input required type="text" className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500" value={newUser.nome} onChange={e => setNewUser({...newUser, nome: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">E-mail</label>
                <input required type="email" className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Senha Inicial</label>
                <input required type="password" className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent dark:text-white text-sm outline-none focus:border-blue-500" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Vincular Empresa</label>
                <SearchableSelect
                  value={isSuperConsultor ? (newUser.is_consultor ? '' : String(newUser.empresa_id)) : String(currentUser?.empresa_id || 0)}
                  onChange={(val) => setNewUser({...newUser, empresa_id: Number(val)})}
                  disabled={!isSuperConsultor || newUser.is_consultor}
                  options={[{
                    label: 'Empresas',
                    options: [
                      { id: '', label: newUser.is_consultor ? '-- Consultores acessam múltiplas empresas --' : '-- Selecione a empresa --' },
                      ...(!newUser.is_consultor ? (isSuperConsultor ? empresas : empresas.filter(emp => emp.id === currentUser?.empresa_id)).map(emp => ({ id: String(emp.id), label: emp.nome_fantasia || emp.razao_social })) : [])
                    ]
                  }]}
                />
              </div>
              {isSuperConsultor ? (
                <div className="flex items-center gap-2 pt-2 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <input type="checkbox" id="isConsultorCheck" checked={newUser.is_consultor} onChange={e => setNewUser({...newUser, is_consultor: e.target.checked})} className="w-4 h-4 text-blue-600 rounded" />
                  <label htmlFor="isConsultorCheck" className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none">Dar permissão de <strong>Consultor</strong>?</label>
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500 dark:bg-slate-700/50 dark:text-slate-300">
                  Usuários criados aqui ficam vinculados à empresa em contexto.
                </div>
              )}
              <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 mt-4 cursor-pointer">
                Criar Usuário
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}