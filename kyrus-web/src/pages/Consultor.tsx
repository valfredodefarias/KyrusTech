import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BankAvatar } from '../components/BrandAvatar';
import { api, toPublicAssetUrl } from '../services/api';
import { useBankPresetStore, type BankPreset } from '../store/bankPresetStore';
import { PlanoContasManager } from './Importacao';
import type { ItemSistema } from './Importacao';
import { 
  Building2, Search, UserPlus, ArrowRightLeft, Briefcase, Upload, X, Loader2, Pencil, Users, Shield, Plus, Trash2, ChevronDown, ChevronUp, Landmark,
  ClipboardList, CheckCircle2, Circle, KeyRound, Sparkles, BarChart3, Layers
} from 'lucide-react';

// --- TIPAGENS ---
interface Empresa {
  id: number;
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  logo_url?: string;
  cor_primaria?: string;
  is_active?: boolean;
}

interface Consultor {
  id: number;
  nome: string;
  email: string;
  consultor_role: string;
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

interface TodoItem {
  id: number;
  titulo: string;
  descricao?: string | null;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | string;
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | string;
  due_date?: string | null;
  periodicidade?: 'UNICA' | 'DIARIA' | 'SEMANAL' | string;
  dias_semana?: string | null;
  inclui_sabado?: boolean;
  tipo_alvo: 'EMPRESA' | 'CONSULTOR' | string;
  empresa_id?: number | null;
  consultor_id?: number | null;
  last_started_at?: string | null;
  finished_at?: string | null;
  total_seconds?: number;
}

interface TodoForm {
  titulo: string;
  descricao: string;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO';
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA';
  due_date: string;
  end_date: string;
  periodicidade: 'UNICA' | 'DIARIA' | 'SEMANAL';
  dias_semana: string[];
  inclui_sabado: boolean;
  tipo_alvo: 'EMPRESA' | 'CONSULTOR';
  empresa_id: number;
  consultor_id: number;
}

// Interface unificada para Criar ou Editar
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
  if (status === 405) return 'O servidor recusou o metodo HTTP dessa operacao. Isso normalmente indica incompatibilidade entre a rota da tela e a rota publicada no backend.';
  if (status) return `${fallback} (HTTP ${status})`;
  return fallback;
}

// --- COMPONENTE AVATAR ---
const AvatarEmpresa = ({ nome, src, cor }: { nome: string, src?: string, cor: string }) => {
  const [error, setError] = useState(false);
  const iniciais = nome.substring(0, 2).toUpperCase();
  const fullSrc = toPublicAssetUrl(src) || undefined;

  if (!src || error) {
    return (
      <div 
        className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center font-bold text-lg shadow-sm text-white"
        style={{ backgroundColor: cor }}
      >
        {iniciais}
      </div>
    );
  }

  return (
    <div className="w-14 h-14 rounded-lg shrink-0 bg-white flex items-center justify-center border border-slate-200 overflow-hidden shadow-sm">
      <img 
        src={fullSrc} 
        alt={nome} 
        className="w-full h-full object-contain p-1" 
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
    <div className="space-y-2" ref={wrapperRef}>
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</p>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar categoria..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-700 outline-none focus:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <span>{placeholder}</span>
              {value === null ? <CheckCircle2 className="h-4 w-4 text-amber-500" /> : null}
            </button>
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChange(item.id);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 last:border-b-0 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="truncate">{item.label}</span>
                {value === item.id ? <CheckCircle2 className="h-4 w-4 text-amber-500" /> : null}
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">Nenhuma categoria encontrada.</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export function Consultor() {
  const navigate = useNavigate();
  const setBankPresetStore = useBankPresetStore((state) => state.setPresets);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [consultores, setConsultores] = useState<Consultor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSuperConsultor, setIsSuperConsultor] = useState(false);
  
  // Modais
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEmpresaModal, setShowEmpresaModal] = useState(false);
  const [showTrocaModal, setShowTrocaModal] = useState(false);
  const [targetEmpresa, setTargetEmpresa] = useState<Empresa | null>(null);

  // Super-Consultor Management
  const [selectedConsultor, setSelectedConsultor] = useState<Consultor | null>(null);
  const [consultorEmpresas, setConsultorEmpresas] = useState<ConsultorEmpresa[]>([]);
  const [loadingConsultorEmpresas, setLoadingConsultorEmpresas] = useState(false);
  const [expandedConsultorId, setExpandedConsultorId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'empresas' | 'consultores' | 'planos-padrao' | 'bancos' | 'usuarios' | 'tarefas'>('empresas');

  // Usuários
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);

  // Tarefas
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loadingTodos, setLoadingTodos] = useState(false);
  const [todoFiltro, setTodoFiltro] = useState<'TODOS' | 'HOJE' | 'ATRASADAS' | 'SEMANA' | 'PERIODO'>('TODOS');
  const [todoFiltroInicio, setTodoFiltroInicio] = useState('');
  const [todoFiltroFim, setTodoFiltroFim] = useState('');
  const [todoForm, setTodoForm] = useState<TodoForm>({
    titulo: '',
    descricao: '',
    status: 'PENDENTE',
    prioridade: 'MEDIA',
    due_date: '',
    end_date: '',
    periodicidade: 'UNICA',
    dias_semana: [],
    inclui_sabado: false,
    tipo_alvo: 'EMPRESA',
    empresa_id: 0,
    consultor_id: 0
  });

  const [todoView, setTodoView] = useState<'CONSULTOR' | 'EMPRESA'>('CONSULTOR');
  const [todoEmpresaId, setTodoEmpresaId] = useState<number | null>(null);
  const [todoConsultorId, setTodoConsultorId] = useState<number | null>(null);

  const [showTodoForm, setShowTodoForm] = useState(false);

  const [currentUser, setCurrentUser] = useState<{ id: number; email: string; consultor_role: string; empresa_id?: number | null } | null>(null);

  // States Formulários
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
  const [bankPresets, setBankPresets] = useState<BankPreset[]>([]);
  const [loadingBankPresets, setLoadingBankPresets] = useState(false);
  const [savingBankPreset, setSavingBankPreset] = useState(false);
  const [editingBankPresetKey, setEditingBankPresetKey] = useState<string | null>(null);
  const [bankPresetForm, setBankPresetForm] = useState<BankPresetForm>({
    key: '',
    label: '',
    bank_name: '',
    aliases: '',
    logo_url: '',
    sort_order: '0',
    is_active: true,
  });

  useEffect(() => {
    carregarEmpresas();
    verificarSuperConsultor();
  }, []);

  useEffect(() => {
    if (currentUser?.id && !todoConsultorId) setTodoConsultorId(currentUser.id);
  }, [currentUser, todoConsultorId]);

  useEffect(() => {
    const canManageSeedTemplates = currentUser?.email?.trim().toLowerCase() === 'cirocaue12@gmail.com';
    if (!isSuperConsultor || !canManageSeedTemplates || activeTab !== 'planos-padrao') return;
    carregarTemplatePlanoContas(templateTipoPessoa);
    carregarAutoAdjustmentConfig(templateTipoPessoa);
  }, [activeTab, isSuperConsultor, templateTipoPessoa, currentUser?.email]);

  useEffect(() => {
    if (!isSuperConsultor) return;
    if (selectedEmpresaAutoAdjustId) return;
    if (!empresas.length) return;
    setSelectedEmpresaAutoAdjustId(Number(empresas[0].id));
  }, [isSuperConsultor, empresas, selectedEmpresaAutoAdjustId]);

  useEffect(() => {
    const canManageSeedTemplates = currentUser?.email?.trim().toLowerCase() === 'cirocaue12@gmail.com';
    if (!isSuperConsultor || !canManageSeedTemplates || activeTab !== 'planos-padrao') return;
    if (!selectedEmpresaAutoAdjustId) return;
    carregarAutoAdjustmentEmpresaConfig(selectedEmpresaAutoAdjustId);
    carregarPlanoContasEmpresaOpcoes(selectedEmpresaAutoAdjustId);
  }, [activeTab, isSuperConsultor, currentUser?.email, selectedEmpresaAutoAdjustId]);

  useEffect(() => {
    if (!isSuperConsultor || activeTab !== 'bancos') return;
    void carregarBankPresets();
  }, [activeTab, isSuperConsultor]);

  async function verificarSuperConsultor() {
    try {
      const res = await api.get('/usuarios/me');
      const isSuper = res.data.consultor_role === 'SUPER_CONSULTOR';
      setCurrentUser({ id: res.data.id, email: res.data.email, consultor_role: res.data.consultor_role, empresa_id: res.data.empresa_id ?? null });
      setIsSuperConsultor(isSuper);
      if (isSuper) {
        carregarConsultores();
        carregarUsuarios();
      }
      carregarTodos();
    } catch (error) {
      console.error("Erro ao verificar role do usuário", error);
    }
  }

  async function carregarConsultores() {
    try {
      const res = await api.get('/consultor/super/consultores');
      // Backend retorna { id, nome, email, consultor_role }
      const formatted = res.data.map((c: any) => ({
        id: c.id,
        nome: c.nome || c.email,  // Usar nome real, fallback para email
        email: c.email,
        consultor_role: c.consultor_role
      }));
      setConsultores(formatted);
    } catch (error) {
      console.error("Erro ao listar consultores", error);
    }
  }

  async function carregarEmpresas() {
    try {
      const res = await api.get('/consultor/empresas'); 
      setEmpresas(res.data);
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
      setUsuarios(res.data);
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
      setTemplateCategorias(res.data || []);
    } catch (error) {
      const message = getApiErrorDetails(error, `Nao foi possivel carregar o template ${tipoPessoa}.`);
      console.error(`[CONSULTOR][TEMPLATE] Falha ao carregar template ${tipoPessoa}`, {
        status: (error as any)?.response?.status,
        detail: (error as any)?.response?.data,
        error,
      });
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
      alert('Configuração de ajuste automático salva com sucesso.');
    } catch (error) {
      console.error('[CONSULTOR][AUTO-AJUSTE] Falha ao salvar config', error);
      alert('Nao foi possivel salvar a configuração de ajuste automático.');
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
      console.error('[CONSULTOR][AUTO-AJUSTE][EMPRESA] Falha ao carregar config', error);
      setEmpresaAutoAdjustConfig(null);
    } finally {
      setLoadingEmpresaAutoAdjust(false);
    }
  }

  async function carregarPlanoContasEmpresaOpcoes(empresaId: number) {
    try {
      const res = await api.get<EmpresaPlanoContasOption[]>(`/consultor/super/empresas/${empresaId}/plano-contas-opcoes`);
      setEmpresaPlanoOptions(res.data || []);
    } catch (error) {
      console.error('[CONSULTOR][AUTO-AJUSTE][EMPRESA] Falha ao carregar categorias', error);
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
      console.error('[CONSULTOR][AUTO-AJUSTE][EMPRESA] Falha ao salvar config', error);
      alert('Nao foi possivel salvar a configuração por empresa.');
    } finally {
      setSavingEmpresaAutoAdjust(false);
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
      setBankPresets(res.data || []);
      setBankPresetStore((res.data || []).filter((item) => item.is_active));
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
      console.error('Erro ao salvar preset de banco', error);
      alert('Nao foi possivel salvar o preset do banco.');
    } finally {
      setSavingBankPreset(false);
    }
  }

  async function handleDeleteBankPreset(presetKey: string) {
    if (!window.confirm('Deseja remover este banco global?')) return;
    try {
      await api.delete(`/bank-presets/${presetKey}`);
      await carregarBankPresets();
      if (editingBankPresetKey === presetKey) {
        resetBankPresetForm();
      }
    } catch (error) {
      console.error('Erro ao remover preset de banco', error);
      alert('Nao foi possivel remover o preset do banco.');
    }
  }

  async function carregarTodos() {
    try {
      setLoadingTodos(true);
      const res = await api.get('/consultor/todos');
      setTodos(res.data);
    } catch (error) {
      console.error("Erro ao listar tarefas", error);
    } finally {
      setLoadingTodos(false);
    }
  }

  async function desativarEmpresa(empresaId: number) {
    try {
      await api.post(`/consultor/super/empresas/${empresaId}/desativar`);
      carregarEmpresas();
    } catch (error) {
      console.error("Erro ao desativar empresa", error);
    }
  }

  async function ativarEmpresa(empresaId: number) {
    try {
      await api.post(`/consultor/super/empresas/${empresaId}/ativar`);
      carregarEmpresas();
    } catch (error) {
      console.error("Erro ao ativar empresa", error);
    }
  }

  async function deletarEmpresa(empresaId: number) {
    try {
      if (!window.confirm('Deseja realmente deletar esta empresa?')) return;
      await api.delete(`/consultor/super/empresas/${empresaId}`);
      carregarEmpresas();
    } catch (error) {
      console.error("Erro ao deletar empresa", error);
    }
  }

  async function desativarUsuario(userId: number) {
    try {
      await api.post(`/consultor/super/usuarios/${userId}/desativar`);
      carregarUsuarios();
    } catch (error) {
      console.error("Erro ao desativar usuário", error);
    }
  }

  async function ativarUsuario(userId: number) {
    try {
      await api.post(`/consultor/super/usuarios/${userId}/ativar`);
      carregarUsuarios();
    } catch (error) {
      console.error("Erro ao ativar usuário", error);
    }
  }

  async function resetarSenhaUsuario(userId: number) {
    const novaSenha = window.prompt('Digite a nova senha:');
    if (!novaSenha) return;
    try {
      await api.post(`/consultor/super/usuarios/${userId}/reset-senha`, { new_password: novaSenha });
      alert('Senha redefinida com sucesso');
    } catch (error) {
      console.error("Erro ao redefinir senha", error);
      alert('Erro ao redefinir senha');
    }
  }

  async function deletarUsuario(userId: number) {
    try {
      if (!window.confirm('Deseja realmente deletar este usuário?')) return;
      await api.delete(`/consultor/super/usuarios/${userId}`);
      carregarUsuarios();
    } catch (error) {
      console.error("Erro ao deletar usuário", error);
    }
  }

  async function criarTodo(e: React.FormEvent) {
    e.preventDefault();
    try {
      const toIsoDateTime = (value: string) => {
        if (!value) return null;
        return value.includes('T') ? value : `${value}T00:00:00`;
      };
      const payload: any = {
        titulo: todoForm.titulo,
        descricao: todoForm.descricao || null,
        status: 'PENDENTE',
        prioridade: todoForm.prioridade,
        due_date: toIsoDateTime(todoForm.due_date),
        end_date: todoForm.periodicidade === 'UNICA' ? null : toIsoDateTime(todoForm.end_date),
        periodicidade: todoForm.periodicidade,
        dias_semana: todoForm.dias_semana.length ? todoForm.dias_semana.join(',') : null,
        inclui_sabado: todoForm.inclui_sabado,
        tipo_alvo: todoForm.tipo_alvo,
        empresa_id: todoForm.tipo_alvo === 'EMPRESA' ? (todoForm.empresa_id || null) : null,
        consultor_id: todoForm.tipo_alvo === 'CONSULTOR' ? (todoForm.consultor_id || (currentUser?.id ?? null)) : null
      };
      await api.post('/consultor/todos', payload);
      setTodoForm({
        titulo: '',
        descricao: '',
        status: 'PENDENTE',
        prioridade: 'MEDIA',
        due_date: '',
        end_date: '',
        periodicidade: 'UNICA',
        dias_semana: [],
        inclui_sabado: false,
        tipo_alvo: 'EMPRESA',
        empresa_id: 0,
        consultor_id: 0
      });
      carregarTodos();
    } catch (error) {
      console.error("Erro ao criar tarefa", error);
    }
  }

  async function atualizarStatusTodo(todoId: number, status: TodoItem['status']) {
    try {
      setTodos(prev => prev.map(t => t.id === todoId ? { ...t, status } : t));
      await api.patch(`/consultor/todos/${todoId}`, { status });
    } catch (error) {
      console.error("Erro ao atualizar status", error);
      carregarTodos();
    }
  }

  async function deletarTodo(todoId: number) {
    try {
      await api.delete(`/consultor/todos/${todoId}`);
      carregarTodos();
    } catch (error) {
      console.error("Erro ao deletar tarefa", error);
    }
  }

  function formatDuration(totalSeconds?: number) {
    const secs = Math.max(0, totalSeconds || 0);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m}m ${s}s`;
  }

  function parseDateOnly(value?: string | null) {
    if (!value) return null;
    const datePart = value.slice(0, 10);
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function isOverdue(todo: TodoItem) {
    const due = parseDateOnly(todo.due_date);
    if (!due) return false;
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return todo.status !== 'CONCLUIDO' && due < today;
  }

  function isCompletedLate(todo: TodoItem) {
    const due = parseDateOnly(todo.due_date);
    const finished = parseDateOnly(todo.finished_at);
    if (!due || !finished) return false;
    due.setHours(0, 0, 0, 0);
    finished.setHours(0, 0, 0, 0);
    return todo.status === 'CONCLUIDO' && finished > due;
  }

  function isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  const todosBase = useMemo(() => {
    if (todoView === 'CONSULTOR') {
      return todos.filter(t => t.tipo_alvo === 'CONSULTOR' && (!todoConsultorId || Number(t.consultor_id) === Number(todoConsultorId)));
    }
    return todos.filter(t => t.tipo_alvo === 'EMPRESA' && (!todoEmpresaId || Number(t.empresa_id) === Number(todoEmpresaId)));
  }, [todos, todoView, todoConsultorId, todoEmpresaId]);

  const empresasComAtividade = useMemo(() => {
    const ids = new Set<number>();
    todos.filter(t => t.tipo_alvo === 'EMPRESA' && t.empresa_id).forEach(t => ids.add(Number(t.empresa_id)));
    return empresas.filter(e => ids.has(e.id));
  }, [todos, empresas]);

  const todosFiltrados = useMemo(() => {
    if (todoFiltro === 'TODOS') return todosBase;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return todosBase.filter(todo => {
      const due = parseDateOnly(todo.due_date);
      if (todoFiltro === 'ATRASADAS') return isOverdue(todo);
      if (todoFiltro === 'HOJE') return due ? isSameDay(due, today) : false;
      if (todoFiltro === 'SEMANA') return due ? (due >= today && due <= weekEnd) : false;
      if (todoFiltro === 'PERIODO') {
        if (!todoFiltroInicio || !todoFiltroFim) return true;
        const start = parseDateOnly(todoFiltroInicio);
        const end = parseDateOnly(todoFiltroFim);
        if (!start || !end || !due) return false;
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        return due >= start && due <= end;
      }
      return true;
    });
  }, [todosBase, todoFiltro, todoFiltroInicio, todoFiltroFim]);

  const todoResumo = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const summary = {
      amanha: 0,
      semana: 0,
      futuras: 0,
      atrasadas: 0,
      concluidas_atraso: 0
    };

    const list = todosBase;
    list.forEach(t => {
      const due = parseDateOnly(t.due_date);
      if (t.status !== 'CONCLUIDO' && t.status !== 'CANCELADO') {
        if (due && isSameDay(due, tomorrow)) summary.amanha += 1;
        if (due && due >= today && due <= weekEnd) summary.semana += 1;
        if (due && due > weekEnd) summary.futuras += 1;
        if (isOverdue(t)) summary.atrasadas += 1;
      }
      if (isCompletedLate(t)) summary.concluidas_atraso += 1;
    });

    return summary;
  }, [todosBase]);

  const produtividade = useMemo(() => {
    const total = todosBase.length;
    const concluidas = todosBase.filter(t => t.status === 'CONCLUIDO');
    const concluidasCount = concluidas.length;
    const noPrazo = concluidas.filter(t => !t.due_date).length;
    const pontuais = concluidas.filter(t => !isCompletedLate(t)).length;
    const totalSeconds = concluidas.reduce((acc, t) => acc + (t.total_seconds || 0), 0);
    const avgSeconds = concluidasCount ? Math.round(totalSeconds / concluidasCount) : 0;
    const conclusaoPct = total ? Math.round((concluidasCount / total) * 100) : 0;
    const pontualidadePct = concluidasCount ? Math.round((pontuais / concluidasCount) * 100) : 0;
    return { total, concluidasCount, conclusaoPct, pontualidadePct, avgSeconds, noPrazo };
  }, [todosBase]);

  // --- ABRIR MODAL (CRIAR OU EDITAR) ---
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
      console.error(error);
    }
  }

  // --- SUBMIT USUÁRIO ---
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      // Se for consultor, não envia empresa_id (será null/0)
      const payload = {
        ...newUser,
        empresa_id: isSuperConsultor
          ? (newUser.is_consultor ? null : (newUser.empresa_id || null))
          : (currentUser?.empresa_id || null),
        is_consultor: isSuperConsultor ? newUser.is_consultor : false,
      };
      await api.post('/usuarios/', payload);
      setShowUserModal(false);
      setNewUser({ nome: '', email: '', password: '', empresa_id: 0, is_consultor: false });
      // Recarregar consultores se for super-consultor
      if (isSuperConsultor) {
        carregarConsultores();
        carregarUsuarios();
      }
    } catch (error) {
      console.error(error);
      const detail = (error as any)?.response?.data?.detail;
      alert(typeof detail === 'string' ? detail : 'Erro ao criar usuário');
    }
  }

  async function abrirConsultorModal(consultor: Consultor) {
    setSelectedConsultor(consultor);
    setLoadingConsultorEmpresas(true);
    setExpandedConsultorId(consultor.id);
    
    try {
      const res = await api.get(`/consultor/super/consultores/${consultor.id}/empresas`);
      // Backend retorna array de { acesso_id, empresa_id, nome_fantasia, ativo }
      const formatted = res.data.map((ce: any) => ({
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
      // Recarregar empresas do consultor
      const res = await api.get(`/consultor/super/consultores/${consultorId}/empresas`);
      const formatted = res.data.map((ce: any) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
    } catch (error) {
      console.error("Erro ao adicionar empresa", error);
    }
  }

  async function removerEmpresaDoConsultor(consultorId: number, empresaId: number) {
    try {
      await api.post(`/consultor/super/consultores/${consultorId}/empresas/${empresaId}/revogar`);
      // Recarregar empresas do consultor
      const res = await api.get(`/consultor/super/consultores/${consultorId}/empresas`);
      const formatted = res.data.map((ce: any) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
    } catch (error) {
      console.error("Erro ao remover empresa", error);
    }
  }

  async function mudarRoleConsultor(consultorId: number) {
    try {
      const consultor = consultores.find(c => c.id === consultorId);
      if (!consultor) return;
      
      // Alternar role: CONSULTOR <-> SUPER_CONSULTOR
      const novoRole = consultor.consultor_role === 'SUPER_CONSULTOR' ? 'CONSULTOR' : 'SUPER_CONSULTOR';
      
      await api.post(`/consultor/super/consultores/${consultorId}/role`, { role: novoRole });
      // Recarregar lista de consultores
      carregarConsultores();
      if (selectedConsultor?.id === consultorId) {
        const updated = consultores.find(c => c.id === consultorId);
        if (updated) setSelectedConsultor({ ...updated, consultor_role: novoRole });
      }
    } catch (error) {
      console.error("Erro ao mudar role", error);
    }
  }

  async function confirmarTroca() {
    if (!targetEmpresa) return;
    try {
      // 1. Chama a API real (seu arquivo consultor.py)
      await api.post('/consultor/trocar-empresa', { empresa_id: targetEmpresa.id });
      
      // 2. Força recarregamento para atualizar Sidebar e Dashboard
      window.location.href = '/home'; 
    } catch (error) {
      console.error("Erro ao trocar empresa", error);
      setShowTrocaModal(false);
    }
  }

  // --- LÓGICA DE TROCA DE CONTEXTO ---
  function solicitarTroca(emp: Empresa) {
    setTargetEmpresa(emp);
    setShowTrocaModal(true);
  }

  const empresasFiltradas = empresas.filter(emp => 
    emp.nome_fantasia.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.razao_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.cnpj?.includes(searchTerm)
  );

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

  if (loading) return <div className="p-8 text-center text-slate-500 animate-pulse">Carregando...</div>;

  const canCreateTodo = (() => {
    if (!todoForm.titulo.trim()) return false;
    if (!todoForm.due_date) return false;
    if (todoForm.periodicidade !== 'UNICA' && !todoForm.end_date) return false;
    if (todoForm.periodicidade === 'SEMANAL' && todoForm.dias_semana.length === 0) return false;
    if (todoForm.tipo_alvo === 'EMPRESA' && !todoForm.empresa_id) return false;
    if (todoForm.tipo_alvo === 'CONSULTOR' && !(todoForm.consultor_id || currentUser?.id)) return false;
    return true;
  })();

  const empresasAtivas = empresas.filter((empresa) => empresa.is_active !== false).length;
  const usuariosAtivos = usuarios.filter((usuario) => usuario.is_active).length;
  const modeLabel = isSuperConsultor ? 'Super consultoria com visão global' : 'Consultoria com escopo autorizado';
  const canManageSeedTemplates = currentUser?.email?.trim().toLowerCase() === 'cirocaue12@gmail.com';
  const tabItems = [
    { key: 'empresas' as const, label: 'Minhas Empresas', icon: Building2, visible: true },
    { key: 'consultores' as const, label: 'Gerenciar Consultores', icon: Users, visible: isSuperConsultor },
    { key: 'planos-padrao' as const, label: 'Planos Padrão', icon: Layers, visible: isSuperConsultor && !!canManageSeedTemplates },
    { key: 'bancos' as const, label: 'Bancos Globais', icon: Landmark, visible: isSuperConsultor },
    { key: 'usuarios' as const, label: 'Usuários', icon: Shield, visible: isSuperConsultor },
    { key: 'tarefas' as const, label: 'To-do', icon: ClipboardList, visible: true },
  ].filter((item) => item.visible);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_26%),linear-gradient(135deg,#ffffff_0%,#f8fafc_46%,#eff6ff_100%)] p-5 shadow-sm dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_34%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_46%,rgba(30,41,59,0.92)_100%)] sm:p-6">
        <div className="absolute -right-8 top-0 h-40 w-40 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="absolute -left-6 bottom-0 h-36 w-36 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <Briefcase className="h-3.5 w-3.5 text-blue-600" />
                Operação consultiva
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Área do Consultor</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Controle empresas, consultores, usuários e tarefas a partir de uma visão única. O topo resume carga operacional, cobertura do time e foco imediato.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              {isSuperConsultor && (
                <button onClick={handleOpenCreate} className="rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
                  <Building2 size={18} /> Nova Empresa
                </button>
              )}
              <button onClick={() => setShowUserModal(true)} className="rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20">
                <UserPlus size={18} /> Novo Usuário
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Modo de acesso</p>
              <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">{modeLabel}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Perfil atual: {currentUser?.consultor_role || 'CONSULTOR'}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Empresas ativas</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{empresasAtivas}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{empresas.length} empresas carregadas na visão atual.</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Consultores</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{consultores.length}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{isSuperConsultor ? 'Rede completa de consultoria carregada.' : 'Visão restrita ao seu escopo atual.'}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Pulso de tarefas</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{todoResumo.atrasadas}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Atrasadas agora. Conclusão: {produtividade.conclusaoPct}% • Usuários ativos: {usuariosAtivos}</p>
            </div>
          </div>

          {isSuperConsultor && (
            <div className="rounded-3xl border border-emerald-200 bg-white/80 p-4 backdrop-blur dark:border-emerald-900 dark:bg-slate-900/40">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    Governança do dashboard
                  </div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white">Padrão global do dashboard</h2>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Abra o Dashboard em modo de padrão global para editar a vista base real de todas as empresas. Nesse modo, o sistema não cria uma vista da empresa: ele altera o padrão compartilhado.</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard?globalDefault=1')}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
                >
                  <BarChart3 size={18} />
                  Editar padrão global
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="rounded-3xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
        <div className="flex flex-wrap gap-2 overflow-x-auto">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition ${isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-700'}`}
              >
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SEARCH */}
      {activeTab === 'empresas' && (
      <div className="relative group">
        <Search className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
        <input 
          type="text" placeholder="Pesquisar por nome ou razão social..." 
          className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition shadow-sm"
          value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      )}

      {/* ABA EMPRESAS */}
      {activeTab === 'empresas' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {empresasFiltradas.map(emp => {
          const cor = emp.cor_primaria || '#2563eb';
          const isActive = emp.is_active !== false;
          return (
            <div key={emp.id} className="relative rounded-xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 group border flex flex-col justify-between"
              style={{ background: `linear-gradient(145deg, ${cor}08 0%, ${cor}15 100%)`, borderColor: `${cor}30` }}>
              
              {/* Botão de Editar */}
              <button onClick={() => handleOpenEdit(emp)} className="absolute top-3 right-3 p-2 rounded-full hover:bg-white/50 dark:hover:bg-black/20 text-slate-400 hover:text-blue-600 transition" title="Editar">
                <Pencil size={16} />
              </button>

              <span className={`absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                {isActive ? 'ATIVA' : 'INATIVA'}
              </span>

              <div className="flex items-center gap-4 mb-6">
                <AvatarEmpresa nome={emp.nome_fantasia} src={emp.logo_url} cor={cor} />
                <div className="min-w-0 flex-1">
                  {/* Nome com Truncate para não vazar */}
                  <h3 className="font-bold text-slate-800 dark:text-white text-lg leading-tight truncate" title={emp.nome_fantasia}>
                    {emp.nome_fantasia}
                  </h3>
                  <p className="text-xs font-mono opacity-60 dark:text-slate-300 mt-0.5">ID: {emp.id}</p>
                </div>
              </div>

              <div className="flex gap-2 mt-auto">
                <button 
                  onClick={() => solicitarTroca(emp)}
                  disabled={!isActive}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{ backgroundColor: cor, color: '#fff' }}
                >
                  <ArrowRightLeft size={16} /> Acessar
                </button>
                {isSuperConsultor && (
                  <button
                    onClick={() => (isActive ? desativarEmpresa(emp.id) : ativarEmpresa(emp.id))}
                    className={`px-3 py-2.5 rounded-lg text-xs font-bold border transition ${
                      isActive ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    {isActive ? 'Desativar' : 'Ativar'}
                  </button>
                )}
              </div>

              {isSuperConsultor && (
                <button
                  onClick={() => deletarEmpresa(emp.id)}
                  className="mt-2 w-full py-2 text-xs font-bold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition flex items-center justify-center gap-1"
                >
                  <Trash2 size={14} /> Deletar
                </button>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* ABA GERENCIAR CONSULTORES (SUPER-CONSULTOR ONLY) */}
      {activeTab === 'consultores' && isSuperConsultor && (
      <div className="space-y-4">
        {consultores.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
            <Users size={32} className="mx-auto mb-2 text-slate-400" />
            <p className="text-slate-500 dark:text-slate-400">Nenhum consultor encontrado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {consultores.map(consultor => (
              <div key={consultor.id} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <button 
                  onClick={() => abrirConsultorModal(consultor)}
                  className="w-full text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 p-2 rounded transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-linear-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
                      {consultor.nome.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">{consultor.nome}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{consultor.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                      consultor.consultor_role === 'SUPER_CONSULTOR' 
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' 
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    }`}>
                      {consultor.consultor_role === 'SUPER_CONSULTOR' ? '👑 Super' : '📊 Consultor'}
                    </span>
                    {expandedConsultorId === consultor.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </button>

                {/* Expandir detalhes */}
                {expandedConsultorId === consultor.id && (
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    {/* Empresas do Consultor */}
                    <div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Empresas Vinculadas:</p>
                      {loadingConsultorEmpresas ? (
                        <p className="text-xs text-slate-500">Carregando...</p>
                      ) : consultorEmpresas.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma empresa vinculada</p>
                      ) : (
                        <div className="space-y-2">
                          {consultorEmpresas.map(ce => (
                            <div key={ce.empresa_id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 p-2 rounded text-sm">
                              <span className="text-slate-700 dark:text-slate-300">{ce.empresa_nome}</span>
                              <button 
                                onClick={() => removerEmpresaDoConsultor(consultor.id, ce.empresa_id)}
                                className="text-red-600 hover:text-red-700 dark:text-red-400 transition"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Adicionar Empresa */}
                    <div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Adicionar Empresa:</p>
                      <div className="grid grid-cols-2 gap-2">
                        {empresas.map(emp => {
                          const jaTemAcesso = consultorEmpresas.some(ce => ce.empresa_id === emp.id);
                          return (
                            <button 
                              key={emp.id}
                              onClick={() => adicionarEmpresaAoConsultor(consultor.id, emp.id)}
                              disabled={jaTemAcesso}
                              className={`px-3 py-2 rounded text-xs font-bold flex items-center gap-1 transition ${
                                jaTemAcesso 
                                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed' 
                                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200'
                              }`}
                            >
                              <Plus size={14} /> {emp.nome_fantasia.substring(0, 12)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Mudar Role */}
                    <div>
                      <button 
                        onClick={() => mudarRoleConsultor(consultor.id)}
                        className="w-full px-3 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded font-bold text-sm hover:bg-amber-200 transition flex items-center justify-center gap-2"
                      >
                        <Shield size={16} /> 
                        {consultor.consultor_role === 'CONSULTOR' ? 'Promover para Super-Consultor' : 'Rebaixar para Consultor'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {activeTab === 'planos-padrao' && isSuperConsultor && canManageSeedTemplates && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-blue-700 dark:border-blue-900 dark:bg-blue-500/10 dark:text-blue-300">
                  <Layers className="h-3.5 w-3.5" />
                  Templates globais
                </div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">Plano de contas padrão PF e PJ</h2>
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">O que você editar aqui passa a ser a base usada em novas empresas. Super consultor pode estruturar, mover, criar subcategorias e marcar categorias operacionais com herança para as filhas.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateTipoPessoa('PJ')}
                  className={`rounded-2xl px-4 py-2.5 text-sm font-bold transition ${templateTipoPessoa === 'PJ' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                >
                  Pessoa Juridica
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateTipoPessoa('PF')}
                  className={`rounded-2xl px-4 py-2.5 text-sm font-bold transition ${templateTipoPessoa === 'PF' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                >
                  Pessoa Fisica
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm dark:border-amber-900 dark:bg-amber-500/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Ajuste automatico global</p>
                <h3 className="mt-2 text-lg font-black text-slate-900 dark:text-white">Categorias padrao para diferencas de pagamento</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Despesa paga acima do previsto gera Juros/Multa. Receita recebida abaixo do previsto gera Desconto.</p>
              </div>
              <button
                type="button"
                onClick={salvarAutoAdjustmentConfig}
                disabled={!autoAdjustConfig || loadingAutoAdjustConfig || savingAutoAdjustConfig}
                className="rounded-2xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingAutoAdjustConfig ? 'Salvando...' : 'Salvar configuracao'}
              </button>
            </div>

            {loadingAutoAdjustConfig ? (
              <div className="mt-4 text-sm text-slate-500 dark:text-slate-300">Carregando configuracao de ajuste automatico...</div>
            ) : autoAdjustConfig ? (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                  <SearchableCategorySelect
                    label="Juros e multa (despesa maior que prevista)"
                    placeholder="Sem categoria fixa (usar padrao interno)"
                    value={autoAdjustConfig.juros_multa_template_id}
                    options={templateCategoriaOptions}
                    onChange={(nextValue) => setAutoAdjustConfig((prev) => prev ? ({ ...prev, juros_multa_template_id: nextValue }) : prev)}
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Atual: {autoAdjustConfig.juros_multa_categoria_nome} ({autoAdjustConfig.juros_multa_dre_grupo})</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                  <SearchableCategorySelect
                    label="Descontos (receita menor que prevista)"
                    placeholder="Sem categoria fixa (usar padrao interno)"
                    value={autoAdjustConfig.descontos_template_id}
                    options={templateCategoriaOptions}
                    onChange={(nextValue) => setAutoAdjustConfig((prev) => prev ? ({ ...prev, descontos_template_id: nextValue }) : prev)}
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Atual: {autoAdjustConfig.descontos_categoria_nome} ({autoAdjustConfig.descontos_dre_grupo})</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-rose-600 dark:text-rose-300">Nao foi possivel carregar a configuracao de ajuste automatico.</div>
            )}
          </div>

          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm dark:border-emerald-900 dark:bg-emerald-500/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Ajuste automatico por empresa</p>
                <h3 className="mt-2 text-lg font-black text-slate-900 dark:text-white">Selecionar categorias no plano de contas da empresa</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Se a categoria escolhida não existir mais, o sistema cria automaticamente usando os defaults salvos.</p>
              </div>
              <button
                type="button"
                onClick={salvarAutoAdjustmentEmpresaConfig}
                disabled={!empresaAutoAdjustConfig || !selectedEmpresaAutoAdjustId || loadingEmpresaAutoAdjust || savingEmpresaAutoAdjust}
                className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingEmpresaAutoAdjust ? 'Salvando...' : 'Salvar por empresa'}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr_2fr]">
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                <p className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-100">Empresa</p>
                <select
                  value={selectedEmpresaAutoAdjustId ?? ''}
                  onChange={(e) => setSelectedEmpresaAutoAdjustId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="">Selecione a empresa</option>
                  {empresas.map((empresa) => (
                    <option key={empresa.id} value={empresa.id}>{empresa.nome_fantasia}</option>
                  ))}
                </select>
                {empresaAutoAdjustConfig?.tipo_pessoa ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Tipo pessoa: {empresaAutoAdjustConfig.tipo_pessoa}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                {loadingEmpresaAutoAdjust ? (
                  <p className="text-sm text-slate-500 dark:text-slate-300">Carregando configuração da empresa...</p>
                ) : empresaAutoAdjustConfig ? (
                  <>
                    <SearchableCategorySelect
                      label="Juros e multa (empresa)"
                      placeholder="Sem categoria fixa (criar automaticamente)"
                      value={empresaAutoAdjustConfig.juros_multa_plano_contas_id}
                      options={empresaCategoriaOptions}
                      onChange={(nextValue) => setEmpresaAutoAdjustConfig((prev) => prev ? ({ ...prev, juros_multa_plano_contas_id: nextValue }) : prev)}
                    />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Atual: {empresaAutoAdjustConfig.juros_multa_categoria_nome} ({empresaAutoAdjustConfig.juros_multa_dre_grupo})</p>
                  </>
                ) : (
                  <p className="text-sm text-rose-600 dark:text-rose-300">Selecione uma empresa para carregar.</p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                {loadingEmpresaAutoAdjust ? (
                  <p className="text-sm text-slate-500 dark:text-slate-300">Carregando configuração da empresa...</p>
                ) : empresaAutoAdjustConfig ? (
                  <>
                    <SearchableCategorySelect
                      label="Descontos (empresa)"
                      placeholder="Sem categoria fixa (criar automaticamente)"
                      value={empresaAutoAdjustConfig.descontos_plano_contas_id}
                      options={empresaCategoriaOptions}
                      onChange={(nextValue) => setEmpresaAutoAdjustConfig((prev) => prev ? ({ ...prev, descontos_plano_contas_id: nextValue }) : prev)}
                    />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Atual: {empresaAutoAdjustConfig.descontos_categoria_nome} ({empresaAutoAdjustConfig.descontos_dre_grupo})</p>
                  </>
                ) : (
                  <p className="text-sm text-rose-600 dark:text-rose-300">Selecione uma empresa para carregar.</p>
                )}
              </div>
            </div>
          </div>

          {loadingTemplateCategorias ? (
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-300">Carregando template {templateTipoPessoa}...</p>
            </div>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
              {templateCategoriasError && (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">
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

      {activeTab === 'bancos' && isSuperConsultor && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <Landmark className="h-3.5 w-3.5" />
                  Presets globais
                </div>
                <h2 className="mt-3 text-xl font-black text-slate-900 dark:text-white">Bancos usados em todo o sistema</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">O que você alterar aqui passa a aparecer no formulário de contas e entra como segunda prioridade de imagem no boletim, atrás apenas da logo personalizada da conta.</p>
              </div>
              <button
                type="button"
                onClick={resetBankPresetForm}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Novo preset
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {loadingBankPresets ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">Carregando bancos globais...</div>
              ) : bankPresets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">Nenhum preset cadastrado.</div>
              ) : (
                bankPresets.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <BankAvatar logoUrl={item.logo_url} bankName={item.bank_name} accountName={item.label} size="md" className="h-14 w-14" imageClassName="rounded-xl" fallbackClassName="rounded-xl border-0 shadow-none" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-slate-900 dark:text-white">{item.label}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                              {item.is_active ? 'ATIVO' : 'INATIVO'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-300">Banco base: {item.bank_name}</p>
                          <p className="mt-1 text-xs text-slate-400">Aliases: {(item.aliases || []).join(', ') || 'Sem aliases'}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEditBankPreset(item)}
                          className="inline-flex items-center gap-1 rounded-xl border border-blue-200 px-3 py-2 text-xs font-bold text-blue-600 transition hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-500/10"
                        >
                          <Pencil size={14} /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBankPreset(item.key)}
                          className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-500/10"
                        >
                          <Trash2 size={14} /> Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">{editingBankPresetKey ? 'Editar banco global' : 'Cadastrar banco global'}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Defina nome, aliases e imagem padrão para reaproveitar em todos os formulários.</p>
              </div>
              {editingBankPresetKey && (
                <button type="button" onClick={resetBankPresetForm} className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white">Cancelar edição</button>
              )}
            </div>

            <form onSubmit={handleSubmitBankPreset} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome exibido</label>
                  <input
                    type="text"
                    value={bankPresetForm.label}
                    onChange={(e) => setBankPresetForm((prev) => ({ ...prev, label: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
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
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Ex: Banco do Brasil"
                    required
                  />
                </div>
                {!editingBankPresetKey && (
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Chave</label>
                    <input
                      type="text"
                      value={bankPresetForm.key}
                      onChange={(e) => setBankPresetForm((prev) => ({ ...prev, key: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                      placeholder="Ex: banco-do-brasil"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Ordem</label>
                  <input
                    type="number"
                    value={bankPresetForm.sort_order}
                    onChange={(e) => setBankPresetForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Aliases</label>
                <input
                  type="text"
                  value={bankPresetForm.aliases}
                  onChange={(e) => setBankPresetForm((prev) => ({ ...prev, aliases: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Ex: BB, Banco Brasil"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Logo padrão</label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <BankAvatar logoUrl={bankPresetForm.logo_url} bankName={bankPresetForm.bank_name} accountName={bankPresetForm.label} size="md" className="h-16 w-16" imageClassName="rounded-xl" fallbackClassName="rounded-xl border-0 shadow-none" />
                    <div className="text-xs text-slate-500 dark:text-slate-300">Se a conta nao tiver imagem personalizada, essa logo sera usada no boletim e nas listas.</div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700">
                    <Upload size={16} /> Enviar imagem
                    <input type="file" accept="image/*" className="hidden" onChange={handleBankPresetLogoUpload} />
                  </label>
                </div>
                <input
                  type="text"
                  value={bankPresetForm.logo_url}
                  onChange={(e) => setBankPresetForm((prev) => ({ ...prev, logo_url: e.target.value }))}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="/static/... ou URL pública"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={bankPresetForm.is_active}
                  onChange={(e) => setBankPresetForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Preset ativo
              </label>

              <button
                type="submit"
                disabled={savingBankPreset || uploading}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {(savingBankPreset || uploading) && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingBankPresetKey ? 'Salvar alterações' : 'Criar preset'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ABA USUÁRIOS (SUPER-CONSULTOR ONLY) */}
      {activeTab === 'usuarios' && isSuperConsultor && (
        <div className="space-y-4">
          {loadingUsuarios ? (
            <div className="p-6 text-center text-slate-500">Carregando usuários...</div>
          ) : usuarios.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
              <Users size={32} className="mx-auto mb-2 text-slate-400" />
              <p className="text-slate-500 dark:text-slate-400">Nenhum usuário encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {usuarios.map(user => {
                const isSelf = currentUser?.id === user.id;
                return (
                  <div key={user.id} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-white">{user.nome || user.email}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                        <p className="text-xs text-slate-400">Empresa: {user.empresa_nome || '—'}</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {user.is_active ? 'ATIVO' : 'INATIVO'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => user.is_active ? desativarUsuario(user.id) : ativarUsuario(user.id)}
                        disabled={isSelf}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${user.is_active ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'} ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        {user.is_active ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        onClick={() => resetarSenhaUsuario(user.id)}
                        disabled={isSelf}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border border-blue-300 text-blue-600 hover:bg-blue-50 transition flex items-center gap-1 ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <KeyRound size={14} /> Redefinir Senha
                      </button>
                      <button
                        onClick={() => deletarUsuario(user.id)}
                        disabled={isSelf}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border border-red-300 text-red-600 hover:bg-red-50 transition flex items-center gap-1 ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <Trash2 size={14} /> Deletar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ABA TAREFAS */}
      {activeTab === 'tarefas' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Amanhã</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.amanha}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Na semana</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.semana}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Futuras</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.futuras}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Atrasadas</p>
              <p className="text-xl font-bold text-red-600">{todoResumo.atrasadas}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Concl. em atraso</p>
              <p className="text-xl font-bold text-amber-600">{todoResumo.concluidas_atraso}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setTodoView('CONSULTOR')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${todoView === 'CONSULTOR' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                Consultor
              </button>
              <button
                onClick={() => setTodoView('EMPRESA')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${todoView === 'EMPRESA' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                Empresas
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {todoView === 'CONSULTOR' && (
                <select
                  value={todoConsultorId || ''}
                  onChange={(e) => setTodoConsultorId(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-100"
                >
                  <option value={currentUser?.id || ''}>Meu usuário</option>
                  {isSuperConsultor && consultores.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              )}
              {todoView === 'EMPRESA' && (
                <select
                  value={todoEmpresaId || ''}
                  onChange={(e) => setTodoEmpresaId(e.target.value ? Number(e.target.value) : null)}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-100"
                >
                  <option value="">Todas empresas com atividade</option>
                  {empresasComAtividade.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.nome_fantasia}</option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={() => setShowTodoForm(prev => !prev)}
              className="px-4 py-2 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2"
            >
              <Plus size={16} /> {showTodoForm ? 'Ocultar formulário' : 'Nova Tarefa'}
            </button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 dark:text-white">Produtividade</h3>
              <span className="text-xs text-slate-400">{todoView === 'CONSULTOR' ? 'Consultor' : 'Empresas'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-[11px] text-slate-500">Conclusão</p>
                <p className="text-xl font-bold text-indigo-600">{produtividade.conclusaoPct}%</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-[11px] text-slate-500">Pontualidade</p>
                <p className="text-xl font-bold text-emerald-600">{produtividade.pontualidadePct}%</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-[11px] text-slate-500">Tempo médio</p>
                <p className="text-xl font-bold text-slate-700 dark:text-white">{formatDuration(produtividade.avgSeconds)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-[11px] text-slate-500">Sem prazo</p>
                <p className="text-xl font-bold text-amber-600">{produtividade.noPrazo}</p>
              </div>
            </div>
          </div>

          {showTodoForm && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
              <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <ClipboardList size={18} /> Nova Tarefa
              </h3>
              <form onSubmit={criarTodo} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Título</label>
                  <input
                    required
                    type="text"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                    value={todoForm.titulo}
                    onChange={e => setTodoForm({ ...todoForm, titulo: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Descrição</label>
                  <textarea
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                    value={todoForm.descricao}
                    onChange={e => setTodoForm({ ...todoForm, descricao: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Tipo de Alvo</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={todoForm.tipo_alvo}
                    onChange={e => setTodoForm({ ...todoForm, tipo_alvo: e.target.value as TodoForm['tipo_alvo'] })}
                  >
                    <option value="EMPRESA">Empresa</option>
                    <option value="CONSULTOR">Consultor</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Prioridade</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={todoForm.prioridade}
                    onChange={e => setTodoForm({ ...todoForm, prioridade: e.target.value as TodoForm['prioridade'] })}
                  >
                    <option value="BAIXA">Baixa</option>
                    <option value="MEDIA">Média</option>
                    <option value="ALTA">Alta</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Periodicidade</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={todoForm.periodicidade}
                    onChange={e => setTodoForm({ ...todoForm, periodicidade: e.target.value as TodoForm['periodicidade'] })}
                  >
                    <option value="UNICA">Única</option>
                    <option value="DIARIA">Todo dia</option>
                    <option value="SEMANAL">Semanal</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={todoForm.inclui_sabado}
                    onChange={e => setTodoForm({ ...todoForm, inclui_sabado: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600"
                  />
                  <label className="text-sm text-slate-600 dark:text-slate-300">Inclui sábado?</label>
                </div>
                {todoForm.periodicidade === 'SEMANAL' && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-500 mb-2 block">Dias da semana</label>
                    <div className="flex flex-wrap gap-2">
                      {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(dia => (
                        <label key={dia} className={`px-3 py-1 rounded-full text-xs font-bold border cursor-pointer ${todoForm.dias_semana.includes(dia) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={todoForm.dias_semana.includes(dia)}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...todoForm.dias_semana, dia]
                                : todoForm.dias_semana.filter(d => d !== dia);
                              setTodoForm({ ...todoForm, dias_semana: next });
                            }}
                          />
                          {dia}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {todoForm.tipo_alvo === 'EMPRESA' && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Empresa</label>
                    <select
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      value={todoForm.empresa_id}
                      onChange={e => setTodoForm({ ...todoForm, empresa_id: Number(e.target.value) })}
                    >
                      <option value={0}>-- Selecione --</option>
                      {empresas.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.nome_fantasia}</option>
                      ))}
                    </select>
                  </div>
                )}
                {todoForm.tipo_alvo === 'CONSULTOR' && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Consultor</label>
                    <select
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      value={todoForm.consultor_id || currentUser?.id || 0}
                      onChange={e => setTodoForm({ ...todoForm, consultor_id: Number(e.target.value) })}
                      disabled={!isSuperConsultor}
                    >
                      <option value={currentUser?.id || 0}>{currentUser?.email || 'Eu'}</option>
                      {isSuperConsultor && consultores.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Prazo</label>
                  <input
                    type="date"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                    value={todoForm.due_date}
                    onChange={e => setTodoForm({ ...todoForm, due_date: e.target.value })}
                  />
                </div>
                {todoForm.periodicidade !== 'UNICA' && (
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Data Fim</label>
                    <input
                      type="date"
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                      value={todoForm.end_date}
                      onChange={e => setTodoForm({ ...todoForm, end_date: e.target.value })}
                    />
                  </div>
                )}
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={!canCreateTodo}
                    className={`w-full py-3 font-bold rounded-xl transition ${canCreateTodo ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-400 text-white cursor-not-allowed'}`}
                  >
                    Criar Tarefa
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Lista de Tarefas</h3>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {([
                { key: 'TODOS', label: 'Todas' },
                { key: 'HOJE', label: 'Hoje' },
                { key: 'ATRASADAS', label: 'Atrasadas' },
                { key: 'SEMANA', label: 'Próx. 7 dias' },
                { key: 'PERIODO', label: 'Período' }
              ] as const).map(f => (
                <button
                  key={f.key}
                  onClick={() => setTodoFiltro(f.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${todoFiltro === f.key ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  {f.label}
                </button>
              ))}
              {todoFiltro === 'PERIODO' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={todoFiltroInicio}
                    onChange={(e) => setTodoFiltroInicio(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
                  />
                  <span className="text-xs text-slate-400">→</span>
                  <input
                    type="date"
                    value={todoFiltroFim}
                    onChange={(e) => setTodoFiltroFim(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
                  />
                </div>
              )}
            </div>
            {loadingTodos ? (
              <div className="text-center text-slate-500">Carregando tarefas...</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {([
                  { key: 'PENDENTE', label: 'A iniciar' },
                  { key: 'EM_ANDAMENTO', label: 'Em andamento' },
                  { key: 'CONCLUIDO', label: 'Concluídas' },
                  { key: 'CANCELADO', label: 'Canceladas' }
                ] as const).map(col => (
                  <div
                    key={col.key}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const id = Number(e.dataTransfer.getData('text/plain'));
                      if (id) atualizarStatusTodo(id, col.key as TodoItem['status']);
                    }}
                    className="bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-700 p-3 min-h-50"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold uppercase text-slate-500">{col.label}</h4>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {todosFiltrados.filter(t => t.status === col.key).length}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {todosFiltrados.filter(t => t.status === col.key).length === 0 ? (
                        <div className="text-xs text-slate-400">Nenhuma tarefa</div>
                      ) : (
                        todosFiltrados.filter(t => t.status === col.key).map(todo => {
                          const empresaNome = empresas.find(e => e.id === todo.empresa_id)?.nome_fantasia;
                          const consultorNome = consultores.find(c => c.id === todo.consultor_id)?.nome || (todo.consultor_id === currentUser?.id ? 'Eu' : undefined);
                          const atrasada = isOverdue(todo);
                          const concluidaAtraso = isCompletedLate(todo);
                          const isLocked = todo.status === 'CONCLUIDO' || todo.status === 'CANCELADO';
                          return (
                            <div
                              key={todo.id}
                              draggable={!isLocked}
                              onDragStart={(e) => {
                                if (isLocked) {
                                  e.preventDefault();
                                  return;
                                }
                                e.dataTransfer.setData('text/plain', String(todo.id));
                              }}
                              className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm flex flex-col gap-3 ${isLocked ? 'cursor-not-allowed opacity-80' : 'cursor-move'}`}
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  {todo.status === 'CONCLUIDO' ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className="text-slate-400" />}
                                  <p className="font-bold text-slate-800 dark:text-white">{todo.titulo}</p>
                                  {atrasada && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">ATRASADA</span>}
                                  {concluidaAtraso && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">CONCLUÍDA EM ATRASO</span>}
                                </div>
                                {todo.descricao && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{todo.descricao}</p>}
                                <p className="text-[11px] text-slate-400 mt-1">
                                  {todo.tipo_alvo === 'EMPRESA'
                                    ? `Empresa: ${empresaNome || `ID ${todo.empresa_id}`}`
                                    : `Consultor: ${consultorNome || `ID ${todo.consultor_id}`}`}
                                  {todo.due_date ? ` • Prazo: ${todo.due_date.slice(0, 10)}` : ''}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {todo.status === 'PENDENTE' && (
                                  <button
                                    onClick={() => atualizarStatusTodo(todo.id, 'EM_ANDAMENTO')}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-blue-300 text-blue-600 hover:bg-blue-50 transition"
                                  >
                                    Iniciar
                                  </button>
                                )}
                                {todo.status === 'EM_ANDAMENTO' && (
                                  <button
                                    onClick={() => atualizarStatusTodo(todo.id, 'CONCLUIDO')}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition"
                                  >
                                    Concluir
                                  </button>
                                )}
                                {todo.status === 'EM_ANDAMENTO' && (
                                  <button
                                    onClick={() => atualizarStatusTodo(todo.id, 'CANCELADO')}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-amber-300 text-amber-600 hover:bg-amber-50 transition"
                                  >
                                    Cancelar
                                  </button>
                                )}
                                {(todo.status === 'PENDENTE' || todo.status === 'CONCLUIDO' || todo.status === 'CANCELADO') && (
                                  <button
                                    onClick={() => deletarTodo(todo.id)}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-red-300 text-red-600 hover:bg-red-50 transition flex items-center gap-1"
                                  >
                                    <Trash2 size={12} /> Excluir
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- MODAL CONFIRMAÇÃO DE TROCA --- */}
      {showTrocaModal && targetEmpresa && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-scale-in border border-slate-700 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
               <ArrowRightLeft size={32} className="text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Acessar Empresa?</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              Você será redirecionado para o painel de:<br/>
              <strong className="text-slate-800 dark:text-white text-lg">{targetEmpresa.nome_fantasia}</strong>
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowTrocaModal(false)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg font-bold transition">
                Cancelar
              </button>
              <button onClick={confirmarTroca} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition shadow-lg">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE EMPRESA (CREATE & EDIT) --- */}
      {showEmpresaModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in border border-slate-700">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <Building2 className={isEditing ? "text-blue-500" : "text-green-500"} /> 
                {isEditing ? "Editar Empresa" : "Nova Empresa"}
              </h2>
              <button onClick={() => setShowEmpresaModal(false)} className="text-slate-400 hover:text-red-500 transition"><X size={24} /></button>
            </div>

            <form onSubmit={handleSubmitEmpresa} className="space-y-4">
              <div className="flex justify-center mb-4">
                <label className="relative cursor-pointer group">
                  <div className={`w-24 h-24 rounded-full bg-slate-100 dark:bg-slate-700 border-2 border-dashed ${uploading ? 'border-blue-500' : 'border-slate-300 dark:border-slate-500'} flex items-center justify-center overflow-hidden hover:border-blue-500 transition`}>
                    {uploading ? <div className="text-blue-500 animate-spin"><Loader2 size={24} /></div> : previewUrl ? <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" /> : <div className="text-center text-slate-400"><Upload size={24} className="mx-auto mb-1" /><span className="text-[10px]">Logo</span></div>}
                  </div>
                  <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} disabled={uploading} />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome Fantasia</label>
                  <input required type="text" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white focus:border-blue-500 outline-none" value={formEmpresa.nome_fantasia} onChange={e => setFormEmpresa({...formEmpresa, nome_fantasia: e.target.value})} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Razão Social</label>
                  <input type="text" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white focus:border-blue-500 outline-none" value={formEmpresa.razao_social} onChange={e => setFormEmpresa({...formEmpresa, razao_social: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">{formEmpresa.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'}</label>
                  <input type="text" placeholder={formEmpresa.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white focus:border-blue-500 outline-none" value={formEmpresa.cnpj} onChange={e => setFormEmpresa({...formEmpresa, cnpj: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Tipo</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={formEmpresa.tipo_pessoa}
                    onChange={e => setFormEmpresa({ ...formEmpresa, tipo_pessoa: e.target.value as 'PF' | 'PJ' })}
                  >
                    <option value="PF">Pessoa Física</option>
                    <option value="PJ">Pessoa Jurídica</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Cor da Marca</label>
                  <div className="flex h-10.5 border border-slate-300 dark:border-slate-600 rounded-lg overflow-hidden">
                      <input type="color" className="h-full w-12 cursor-pointer border-none p-0" value={formEmpresa.cor_primaria} onChange={e => setFormEmpresa({...formEmpresa, cor_primaria: e.target.value})} />
                      <input type="text" className="flex-1 bg-transparent px-2 text-sm uppercase dark:text-white outline-none" value={formEmpresa.cor_primaria} onChange={e => setFormEmpresa({...formEmpresa, cor_primaria: e.target.value})} />
                  </div>
                </div>
              </div>

              <button type="submit" disabled={uploading} className={`w-full py-3 text-white font-bold rounded-xl transition shadow-lg mt-4 disabled:opacity-50 ${isEditing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {uploading ? 'Enviando...' : (isEditing ? 'Salvar' : 'Cadastrar')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL NOVO USUÁRIO (MANTIDO) --- */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in border border-slate-700">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <UserPlus className="text-blue-500" /> Novo Usuário
              </h2>
              <button onClick={() => setShowUserModal(false)} className="text-slate-400 hover:text-red-500 transition"><X size={24} /></button>
            </div>
            
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome Completo</label>
                <input required type="text" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.nome} onChange={e => setNewUser({...newUser, nome: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">E-mail</label>
                <input required type="email" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Senha</label>
                <input required type="password" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Vincular Empresa</label>
                <select className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" value={isSuperConsultor ? newUser.empresa_id : (currentUser?.empresa_id || 0)} onChange={e => setNewUser({...newUser, empresa_id: Number(e.target.value)})} disabled={!isSuperConsultor || newUser.is_consultor}>
                  <option value={0}>{newUser.is_consultor ? '-- Consultores acessam múltiplas empresas --' : '-- Selecione --'}</option>
                  {!newUser.is_consultor && (isSuperConsultor ? empresas : empresas.filter(emp => emp.id === currentUser?.empresa_id)).map(emp => (<option key={emp.id} value={emp.id}>{emp.nome_fantasia}</option>))}
                </select>
              </div>
              {isSuperConsultor ? (
                <div className="flex items-center gap-2 pt-2 bg-slate-50 dark:bg-slate-700/50 p-2 rounded">
                  <input type="checkbox" id="isConsultorCheck" checked={newUser.is_consultor} onChange={e => setNewUser({...newUser, is_consultor: e.target.checked})} className="w-4 h-4 text-blue-600 rounded" />
                  <label htmlFor="isConsultorCheck" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer select-none">Dar permissão de <strong>Consultor</strong>?</label>
                </div>
              ) : (
                <div className="rounded bg-slate-50 p-2 text-xs text-slate-500 dark:bg-slate-700/50 dark:text-slate-300">
                  Usuários criados aqui ficam vinculados à empresa em contexto e não recebem permissões de consultor.
                </div>
              )}
              <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg mt-4">Criar Usuário</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}