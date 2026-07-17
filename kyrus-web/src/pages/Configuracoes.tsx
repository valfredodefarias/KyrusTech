import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fetchLancamentosPaged, normalizeListResponse, toPublicAssetUrl } from '../services/api';
import { useAuthStore, type EmpresaInfo } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { RbacManager } from '../components/RbacManager';
import { 
  Building2, UploadCloud, Layers, Save, Loader2, 
  Palette, Check, AlertCircle, Camera, RefreshCw,
  Download, CalendarRange, Trash2, Users,
  PanelLeftClose, PanelLeftOpen, ShoppingBag, Plus,
  Shield, Monitor, DollarSign, Percent, RotateCcw,
  GripVertical, Sparkles, CheckCircle2
} from 'lucide-react';
import { Entidades } from './Entidades';

// Importa os componentes do arquivo de Importação
// ATENÇÃO: Certifique-se de que eles estão exportados no arquivo de origem!
import { Importacao, PlanoContasManager } from './Importacao'; 

// --- INTERFACES ---
interface Empresa {
  id: number;
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  cor_primaria?: string;
  logo_url?: string;
  categoria_nfe_fornecedores_id?: number | null;
}

interface UserInfo {
  id: number;
  email: string;
  nome?: string | null;
  foto_url?: string | null;
  is_consultor?: boolean;
  consultor_role?: string;
  permissions?: string[] | null;
}

interface ContaExportacao {
  id: number;
  nome: string;
  banco?: string | null;
}

interface CategoriaExportacao {
  id: number;
  nome: string;
}

interface CategoriaNfeConfig {
  id: number;
  nome: string;
  tipo?: string | null;
  permite_lancamentos?: boolean;
  eh_cabecalho?: boolean;
}

interface LancamentoExportacao {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  data_vencimento: string;
  data_pagamento?: string | null;
  valor_previsto: number;
  valor_pago: number;
  plano_contas_id?: number | null;
  conta_id?: number | null;
  competencia?: string | null;
  previsto?: boolean;
}

interface CentroCustoOption {
  id: number;
  nome: string;
  codigo?: string | null;
  status?: string | null;
}

interface IntegracaoNfstock {
  id: number;
  nome: string;
  tipo: string;
  ativo: boolean;
  centro_custo_id?: number | null;
  nfstock_username?: string | null;
  nfstock_select_company?: boolean;
  nfstock_company_name?: string | null;
}

const COMPANY_RESET_PERMISSION = 'empresa:reset_base';
const NFSTOCK_FORCE_SYNC_PERMISSION = 'integracoes:sync';

function hasPermission(user: UserInfo | null, permission: string) {
  const permissions = user?.permissions || [];
  return permissions.includes('*') || permissions.includes(permission);
}

const IntegracaoNfstockCentroCusto = () => {
  const [centros, setCentros] = useState<CentroCustoOption[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegracaoNfstock[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forcingSync, setForcingSync] = useState(false);

  const [centroCustoId, setCentroCustoId] = useState('');
  const [nome, setNome] = useState('NFStock');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectCompany, setSelectCompany] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [forceSyncLogin, setForceSyncLogin] = useState('');
  const canForceSyncByLogin = hasPermission(user, NFSTOCK_FORCE_SYNC_PERMISSION);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: centrosData }, { data: integracoesData }, { data: userData }] = await Promise.all([
        api.get<CentroCustoOption[]>('/centro-custo/'),
        api.get<IntegracaoNfstock[]>('/integracoes-bancarias/'),
        api.get<UserInfo>('/usuarios/me'),
      ]);

      const centrosAtivos = normalizeListResponse<CentroCustoOption>(centrosData)
        .filter((item) => String(item.status || 'ATIVO').toUpperCase() === 'ATIVO')
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

      const nfstockList = normalizeListResponse<IntegracaoNfstock>(integracoesData)
        .filter((item) => String(item.tipo || '').toUpperCase() === 'NFSTOCK');

      setUser(userData);
      setCentros(centrosAtivos);
      setIntegracoes(nfstockList);

      if (!centroCustoId && centrosAtivos.length > 0) {
        setCentroCustoId(String(centrosAtivos[0].id));
      }
    } catch (error) {
      console.error(error);
      alert('Erro ao carregar configuração NFStock.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncByLogin() {
    if (!canForceSyncByLogin) {
      alert('Você não tem permissão para sincronizar por login.');
      return;
    }

    const login = forceSyncLogin.trim();
    if (!login) {
      alert('Informe o login NFStock para sincronizar.');
      return;
    }

    setForcingSync(true);
    try {
      await api.post('/integracoes-bancarias/nfstock/sincronizar-por-login', { username: login });
      alert('Busca de notas fiscais iniciada/concluída para o login informado.');
      await loadData();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao sincronizar por login.');
    } finally {
      setForcingSync(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleSave() {
    if (!centroCustoId) {
      alert('Selecione o centro de custo.');
      return;
    }
    if (!username.trim() || !password.trim()) {
      alert('Informe usuário e senha do NFStock.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/integracoes-bancarias/nfstock/configurar', {
        nome: nome.trim() || 'NFStock',
        username: username.trim(),
        password: password,
        centro_custo_id: Number(centroCustoId),
        select_company: selectCompany,
        company_name: companyName.trim() || null,
        ativo,
      });
      setPassword('');
      alert('Integração NFStock salva. Agendamento diário configurado para 1:00 AM.');
      await loadData();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao salvar integração NFStock.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow(id: number) {
    try {
      await api.post(`/integracoes-bancarias/${id}/sincronizar`);
      alert('Sincronização NFStock iniciada/concluída.');
      await loadData();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao sincronizar NFStock.');
    }
  }

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-4">
      <div className="rounded-none border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
        <h2 className="text-2xl font-black text-slate-900 dark:text-white">NFStock por Centro de Custo</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Configura usuário/senha por centro de custo. O sistema sincroniza diariamente às 1:00 AM e importa NF-e novas com XML+PDF.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Centro de custo</span>
            <select
              value={centroCustoId}
              onChange={(e) => setCentroCustoId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Selecione</option>
              {centros.map((centro) => (
                <option key={centro.id} value={centro.id}>{centro.nome}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome da integração</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Usuário NFStock</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Senha NFStock</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label className="flex items-center gap-2 pt-6 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={selectCompany} onChange={(e) => setSelectCompany(e.target.checked)} />
            Selecionar empresa após login
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Empresa no NFStock</span>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!selectCompany} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label className="flex items-center gap-2 pt-6 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Integração ativa
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={handleSave} disabled={saving || loading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar integração NFStock'}
          </button>
        </div>

        {canForceSyncByLogin ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">Ação restrita</p>
            <h3 className="mt-1 text-sm font-black text-slate-900 dark:text-white">Buscar NF-e por login específico</h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Use somente quando precisar forçar a busca de notas para um usuário NFStock específico.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={forceSyncLogin}
                onChange={(e) => setForceSyncLogin(e.target.value)}
                placeholder="Login NFStock"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void handleSyncByLogin()}
                disabled={forcingSync || loading}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {forcingSync ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {forcingSync ? 'Buscando notas...' : 'Buscar notas por login'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900/50">
              <tr>
                <th className="px-3 py-2">Centro de custo</th>
                <th className="px-3 py-2">Usuário</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {integracoes.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nenhuma integração NFStock configurada.</td></tr>
              ) : integracoes.map((item) => {
                const centro = centros.find((c) => Number(c.id) === Number(item.centro_custo_id));
                return (
                  <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2">{centro?.nome || `ID ${item.centro_custo_id ?? '-'}`}</td>
                    <td className="px-3 py-2">{item.nfstock_username || '-'}</td>
                    <td className="px-3 py-2">{item.ativo ? 'ATIVO' : 'INATIVO'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => void handleSyncNow(item.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                        Sincronizar agora
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTE: DADOS DA EMPRESA ---
const DadosEmpresa = () => {
  const storeUser = useAuthStore((state) => state.user);
  const storeEmpresa = useAuthStore((state) => state.empresa);
  const setGlobalEmpresa = useAuthStore((state) => state.setEmpresa);

  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(storeEmpresa);
  const [user, setUser] = useState<UserInfo | null>(storeUser);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cor, setCor] = useState(storeEmpresa?.cor_primaria || '#2563eb');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(storeEmpresa?.logo_url ? toPublicAssetUrl(storeEmpresa.logo_url) : null);
  const [categoriasDespesaNfe, setCategoriasDespesaNfe] = useState<CategoriaNfeConfig[]>([]);
  const [categoriaNfeFornecedoresId, setCategoriaNfeFornecedoresId] = useState(storeEmpresa?.categoria_nfe_fornecedores_id ? String(storeEmpresa.categoria_nfe_fornecedores_id) : '');
  const [loadingCategoriasNfe, setLoadingCategoriasNfe] = useState(false);
  const invalidatePlanoContas = useLookupStore((state) => state.invalidatePlanoContas);
  const canResetEmpresa = hasPermission(user, COMPANY_RESET_PERMISSION) && user?.email === 'cirocaue12@gmail.com';

  useEffect(() => { loadEmpresa(); }, []);

  // Sincroniza com a store caso mude globalmente
  useEffect(() => {
    if (storeUser) setUser(storeUser);
  }, [storeUser]);

  useEffect(() => {
    if (storeEmpresa) {
      setEmpresa(storeEmpresa);
      if (storeEmpresa.cor_primaria) setCor(storeEmpresa.cor_primaria);
      setCategoriaNfeFornecedoresId(storeEmpresa.categoria_nfe_fornecedores_id ? String(storeEmpresa.categoria_nfe_fornecedores_id) : '');
      if (storeEmpresa.logo_url) setPreviewUrl(toPublicAssetUrl(storeEmpresa.logo_url));
    }
  }, [storeEmpresa]);

  // Cria preview local imediato quando o usuário seleciona um arquivo
  useEffect(() => {
    if (logoFile) {
        const url = URL.createObjectURL(logoFile);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url); // Limpa memória ao desmontar
    }
  }, [logoFile]);

  async function loadEmpresa() {
    try {
      setLoadingCategoriasNfe(true);
      try {
        const { data: planoContasData } = await api.get('/plano-contas/');
        const normalized = normalizeListResponse<CategoriaNfeConfig>(planoContasData);
        
        const categoriasDespesa = normalized
          .filter((item) => String(item.tipo || '').toUpperCase().startsWith('D'))
          .filter((item) => item.permite_lancamentos !== false)
          .filter((item) => item.eh_cabecalho !== true)
          .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        setCategoriasDespesaNfe(categoriasDespesa);
      } catch (error) {
        console.error(error);
        setCategoriasDespesaNfe([]);
      } finally {
        setLoadingCategoriasNfe(false);
      }
    } catch (e) { 
      console.error(e); 
    } finally { 
      setLoading(false); 
    }
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        setLogoFile(e.target.files[0]);
    }
  };

  async function handleSave() {
    if (!empresa) return;
    setSaving(true);
    try {
        let empresaSalva = empresa;

        // 1. Upload da Logo (se houve alteração)
        if (logoFile) {
             const fdLogo = new FormData();
             fdLogo.append('file', logoFile); // Campo 'file' deve bater com o backend
             const resLogo = await api.post<EmpresaInfo>(`/empresas/${empresa.id}/logo`, fdLogo);
             empresaSalva = resLogo.data;
        }
        
        // 2. Atualiza Cor e Dados da Empresa
        const resPatch = await api.patch<EmpresaInfo>(`/empresas/${empresa.id}`, {
          cor_primaria: cor,
          categoria_nfe_fornecedores_id: categoriaNfeFornecedoresId ? Number(categoriaNfeFornecedoresId) : null,
        });
        empresaSalva = resPatch.data;

        // 3. Atualizar store global para propagação automática sem precisar de reload
        setGlobalEmpresa(empresaSalva);
        
        // Aplica visualmente na hora (sem precisar de refresh para ver a cor)
        document.documentElement.style.setProperty('--color-primary', cor);
        
        alert("Configurações salvas com sucesso!");
    } catch (e) { 
        console.error(e);
        alert("Erro ao salvar configurações."); 
    } finally { 
        setSaving(false); 
    }
  }

  async function handleResetEmpresa() {
    if (!empresa || !canResetEmpresa || resetting) return;

    const confirmed = window.confirm(
      'Esse reset vai apagar definitivamente entidades, lançamentos, contas, cartões, integrações bancárias, centros de custo e plano de contas da empresa. O nome, a logo e os usuários com acesso serão mantidos. Deseja continuar?'
    );
    if (!confirmed) return;

    const typed = window.prompt('Digite RESETAR EMPRESA para confirmar o reset total da base financeira.');
    if (typed !== 'RESETAR EMPRESA') {
      alert('Confirmação inválida. O reset foi cancelado.');
      return;
    }

    setResetting(true);
    try {
      const { data } = await api.post(`/empresas/${empresa.id}/resetar-base`);
      invalidatePlanoContas();
      alert(data?.message || 'Empresa resetada com sucesso.');
      window.location.reload();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao resetar a empresa.');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8"/></div>;
  if (!empresa) return <div className="p-10 text-center text-slate-500">Empresa não encontrada.</div>;

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-none p-4 sm:p-6 shadow-sm">
        
        {/* CABEÇALHO COM LOGO (CROPADA/REDONDA) */}
        <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 mb-6 pb-6 border-b border-slate-200 dark:border-slate-700">
          
          {/* Container da Logo */}
          <div className="relative group">
            {/* A classe overflow-hidden corta o que passar da borda redonda */}
            <div className="w-32 h-32 rounded-full bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border-4 border-slate-200 dark:border-slate-700 shadow-xl group-hover:border-blue-500 transition-colors">
                {previewUrl ? (
                    // object-cover: A imagem dá zoom para preencher tudo (sem bordas brancas quadradas)
                    <img 
                        src={previewUrl} 
                        className="w-full h-full object-cover" 
                        alt="Logo da Empresa"
                    />
                ) : (
                    // Fallback se não tiver logo: Iniciais
                    <span className="text-4xl font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 w-full h-full flex items-center justify-center">
                        {empresa.nome_fantasia.substring(0,2).toUpperCase()}
                    </span>
                )}
            </div>
            
            {/* Botão Flutuante de Upload */}
            <label className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full cursor-pointer shadow-lg transition-transform hover:scale-110 border-4 border-white dark:border-slate-800 z-10">
                <Camera className="w-5 h-5"/>
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange}/>
            </label>
          </div>
          
          <div className="text-center md:text-left">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">{empresa.nome_fantasia}</h2>
            <div className="flex flex-col md:flex-row gap-3 items-center">
                <p className="text-slate-400 font-mono bg-slate-900/50 px-3 py-1 rounded-lg inline-block border border-slate-700">
                    {(empresa as any).cnpj}
                </p>
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold rounded-full border border-emerald-500/20 flex items-center gap-1">
                    <Check className="w-3 h-3"/> CONTA ATIVA
                </span>
            </div>
          </div>
        </div>

        {/* FORMULÁRIO (DADOS FISCAIS) */}
        <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Razão Social</label>
            <input disabled value={(empresa as any).razao_social} className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-medium cursor-not-allowed opacity-70" />
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Dados fiscais são protegidos.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">CNPJ</label>
            <input disabled value={(empresa as any).cnpj} className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-mono cursor-not-allowed opacity-70" />
          </div>
        </div>

        <div className="mb-6">
          <label className="text-xs font-bold text-slate-700 dark:text-white uppercase mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" /> NF-e no Financeiro
          </label>
          <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Categoria padrão para lançamento da NF-e</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Escolha a categoria de despesa usada na confirmação da importação de NF-e. Se não escolher, o sistema usa FORNECEDORES da empresa ou a categoria mais próxima automaticamente.</p>
            <select
              value={categoriaNfeFornecedoresId}
              onChange={(event) => setCategoriaNfeFornecedoresId(event.target.value)}
              disabled={saving || loadingCategoriasNfe}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Automático (FORNECEDORES mais próxima)</option>
              {categoriasDespesaNfe.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>
              ))}
            </select>
          </div>
        </div>



        {/* PERSONALIZAÇÃO VISUAL */}
        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-white uppercase mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-blue-500"/> Identidade Visual
          </label>
          <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
            <div className="relative group cursor-pointer">
                <input 
                  type="color" 
                  value={cor} 
                  onChange={e => setCor(e.target.value)}
                  className="w-20 h-20 rounded-xl cursor-pointer bg-transparent border-0 p-0 overflow-hidden" 
                />
                {/* Overlay visual para indicar clique */}
                <div className="absolute inset-0 pointer-events-none rounded-xl border border-slate-300 dark:border-slate-600 shadow-inner group-hover:border-slate-600 dark:group-hover:border-white/50 transition-colors"></div>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-slate-900 dark:text-white font-bold mb-1">Cor Primária</p>
              <p className="text-sm text-slate-400 mb-2">Esta cor define a "alma" do seu ERP (botões, menus e destaques).</p>
              <p className="text-xs font-mono text-slate-500 bg-slate-200 dark:bg-slate-800 px-2 py-1 rounded inline-block">{cor.toUpperCase()}</p>
            </div>
            {/* Botão de Demonstração */}
            <button className="px-6 py-3 rounded-xl text-white font-bold text-sm shadow-lg transition-transform hover:scale-105 active:scale-95" style={{ backgroundColor: cor }}>
              Botão Exemplo
            </button>
          </div>
        </div>

        {/* BOTÃO SALVAR */}
        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button 
            onClick={handleSave} 
            disabled={saving} 
            className="px-7 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-sm flex items-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" 
            style={{ backgroundColor: cor }}
          >
            {saving ? <Loader2 className="animate-spin w-5 h-5"/> : <Save className="w-5 h-5"/>} 
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>

        {canResetEmpresa ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-500">Zona crítica</p>
                <h3 className="mt-1 text-xl font-black text-slate-900 dark:text-white">Reset completo da empresa</h3>
                <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">Apaga definitivamente entidades, lançamentos, contas, cartões, integrações bancárias, centros de custo e o plano de contas atual. A empresa, a logo e os usuários com acesso continuam.</p>
              </div>
              <button
                type="button"
                onClick={handleResetEmpresa}
                disabled={resetting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-900/20 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {resetting ? 'Resetando base...' : 'Resetar empresa'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const ConfiguracoesPDV = () => {
  const storeEmpresa = useAuthStore((state) => state.empresa);
  const setGlobalEmpresa = useAuthStore((state) => state.setEmpresa);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(storeEmpresa);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (storeEmpresa) {
      setEmpresa(storeEmpresa);
    }
  }, [storeEmpresa]);
  const [categoriasReceita, setCategoriasReceita] = useState<CategoriaNfeConfig[]>([]);
  interface ContaConfig {
    id: number;
    nome: string;
    tipo: string;
  }
  const [contas, setContas] = useState<ContaConfig[]>([]);

  const defaultFormas = [
    { key: 'dinheiro', label: 'Dinheiro', parcelada: false, ativa: true },
    { key: 'pix_chave', label: 'PIX (Chave)', parcelada: false, ativa: true },
    { key: 'pix_qr', label: 'PIX (QR Code)', parcelada: false, ativa: true },
    { key: 'cartao_debito', label: 'Cartão de Débito', parcelada: false, ativa: true },
    { key: 'cartao_credito_vista', label: 'Cartão de Crédito (À Vista)', parcelada: false, ativa: true },
    { key: 'cartao_credito_parcelado', label: 'Cartão de Crédito (Parcelado)', parcelada: true, ativa: true },
    { key: 'boleto', label: 'Boleto', parcelada: true, ativa: true }
  ];
  const defaults = ['dinheiro', 'pix_chave', 'pix_qr', 'cartao_debito', 'cartao_credito_vista', 'cartao_credito_parcelado', 'boleto'];

  const [formasPagamento, setFormasPagamento] = useState<any[]>(defaultFormas);

  const [pdvConfigCategorias, setPdvConfigCategorias] = useState<Record<string, string>>({
    dinheiro: '',
    pix_chave: '',
    pix_qr: '',
    cartao_debito: '',
    cartao_credito_vista: '',
    cartao_credito_parcelado: '',
    boleto: ''
  });
  const [pdvConfigContas, setPdvConfigContas] = useState<Record<string, string>>({
    dinheiro: '',
    pix_chave: '',
    pix_qr: '',
    cartao_debito: '',
    cartao_credito_vista: '',
    cartao_credito_parcelado: '',
    boleto: ''
  });
  const [pdvConfigMarcarPago, setPdvConfigMarcarPago] = useState<Record<string, boolean>>({
    dinheiro: true,
    pix_chave: true,
    pix_qr: true,
    cartao_debito: false,
    cartao_credito_vista: true,
    cartao_credito_parcelado: false,
    boleto: false
  });

  // Novos estados para criação de forma de pagamento
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParcelada, setNewParcelada] = useState(false);
  const [newAtiva, setNewAtiva] = useState(true);

  // Sub-aba ativa (preferences ou custom_fields)
  const [activeConfigSubTab, setActiveConfigSubTab] = useState<'preferences' | 'custom_fields'>('preferences');

  // Campos personalizados (Metadados Dinâmicos)
  const [camposPersonalizados, setCamposPersonalizados] = useState<any[]>([]);
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  
  // Editor de campo
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldPlaceholder, setFieldPlaceholder] = useState('');
  const [fieldOptions, setFieldOptions] = useState('');
  const [fieldRegex, setFieldRegex] = useState('');
  const [fieldDependsOnField, setFieldDependsOnField] = useState('');
  const [fieldDependsOnValue, setFieldDependsOnValue] = useState('');
  const [fieldPlanoContasId, setFieldPlanoContasId] = useState('');
  const [fieldHalfWidth, setFieldHalfWidth] = useState(false);

  // Preferências adicionais do PDV
  const [pdvConfigModoVendaPadrao, setPdvConfigModoVendaPadrao] = useState<'itens' | 'direta'>('itens');
  const [pdvConfigFormaPagamentoPadrao, setPdvConfigFormaPagamentoPadrao] = useState<string>('dinheiro');

  // Estados Drag & Drop
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [showOrderSavedBadge, setShowOrderSavedBadge] = useState(false);

  // Estados de Simulação do Live Preview
  const [mockInputValues, setMockInputValues] = useState<Record<string, any>>({});
  const [simulateErrors, setSimulateErrors] = useState(false);

  const loadedDataRef = useRef(false);

  useEffect(() => {
    if (storeEmpresa && !loadedDataRef.current) {
      loadData();
      loadedDataRef.current = true;
    }
  }, [storeEmpresa]);

  async function loadData() {
    setLoading(true);
    try {
      const currentEmpresa = storeEmpresa;
      if (currentEmpresa) {
        let loadedFormas = [...defaultFormas];
        if (currentEmpresa.pdv_config) {
          try {
            const parsed = JSON.parse(currentEmpresa.pdv_config);
            if (parsed.formas_pagamento && Array.isArray(parsed.formas_pagamento)) {
              loadedFormas = parsed.formas_pagamento;
            }
            if (parsed.categorias) {
              setPdvConfigCategorias((prev) => ({ ...prev, ...parsed.categorias }));
            }
            if (parsed.contas) {
              setPdvConfigContas((prev) => ({ ...prev, ...parsed.contas }));
            }
            if (parsed.marcar_como_pago !== undefined) {
              setPdvConfigMarcarPago(parsed.marcar_como_pago);
            }
            if (parsed.campos_personalizados && Array.isArray(parsed.campos_personalizados)) {
              setCamposPersonalizados(parsed.campos_personalizados);
            }
            if (parsed.modo_venda_padrao) {
              setPdvConfigModoVendaPadrao(parsed.modo_venda_padrao);
            }
            if (parsed.forma_pagamento_padrao) {
              setPdvConfigFormaPagamentoPadrao(parsed.forma_pagamento_padrao);
            }
          } catch (e) {
            console.error('Erro ao fazer parse de pdv_config', e);
          }
        }
        setFormasPagamento(loadedFormas);

        const [{ data: planoContasData }, { data: contasData }] = await Promise.all([
          api.get('/plano-contas/'),
          api.get('/contas/', { params: { include_saldo: false } })
        ]);

        const normalized = normalizeListResponse<CategoriaNfeConfig>(planoContasData);
        const categoriasRec = normalized
          .filter((item) => String(item.tipo || '').toUpperCase().startsWith('R'))
          .filter((item) => item.permite_lancamentos !== false)
          .filter((item) => item.eh_cabecalho !== true)
          .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        setCategoriasReceita(categoriasRec);

        setContas(normalizeListResponse<ContaConfig>(contasData));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!empresa) return;
    setSaving(true);
    try {
      const resPatch = await api.patch<EmpresaInfo>(`/empresas/${empresa.id}`, {
        pdv_config: JSON.stringify({
          formas_pagamento: formasPagamento,
          categorias: pdvConfigCategorias,
          marcar_como_pago: pdvConfigMarcarPago,
          contas: pdvConfigContas,
          campos_personalizados: camposPersonalizados,
          modo_venda_padrao: pdvConfigModoVendaPadrao,
          forma_pagamento_padrao: pdvConfigFormaPagamentoPadrao
        })
      });
      setGlobalEmpresa(resPatch.data);
      alert("Configurações do PDV salvas com sucesso!");
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar configurações do PDV.");
    } finally {
      setSaving(false);
    }
  }

  function handleAddPaymentMethod() {
    if (!newName.trim()) {
      alert('Por favor, informe o nome da forma de pagamento.');
      return;
    }
    
    // Normalize key
    const key = newName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').trim();
    if (!key) {
      alert('Nome inválido.');
      return;
    }

    let uniqueKey = key;
    let suffix = 1;
    while (formasPagamento.some((item) => item.key === uniqueKey)) {
      uniqueKey = `${key}_${suffix}`;
      suffix++;
    }

    const newMethod = {
      key: uniqueKey,
      label: newName.trim(),
      parcelada: newParcelada,
      ativa: newAtiva
    };

    setFormasPagamento([...formasPagamento, newMethod]);
    setPdvConfigCategorias((prev) => ({ ...prev, [uniqueKey]: '' }));
    setPdvConfigContas((prev) => ({ ...prev, [uniqueKey]: '' }));
    setPdvConfigMarcarPago((prev) => ({ ...prev, [uniqueKey]: !newParcelada }));

    setNewName('');
    setNewParcelada(false);
    setNewAtiva(true);
    setShowAddForm(false);
  }

  function handleRemovePaymentMethod(key: string) {
    const matched = formasPagamento.find((f) => f.key === key);
    if (!matched) return;
    if (window.confirm(`Deseja realmente remover a forma de pagamento "${matched.label}"?`)) {
      setFormasPagamento(formasPagamento.filter((f) => f.key !== key));
      
      const newCats = { ...pdvConfigCategorias };
      delete newCats[key];
      setPdvConfigCategorias(newCats);

      const newContas = { ...pdvConfigContas };
      delete newContas[key];
      setPdvConfigContas(newContas);

      const newMarcar = { ...pdvConfigMarcarPago };
      delete newMarcar[key];
      setPdvConfigMarcarPago(newMarcar);
    }
  }

  async function saveFieldsConfigSilently(updatedFields: any[]) {
    if (!empresa) return;
    try {
      setShowOrderSavedBadge(true);
      const resPatch = await api.patch<EmpresaInfo>(`/empresas/${empresa.id}`, {
        pdv_config: JSON.stringify({
          formas_pagamento: formasPagamento,
          categorias: pdvConfigCategorias,
          marcar_como_pago: pdvConfigMarcarPago,
          contas: pdvConfigContas,
          campos_personalizados: updatedFields,
          modo_venda_padrao: pdvConfigModoVendaPadrao,
          forma_pagamento_padrao: pdvConfigFormaPagamentoPadrao
        })
      });
      setGlobalEmpresa(resPatch.data);
      setTimeout(() => setShowOrderSavedBadge(false), 1500);
    } catch (e) {
      console.error(e);
      setShowOrderSavedBadge(false);
    }
  }

  function saveFieldsList(updatedList: any[]) {
    setCamposPersonalizados(updatedList);
    saveFieldsConfigSilently(updatedList);
  }

  function handleSaveField() {
    if (!fieldLabel.trim()) {
      alert('Informe a etiqueta do campo.');
      return;
    }

    const fieldId = editingFieldId || fieldLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').trim();

    if (!fieldId) {
      alert('Nome de etiqueta inválido.');
      return;
    }

    const newField = {
      id: fieldId,
      label: fieldLabel.trim(),
      type: fieldType,
      required: fieldRequired,
      placeholder: fieldPlaceholder.trim() || undefined,
      options: (fieldType === 'select' || fieldType === 'select_buttons') ? fieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
      regex: fieldRegex.trim() || undefined,
      depends_on: fieldDependsOnField ? { field: fieldDependsOnField, value: fieldDependsOnValue } : undefined,
      plano_contas_id: fieldType === 'currency' && fieldPlanoContasId ? Number(fieldPlanoContasId) : undefined,
      half_width: fieldHalfWidth
    };

    let updatedList = [];
    if (editingFieldId) {
      updatedList = camposPersonalizados.map(f => f.id === editingFieldId ? newField : f);
    } else {
      if (camposPersonalizados.some(f => f.id === fieldId)) {
        alert('Já existe um campo com esta identificação/nome.');
        return;
      }
      updatedList = [...camposPersonalizados, newField];
    }

    saveFieldsList(updatedList);

    setShowFieldForm(false);
    setEditingFieldId(null);
    setFieldLabel('');
    setFieldType('text');
    setFieldRequired(false);
    setFieldPlaceholder('');
    setFieldOptions('');
    setFieldRegex('');
    setFieldDependsOnField('');
    setFieldDependsOnValue('');
    setFieldPlanoContasId('');
    setFieldHalfWidth(false);
  }

  function handleDeleteField(id: string) {
    if (confirm('Deseja realmente excluir este campo personalizado? As vendas existentes continuarão com o dado salvo, mas o campo não aparecerá mais no formulário de novas vendas.')) {
      const updatedList = camposPersonalizados.filter(f => f.id !== id);
      saveFieldsList(updatedList);
    }
  }

  // HTML5 Drag & Drop
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      return;
    }

    const list = [...camposPersonalizados];
    const draggedItem = list[draggedIndex];
    list.splice(draggedIndex, 1);
    list.splice(targetIndex, 0, draggedItem);
    saveFieldsList(list);
    setDraggedIndex(null);
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>;
  if (!empresa) return <div className="p-10 text-center text-slate-500">Empresa não encontrada.</div>;

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-none p-4 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4 mb-6">
          <div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white">Configurações do PDV</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-medium">Defina formas de pagamento, mapeamento contábil e campos personalizados para vendas.</p>
          </div>
          {/* Sub-abas */}
          <div className="flex gap-2 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveConfigSubTab('preferences')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition ${activeConfigSubTab === 'preferences' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Preferências e Integrações
            </button>
            <button
              type="button"
              onClick={() => setActiveConfigSubTab('custom_fields')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition ${activeConfigSubTab === 'custom_fields' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Campos Personalizados
            </button>
          </div>
        </div>

        {activeConfigSubTab === 'custom_fields' ? (
          /* COLUNAS LADO A LADO */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* PAINEL ESQUERDO: GERENCIADOR */}
            <div className="lg:col-span-7 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                    Metadados Dinâmicos
                    {showOrderSavedBadge && (
                      <span className="text-[10px] bg-emerald-500 text-white font-extrabold px-2 py-0.5 rounded-full animate-pulse">Sincronizado!</span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Gerencie e reordene os campos adicionais do formulário de vendas.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingFieldId(null);
                    setFieldLabel('');
                    setFieldType('text');
                    setFieldRequired(false);
                    setFieldPlaceholder('');
                    setFieldOptions('');
                    setFieldRegex('');
                    setFieldDependsOnField('');
                    setFieldDependsOnValue('');
                    setFieldPlanoContasId('');
                    setFieldHalfWidth(false);
                    setShowFieldForm(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2.5 text-xs font-bold text-white shadow-md transition cursor-pointer"
                  style={empresa.cor_primaria ? { backgroundColor: empresa.cor_primaria } : undefined}
                >
                  <Plus className="w-4 h-4" />
                  Novo Campo
                </button>
              </div>

              {/* LISTA DE CAMPOS COM DRAG & DROP */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                {camposPersonalizados.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-slate-400">
                    <p className="text-sm font-medium">Nenhum campo personalizado cadastrado.</p>
                    <p className="text-xs mt-1">Crie um campo para começar a preencher dados adicionais no PDV.</p>
                  </div>
                ) : (
                  camposPersonalizados.map((campo, index) => {
                    const isDragOver = dragOverIndex === index;
                    return (
                      <div
                        key={campo.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                        className={`flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100/80 dark:bg-slate-900/60 dark:hover:bg-slate-900/90 border rounded-xl transition shadow-sm ${draggedIndex === index ? 'opacity-40' : ''} ${isDragOver ? 'border-dashed border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-800'}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-800">
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-850 dark:text-white truncate">{campo.label}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                              <span className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">{campo.type}</span>
                              {campo.required && <span className="bg-red-500 text-white px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider">Obrigatório</span>}
                              {campo.half_width && <span className="bg-blue-500 text-white px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider">Meia Largura</span>}
                              {campo.plano_contas_id && <span className="bg-amber-500 text-white px-1.5 py-0.5 rounded font-extrabold uppercase">PC: #{campo.plano_contas_id}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingFieldId(campo.id);
                              setFieldLabel(campo.label);
                              setFieldType(campo.type);
                              setFieldRequired(campo.required || false);
                              setFieldPlaceholder(campo.placeholder || '');
                              setFieldOptions(Array.isArray(campo.options) ? campo.options.join(', ') : '');
                              setFieldRegex(campo.regex || '');
                              setFieldDependsOnField(campo.depends_on?.field || '');
                              setFieldDependsOnValue(campo.depends_on?.value || '');
                              setFieldPlanoContasId(campo.plano_contas_id ? String(campo.plano_contas_id) : '');
                              setFieldHalfWidth(campo.half_width || false);
                              setShowFieldForm(true);
                            }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/35 rounded-lg transition font-bold text-xs"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteField(campo.id)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/35 rounded-lg transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* PAINEL DIREITO: MAQUETE LIVE PREVIEW */}
            <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-inner">
              <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-blue-500 animate-pulse" />
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Maquete do PDV (Nova Venda)</h4>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simulateErrors}
                    onChange={(e) => setSimulateErrors(e.target.checked)}
                    className="rounded text-blue-500 focus:ring-blue-500"
                  />
                  Simular Erros
                </label>
              </div>

              {/* SIMULADOR DE FORMULÁRIO */}
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 shadow-sm">
                <div className="border-b border-slate-100 dark:border-slate-900 pb-2.5 mb-3 flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-bold text-slate-400 uppercase">Informações da Venda</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {camposPersonalizados.length === 0 ? (
                    <div className="col-span-2 text-center py-6 text-slate-400 text-xs font-medium border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      Crie campos personalizados para ver a prévia renderizada em tempo real.
                    </div>
                  ) : (
                    camposPersonalizados.map((campo: any) => {
                      const value = mockInputValues[campo.id] ?? '';
                      const isHalf = campo.half_width;
                      const wrapperClass = isHalf ? "col-span-2 sm:col-span-1 space-y-1 animate-in fade-in" : "col-span-2 space-y-1 animate-in fade-in";
                      
                      // Check for errors if simulated
                      const isRequiredEmpty = campo.required && !value;
                      
                      let isRegexInvalid = false;
                      if (campo.regex && value) {
                        try {
                          isRegexInvalid = !new RegExp(campo.regex).test(String(value));
                        } catch (e) {
                          isRegexInvalid = true;
                        }
                      }
                      
                      const isError = simulateErrors && (isRequiredEmpty || isRegexInvalid);

                      const handleMockChange = (val: any) => {
                        setMockInputValues((prev) => ({ ...prev, [campo.id]: val }));
                      };

                      return (
                        <div key={campo.id} className={wrapperClass}>
                          <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                            {campo.label}
                            {campo.required && <span className="text-rose-500 font-extrabold">*</span>}
                          </label>

                          {campo.type === 'select_buttons' ? (
                            <div className="grid grid-cols-3 gap-1.5 pt-1">
                              {(campo.options || []).map((opt: string) => {
                                const active = value === opt;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => handleMockChange(active ? '' : opt)}
                                    className={`py-1.5 px-2 text-[10px] font-bold text-center rounded-lg border transition cursor-pointer truncate ${active ? 'bg-blue-500/10 border-blue-500 text-blue-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100'}`}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>
                          ) : campo.type === 'select' ? (
                            <select
                              value={value}
                              onChange={(e) => handleMockChange(e.target.value)}
                              className={`w-full rounded-xl border px-3 py-2 text-xs outline-none transition focus:border-blue-500 ${isError ? 'border-rose-500 bg-rose-50/20 text-rose-700' : 'border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-white'}`}
                            >
                              <option value="">Selecione...</option>
                              {(campo.options || []).map((opt: string) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : campo.type === 'checkbox' ? (
                            <div className="pt-1">
                              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!value}
                                  onChange={(e) => handleMockChange(e.target.checked)}
                                  className="rounded text-blue-500 focus:ring-blue-500"
                                />
                                {campo.placeholder || 'Marcar opção'}
                              </label>
                            </div>
                          ) : campo.type === 'currency' ? (
                            <div className="relative">
                              <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-bold">R$</span>
                              <input
                                type="text"
                                value={value}
                                onChange={(e) => handleMockChange(formatMonetario(e.target.value))}
                                placeholder="0,00"
                                className={`w-full rounded-xl border pl-9 pr-3 py-2 text-xs outline-none transition focus:border-blue-500 ${isError ? 'border-rose-500 bg-rose-50/20 text-rose-700' : 'border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-white'}`}
                              />
                            </div>
                          ) : (
                            <input
                              type={campo.type === 'number' ? 'number' : 'text'}
                              value={value}
                              onChange={(e) => handleMockChange(e.target.value)}
                              placeholder={campo.placeholder || ''}
                              className={`w-full rounded-xl border px-3 py-2 text-xs outline-none transition focus:border-blue-500 ${isError ? 'border-rose-500 bg-rose-50/20 text-rose-700' : 'border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-white'}`}
                            />
                          )}

                          {isError && (
                            <p className="text-[10px] text-rose-500 font-extrabold flex items-center gap-1 mt-0.5 animate-in slide-in-from-top-1">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {isRequiredEmpty ? 'Campo obrigatório' : 'Regex inválido'}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Mapeamentos e Preferências */
          <div className="space-y-6">
            {/* Modo de venda e Forma de pagamento padrão */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Preferências Gerais do PDV</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Modo de Venda Padrão</span>
                  <select
                    value={pdvConfigModoVendaPadrao}
                    onChange={(e) => setPdvConfigModoVendaPadrao(e.target.value as 'itens' | 'direta')}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="itens">Venda por Itens (Lista de produtos)</option>
                    <option value="direta">Venda Direta (Lançamento de valor único)</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Forma de Pagamento Padrão</span>
                  <select
                    value={pdvConfigFormaPagamentoPadrao}
                    onChange={(e) => setPdvConfigFormaPagamentoPadrao(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {formasPagamento.map((item) => (
                      <option key={item.key} value={item.key}>{item.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Formas de pagamento mapeadas */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Mapeamento Contábil e Liquidação Automática</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    Escolha a categoria de receitas do Plano de Contas e decida se o lançamento correspondente deve ser marcado como liquidado (PAGO) na hora da venda, ou se nascerá em aberto.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2.5 text-xs font-bold text-white shadow-md transition-colors cursor-pointer shrink-0"
                  style={empresa.cor_primaria ? { backgroundColor: empresa.cor_primaria } : undefined}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nova Forma
                </button>
              </div>
              
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {formasPagamento.map((item) => (
                  <div key={item.key} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 shadow-sm relative">
                    <div className="flex items-center justify-between font-bold text-xs uppercase tracking-wider">
                      <span className="text-slate-900 dark:text-white">{item.label}</span>
                      {!defaults.includes(item.key) && (
                        <button
                          type="button"
                          onClick={() => handleRemovePaymentMethod(item.key)}
                          className="text-red-500 hover:text-red-650 p-1 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition cursor-pointer animate-in fade-in font-bold"
                          title="Excluir Forma de Pagamento"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Categoria de Receita</span>
                      <select
                        value={pdvConfigCategorias[item.key] || ''}
                        onChange={(e) => {
                          setPdvConfigCategorias({
                            ...pdvConfigCategorias,
                            [item.key]: e.target.value
                          });
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="">Automático (Padrão de Receitas)</option>
                        {categoriasReceita.map((categoria) => (
                          <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Conta Financeira</span>
                      <select
                        value={pdvConfigContas[item.key] || ''}
                        onChange={(e) => {
                          setPdvConfigContas({
                            ...pdvConfigContas,
                            [item.key]: e.target.value
                          });
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="">Não Associada</option>
                        {contas.map((c) => (
                          <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                      </select>
                    </label>
                    
                    <div className="flex flex-col gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pdvConfigMarcarPago[item.key] || false}
                          onChange={(e) => {
                            setPdvConfigMarcarPago({
                              ...pdvConfigMarcarPago,
                              [item.key]: e.target.checked
                            });
                          }}
                          className="rounded text-blue-500 focus:ring-blue-500"
                        />
                        Marcar como Pago na hora
                      </label>

                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.ativa !== false}
                          onChange={(e) => {
                            setFormasPagamento(formasPagamento.map((f) => f.key === item.key ? { ...f, ativa: e.target.checked } : f));
                          }}
                          className="rounded text-blue-500 focus:ring-blue-500"
                        />
                        Ativa no PDV
                      </label>

                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.parcelada || false}
                          onChange={(e) => {
                            setFormasPagamento(formasPagamento.map((f) => f.key === item.key ? { ...f, parcelada: e.target.checked } : f));
                          }}
                          className="rounded text-blue-500 focus:ring-blue-500"
                        />
                        Permite Parcelamento
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* BOTÃO SALVAR */}
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button 
                onClick={handleSave} 
                disabled={saving} 
                className="px-7 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-sm flex items-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer" 
                style={empresa.cor_primaria ? { backgroundColor: empresa.cor_primaria } : undefined}
              >
                {saving ? <Loader2 className="animate-spin w-5 h-5"/> : <Save className="w-5 h-5"/>} 
                {saving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        )}

        {/* MODAL DE CRIAÇÃO FORMA PAGAMENTO */}
        {showAddForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Nova Forma de Pagamento</h3>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold cursor-pointer"
                >
                  &times;
                </button>
              </div>
              
              <div className="space-y-4">
                <label className="block">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Nome da Forma</span>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Vale Refeição, Pix Parcelado"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newParcelada}
                      onChange={(e) => setNewParcelada(e.target.checked)}
                      className="rounded text-blue-500 focus:ring-blue-500"
                    />
                    Permite Parcelamento
                  </label>

                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAtiva}
                      onChange={(e) => setNewAtiva(e.target.checked)}
                      className="rounded text-blue-500 focus:ring-blue-500"
                    />
                    Ativa (Disponível no PDV)
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAddPaymentMethod}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-md transition cursor-pointer"
                  style={empresa.cor_primaria ? { backgroundColor: empresa.cor_primaria } : undefined}
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE CRIAÇÃO/EDIÇÃO DE CAMPO PERSONALIZADO */}
        {showFieldForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl max-w-lg w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {editingFieldId ? 'Editar Campo Personalizado' : 'Novo Campo Personalizado'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowFieldForm(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold cursor-pointer"
                >
                  &times;
                </button>
              </div>
              
              <div className="space-y-4 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                <div className="grid grid-cols-2 gap-4">
                  <label className="col-span-2 block">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Etiqueta do Campo (Label)</span>
                    <input
                      type="text"
                      value={fieldLabel}
                      onChange={(e) => setFieldLabel(e.target.value)}
                      placeholder="Ex: CPF do Cliente, Placa do Veículo"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </label>

                  <label className="col-span-2 sm:col-span-1 block">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Tipo de Dado</span>
                    <select
                      value={fieldType}
                      onChange={(e) => setFieldType(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      <option value="text">Texto Simples (text)</option>
                      <option value="number">Número (number)</option>
                      <option value="currency">Valor Monetário (currency)</option>
                      <option value="checkbox">Caixa de Seleção (checkbox)</option>
                      <option value="select">Lista de Opções (select)</option>
                      <option value="select_buttons">Botões de Opção Rápida (select_buttons)</option>
                    </select>
                  </label>

                  <label className="col-span-2 sm:col-span-1 block">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Placeholder / Texto Auxiliar</span>
                    <input
                      type="text"
                      value={fieldPlaceholder}
                      onChange={(e) => setFieldPlaceholder(e.target.value)}
                      placeholder="Ex: 000.000.000-00"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </label>

                  {/* Configurações específicas para Select e Select Buttons */}
                  {(fieldType === 'select' || fieldType === 'select_buttons') && (
                    <label className="col-span-2 block">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Opções (Separadas por vírgula)</span>
                      <input
                        type="text"
                        value={fieldOptions}
                        onChange={(e) => setFieldOptions(e.target.value)}
                        placeholder="Ex: Opção A, Opção B, Opção C"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                  )}

                  {/* Configurações de Expressão Regular (Regex) para validação */}
                  {(fieldType === 'text' || fieldType === 'number') && (
                    <label className="col-span-2 block">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Validação Regex (Expressão Regular)</span>
                      <input
                        type="text"
                        value={fieldRegex}
                        onChange={(e) => setFieldRegex(e.target.value)}
                        placeholder="Ex: ^\d{11}$ para 11 dígitos numéricos"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                  )}

                  {/* Configuração de Plano de Contas para tipo Currency */}
                  {fieldType === 'currency' && (
                    <label className="col-span-2 block">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Plano de Contas Associado</span>
                      <select
                        value={fieldPlanoContasId}
                        onChange={(e) => setFieldPlanoContasId(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="">Não Associado (Apenas descritivo)</option>
                        {categoriasReceita.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.nome} (Receita)</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {/* Dependência Condicional */}
                  <div className="col-span-2 grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="col-span-2 text-xs font-bold text-slate-400 uppercase">Dependência Condicional (Opcional)</div>
                    <label className="block col-span-2 sm:col-span-1">
                      <span className="text-[10px] font-bold text-slate-500 block mb-1 uppercase">Depende do Campo</span>
                      <select
                        value={fieldDependsOnField}
                        onChange={(e) => setFieldDependsOnField(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="">Nenhum</option>
                        {camposPersonalizados.filter(f => f.id !== editingFieldId).map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block col-span-2 sm:col-span-1">
                      <span className="text-[10px] font-bold text-slate-500 block mb-1 uppercase">Quando o Valor for</span>
                      <input
                        type="text"
                        value={fieldDependsOnValue}
                        onChange={(e) => setFieldDependsOnValue(e.target.value)}
                        placeholder="Ex: Sim, Balcao"
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                  </div>

                  {/* Checkboxes de Atributos */}
                  <div className="col-span-2 flex flex-col sm:flex-row gap-4 pt-1">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-650 dark:text-slate-350 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fieldRequired}
                        onChange={(e) => setFieldRequired(e.target.checked)}
                        className="rounded text-blue-500 focus:ring-blue-500"
                      />
                      Campo Obrigatório
                    </label>

                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-655 dark:text-slate-355 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fieldHalfWidth}
                        onChange={(e) => setFieldHalfWidth(e.target.checked)}
                        className="rounded text-blue-500 focus:ring-blue-500"
                      />
                      Organizar em Duas Colunas (Meia Largura)
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowFieldForm(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveField}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-md transition cursor-pointer"
                  style={empresa.cor_primaria ? { backgroundColor: empresa.cor_primaria } : undefined}
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const DadosUsuario = () => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userPhotoFile, setUserPhotoFile] = useState<File | null>(null);
  const [userPhotoPreview, setUserPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    void loadUser();
  }, []);

  useEffect(() => {
    if (!userPhotoFile) return;
    const url = URL.createObjectURL(userPhotoFile);
    setUserPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [userPhotoFile]);

  async function loadUser() {
    try {
      const { data } = await api.get<UserInfo>('/usuarios/me');
      setUser(data);
      if (data?.foto_url) {
        setUserPhotoPreview(toPublicAssetUrl(data.foto_url));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  const handleUserPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setUserPhotoFile(event.target.files[0]);
    }
  };

  async function handleRemoveUserPhoto() {
    try {
      await api.delete('/usuarios/me/foto');
      setUserPhotoFile(null);
      setUserPhotoPreview(null);
      setUser((prev) => (prev ? { ...prev, foto_url: null } : prev));
    } catch (error) {
      console.error(error);
      alert('Erro ao remover foto do usuário.');
    }
  }

  async function handleSave() {
    if (!userPhotoFile) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', userPhotoFile);
      const { data } = await api.post<UserInfo>('/usuarios/me/foto', fd);
      setUser(data);
      setUserPhotoFile(null);
      if (data?.foto_url) {
        setUserPhotoPreview(toPublicAssetUrl(data.foto_url));
      }
      alert('Dados do usuário salvos com sucesso!');
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar dados do usuário.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>;
  if (!user) return <div className="p-10 text-center text-slate-500">Usuário não encontrado.</div>;

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-none p-4 sm:p-6 shadow-sm">
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
          <label className="text-xs font-bold text-slate-700 dark:text-white uppercase mb-4 flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-500" /> Minha Foto
          </label>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden border-4 border-slate-200 dark:border-slate-700 shadow-xl">
                {userPhotoPreview ? (
                  <img src={userPhotoPreview} className="w-full h-full object-cover" alt="Foto do usuário" />
                ) : (
                  <span className="text-xl font-bold text-slate-400 bg-slate-200 dark:bg-slate-800 w-full h-full flex items-center justify-center">
                    {(user?.nome || user?.email || 'U').substring(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <label className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-full cursor-pointer shadow-lg transition-transform hover:scale-110 border-4 border-white dark:border-slate-800">
                <Camera className="w-4 h-4" />
                <input type="file" accept="image/*" className="hidden" onChange={handleUserPhotoChange} />
              </label>
            </div>

            <div className="flex-1">
              <p className="text-slate-900 dark:text-white font-bold text-lg">{user?.nome || 'Usuário sem nome'}</p>
              <p className="text-sm text-slate-500 dark:text-slate-300">{user?.email}</p>
              <p className="mt-1 text-sm text-slate-400">Sua foto aparece na sidebar e nos dashboards.</p>
            </div>

            <div className="flex items-center gap-2">
              {userPhotoPreview ? (
                <button
                  type="button"
                  onClick={handleRemoveUserPhoto}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                >
                  Remover
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleSave}
                disabled={!userPhotoFile || saving}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Salvando...' : 'Salvar foto'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Nome</label>
            <input
              disabled
              value={user.nome || ''}
              className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-medium cursor-not-allowed opacity-70"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">E-mail</label>
            <input
              disabled
              value={user.email || ''}
              className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-medium cursor-not-allowed opacity-70"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTE: PLANO DE CONTAS (Wrapper) ---
const GestaoPlanoContas = () => {
  const [categorias, setCategorias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingPlano, setImportingPlano] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const setPlanoContasCache = useLookupStore((state) => state.setPlanoContas);

  // Reutiliza a lógica de carregar categorias
  async function loadCats(force = false) {
    setLoading(true);
    try {
      const data = await fetchPlanoContas(force);
      setCategorias(normalizeListResponse<any>(data));
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { loadCats(); }, []);

  // Callback para atualizar lista localmente após drag & drop
  const handleUpdate = (newCats: any[]) => {
    setCategorias(newCats);
    setPlanoContasCache(newCats);
  };

  const handleOpenImportPlano = () => {
    if (loading || importingPlano) return;
    importInputRef.current?.click();
  };

  const handleImportPlano = async (event: any) => {
    const selectedFile: File | undefined = event?.target?.files?.[0];
    if (!selectedFile) return;

    setImportingPlano(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      await api.post('/plano-contas/importar', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
      });
      await loadCats(true);
    } catch (error) {
      console.error(error);
      alert('Nao foi possivel importar o plano de contas.');
    } finally {
      if (event?.target) event.target.value = '';
      setImportingPlano(false);
    }
  };

  const handleExportPlano = async () => {
    try {
      const response = await api.get('/plano-contas/exportar', { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'plano_de_contas.csv');
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert('Nao foi possivel exportar o plano de contas.');
    }
  };

  if(loading) return <div className="p-20 text-center"><Loader2 className="animate-spin w-10 h-10 text-blue-500 mx-auto"/></div>;

  return (
    <div className="w-full animate-in fade-in">
        <div className="mb-4 rounded-none border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">Plano de Contas</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xlsm,.csv"
                className="hidden"
                onChange={handleImportPlano}
              />
              <button
                onClick={() => loadCats(true)}
                disabled={loading || importingPlano}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Sincronizar plano
              </button>
              <button
                onClick={handleOpenImportPlano}
                disabled={loading || importingPlano}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {importingPlano ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {importingPlano ? 'Importando...' : 'Importar XLSX'}
              </button>
              <button
                onClick={handleExportPlano}
                disabled={loading || importingPlano}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-4 w-4" />
                Exportar plano de contas
              </button>
            </div>
          </div>
        </div>
        
        {/* Renderiza o componente importado de Importacao.tsx */}
        <PlanoContasManager categorias={categorias} onUpdateList={handleUpdate} showTopActions={false} />
    </div>
  );
};

const ExportacaoFinanceira = () => {
  const [contas, setContas] = useState<ContaExportacao[]>([]);
  const [categorias, setCategorias] = useState<CategoriaExportacao[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoExportacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState<'csv' | 'xlsx' | null>(null);
  const [periodoIni, setPeriodoIni] = useState(() => {
    const hoje = new Date();
    return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
  });
  const [periodoFim, setPeriodoFim] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    loadLancamentos();
  }, [periodoIni, periodoFim]);

  const categoriaPorId = new Map(categorias.map((categoria) => [Number(categoria.id), categoria.nome]));
  const contaPorId = new Map(contas.map((conta) => [Number(conta.id), conta]));

  async function loadBase() {
    setLoading(true);
    try {
      const [rContas, rCategorias] = await Promise.all([
        api.get('/contas/', { params: { include_saldo: false } }),
        api.get('/plano-contas/'),
      ]);
      setContas(normalizeListResponse<ContaExportacao>(rContas.data));
      setCategorias(normalizeListResponse<CategoriaExportacao>(rCategorias.data));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadLancamentos() {
    try {
      const params: Record<string, string | number | boolean> = {
        data_inicio: periodoIni,
        data_fim: periodoFim,
        include_anexos: false,
      };
      const rows = await fetchLancamentosPaged(params, { pageSize: 1500 });
      setLancamentos(rows || []);
    } catch (error) {
      console.error(error);
    }
  }

  const resumo = lancamentos.reduce((acc, lancamento) => {
    const valor = Number(lancamento.valor_previsto || 0);
    if (String(lancamento.tipo).toUpperCase().startsWith('R')) acc.receitas += valor;
    else acc.despesas += valor;
    return acc;
  }, { receitas: 0, despesas: 0 });

  const saldo = resumo.receitas - resumo.despesas;

  const exportRows = lancamentos.map((lancamento) => ({
    data_vencimento: lancamento.data_vencimento,
    data_pagamento: lancamento.data_pagamento || '',
    descricao: lancamento.descricao,
    interessado: (lancamento as any).entidade?.nome || '',
    tipo: lancamento.tipo,
    categoria: categoriaPorId.get(Number(lancamento.plano_contas_id)) || '',
    conta: contaPorId.get(Number(lancamento.conta_id))?.nome || '',
    banco: contaPorId.get(Number(lancamento.conta_id))?.banco || '',
    competencia: lancamento.competencia || '',
    previsto: lancamento.previsto === false ? 'NAO' : 'SIM',
    valor_previsto: lancamento.valor_previsto,
    valor_pago: lancamento.valor_pago,
    status: lancamento.status,
  }));

  async function handleExport(formato: 'csv' | 'xlsx') {
    if (exportRows.length === 0) return;
    setExportando(formato);
    try {
      const fileName = `financeiro_${periodoIni}_${periodoFim}`;

      if (formato === 'csv') {
        const header = 'data_vencimento,data_pagamento,descricao,interessado,tipo,categoria,conta,banco,competencia,previsto,valor_previsto,valor_pago,status\n';
          const csv = header + exportRows.map((row) => `${row.data_vencimento},${row.data_pagamento},"${String(row.descricao).replace(/"/g, '""')}","${String(row.interessado).replace(/"/g, '""')}",${row.tipo},"${String(row.categoria).replace(/"/g, '""')}","${String(row.conta).replace(/"/g, '""')}","${String(row.banco).replace(/"/g, '""')}",${row.competencia},${row.previsto},${row.valor_previsto},${row.valor_pago},${row.status}`).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${fileName}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }

      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Financeiro');
      sheet.columns = [
        { header: 'Data Vencimento', key: 'data_vencimento', width: 16 },
        { header: 'Data Pagamento', key: 'data_pagamento', width: 16 },
        { header: 'Descrição', key: 'descricao', width: 42 },
        { header: 'Interessado', key: 'interessado', width: 24 },
        { header: 'Tipo', key: 'tipo', width: 14 },
        { header: 'Categoria', key: 'categoria', width: 24 },
        { header: 'Conta', key: 'conta', width: 24 },
        { header: 'Banco', key: 'banco', width: 20 },
        { header: 'Competência', key: 'competencia', width: 16 },
        { header: 'Previsto', key: 'previsto', width: 12 },
        { header: 'Valor Previsto', key: 'valor_previsto', width: 18 },
        { header: 'Valor Pago', key: 'valor_pago', width: 16 },
        { header: 'Status', key: 'status', width: 14 },
      ];
      exportRows.forEach((row) => sheet.addRow(row));
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${fileName}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportando(null);
    }
  }

  if (loading) {
    return <div className="p-20 text-center"><Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6">
      <div className="rounded-none border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Exportação financeira</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Baixe o financeiro por período</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-300">Essa área produz um recorte limpo do financeiro para contabilidade, auditoria, fechamento ou compartilhamento com o cliente.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Receitas</p>
              <p className="mt-2 text-xl font-black text-emerald-600">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(resumo.receitas)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Despesas</p>
              <p className="mt-2 text-xl font-black text-rose-500">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(resumo.despesas)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Saldo</p>
              <p className={`mt-2 text-xl font-black ${saldo >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-500'}`}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldo)}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto]">
          <label className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400"><CalendarRange className="h-4 w-4" /> Período</span>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={periodoIni} onChange={(e) => setPeriodoIni(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-slate-700" />
              <span className="text-xs text-slate-400">até</span>
              <input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-slate-700" />
            </div>
          </label>

          <div className="grid grid-cols-1 gap-2">
            <button onClick={() => handleExport('csv')} disabled={exportRows.length === 0 || exportando !== null} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500">
              {exportando === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar CSV
            </button>
            <button onClick={() => handleExport('xlsx')} disabled={exportRows.length === 0 || exportando !== null} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40">
              {exportando === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar XLSX
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-400 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">Banco</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {lancamentos.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Sem lançamentos para o período e a conta selecionados.</td></tr>
              ) : (
                lancamentos.slice(0, 40).map((lancamento) => (
                  <tr key={lancamento.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-mono text-slate-500">{new Date(`${lancamento.data_vencimento}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-100">{lancamento.descricao}</td>
                    <td className="px-4 py-3 text-slate-500">{categoriaPorId.get(Number(lancamento.plano_contas_id)) || 'Sem categoria'}</td>
                    <td className="px-4 py-3 text-slate-500">{contaPorId.get(Number(lancamento.conta_id))?.nome || 'Sem conta'}</td>
                    <td className="px-4 py-3 text-slate-500">{contaPorId.get(Number(lancamento.conta_id))?.banco || 'Sem banco'}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${String(lancamento.status).toUpperCase() === 'PAGO' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>{lancamento.status}</span></td>
                    <td className={`px-4 py-3 text-right font-bold ${String(lancamento.tipo).toUpperCase().startsWith('R') ? 'text-emerald-600' : 'text-rose-500'}`}>{String(lancamento.tipo).toUpperCase().startsWith('D') ? '-' : ''}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(lancamento.valor_previsto || 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {lancamentos.length > 40 && <p className="mt-3 text-xs text-slate-400">Prévia limitada aos 40 registros mais recentes. O arquivo exportado inclui todas as linhas retornadas pela consulta.</p>}
      </div>
    </div>
  );
};

// --- SUB-COMPONENTE: SEGURANÇA E ACESSOS ---
interface UserSessionItem {
  id: number;
  ip_address: string;
  user_agent: string;
  is_active: boolean;
  is_current: boolean;
  created_at: string;
  last_activity_at: string;
}

const SegurancaSessoes = () => {
  const [sessions, setSessions] = useState<UserSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

  async function loadSessions() {
    setLoading(true);
    try {
      const { data } = await api.get<UserSessionItem[]>('/auth/sessions');
      setSessions(data || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function handleRevokeOthers() {
    if (!window.confirm('Deseja realmente desconectar todas as outras sessões ativas?')) return;
    
    setRevoking(true);
    try {
      await api.post('/auth/sessions/revoke-others');
      alert('Outras sessões desconectadas com sucesso!');
      await loadSessions();
    } catch (error) {
      console.error(error);
      alert('Erro ao desconectar outras sessões.');
    } finally {
      setRevoking(false);
    }
  }

  function parseUserAgent(ua: string) {
    if (!ua) return { os: 'Desconhecido', browser: 'Desconhecido' };
    
    let os = 'Outro';
    if (ua.includes('Windows NT')) os = 'Windows';
    else if (ua.includes('Macintosh')) os = 'macOS';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('Linux')) os = 'Linux';

    let browser = 'Outro';
    if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Chrome') && !ua.includes('Chromium') && !ua.includes('Edg/')) browser = 'Chrome';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';

    return { os, browser };
  }

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>;

  const activeSessionsCount = sessions.filter(s => s.is_active && !s.is_current).length;

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-none p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
              <Shield className="w-6 h-6 text-indigo-500" /> Segurança e Acessos
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Gerencie e visualize as sessões ativas do seu usuário no Kyrus ERP. Identifique onde e quando a sua conta foi acessada.
            </p>
          </div>
          {activeSessionsCount > 0 && (
            <button
              onClick={handleRevokeOthers}
              disabled={revoking}
              className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer shrink-0"
            >
              {revoking ? 'Desconectando...' : 'Desconectar outros dispositivos'}
            </button>
          )}
        </div>

        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3">Dispositivo / Sistema</th>
                  <th className="px-4 py-3">Endereço IP</th>
                  <th className="px-4 py-3">Data de Login</th>
                  <th className="px-4 py-3">Última Atividade</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      Nenhuma sessão ativa ou recente encontrada.
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => {
                    const { os, browser } = parseUserAgent(session.user_agent);
                    return (
                      <tr
                        key={session.id}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${
                          session.is_current ? 'bg-indigo-50/20 dark:bg-indigo-950/10' : ''
                        }`}
                      >
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <span className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                              <Monitor className="w-5 h-5" />
                            </span>
                            <div>
                              <p className="font-bold text-slate-900 dark:text-white">
                                {browser} no {os}
                              </p>
                              <p className="text-xs text-slate-400 truncate max-w-[280px]" title={session.user_agent}>
                                {session.user_agent}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {session.ip_address}
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
                          {new Date(session.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
                          {new Date(session.last_activity_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {session.is_current ? (
                            <span className="px-2.5 py-1 text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 rounded-full border border-indigo-200/50 dark:border-indigo-900/50">
                              Dispositivo Atual
                            </span>
                          ) : session.is_active ? (
                            <span className="px-2.5 py-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 rounded-full border border-emerald-200/50 dark:border-emerald-900/50">
                              Conectado
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400 rounded-full border border-slate-200 dark:border-slate-700">
                              Desconectado
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTE: CONFIGURAÇÕES DE COMISSÕES ---
const ConfiguracoesComissoes = () => {
  const [loading, setLoading] = useState(false);
  const [savingRegra, setSavingRegra] = useState(false);
  const [savingMetas, setSavingMetas] = useState(false);
  const [deletingRegraId, setDeletingRegraId] = useState<number | null>(null);

  const currentYear = new Date().getFullYear();
  const [ano, setAno] = useState<number>(currentYear);

  // Matriz de metas dos vendedores por ano
  interface VendedorAnoMetas {
    vendedor_id: number;
    nome: string;
    email: string;
    meses: Array<{
      mes: number;
      valor_meta: number;
    }>;
  }
  const [metasMatrix, setMetasMatrix] = useState<VendedorAnoMetas[]>([]);
  const originalMetasValuesRef = useRef<Map<string, number>>(new Map());

  // Estado de edição da célula
  const [editingCell, setEditingCell] = useState<{ vendedorId: number; mes: number } | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Regras vigentes e centros de custo
  const [regras, setRegras] = useState<any[]>([]);
  const [centros, setCentros] = useState<CentroCustoOption[]>([]);

  // Formulário de Nova Regra
  const [centroCustoId, setCentroCustoId] = useState<string>('');
  const [taxaServico, setTaxaServico] = useState<number>(100);
  const [diasTolerancia, setDiasTolerancia] = useState<number>(0);
  const [redutorAtraso, setRedutorAtraso] = useState<number>(0);
  const [diasLimite, setDiasLimite] = useState<number>(365);
  const [faixas, setFaixas] = useState<Array<{ min_faturamento: number; taxa: number }>>([
    { min_faturamento: 0, taxa: 0.6 },
    { min_faturamento: 10000, taxa: 1.9 },
    { min_faturamento: 25000, taxa: 5.0 }
  ]);

  // Modal retroativo
  const [showRetroactiveModal, setShowRetroactiveModal] = useState(false);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadMetas(ano);
  }, [ano]);

  const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const formatBRL = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  async function loadInitialData() {
    setLoading(true);
    try {
      const [{ data: centrosData }, { data: regrasData }] = await Promise.all([
        api.get<CentroCustoOption[]>('/centro-custo/'),
        api.get<any[]>('/comissoes/config/regras')
      ]);

      const centrosAtivos = normalizeListResponse<CentroCustoOption>(centrosData)
        .filter((item) => String(item.status || 'ATIVO').toUpperCase() === 'ATIVO')
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

      setCentros(centrosAtivos);
      setRegras(regrasData);
    } catch (error) {
      console.error(error);
      alert('Erro ao carregar configurações de comissão.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMetas(selectedYear: number) {
    try {
      const { data } = await api.get<VendedorAnoMetas[]>(`/comissoes/config/metas/ano/${selectedYear}`);
      setMetasMatrix(data);
      
      const map = new Map<string, number>();
      data.forEach((v) => {
        v.meses.forEach((m) => {
          map.set(`${v.vendedor_id}:${m.mes}`, m.valor_meta);
        });
      });
      originalMetasValuesRef.current = map;
      setEditingCell(null);
      setEditingValue('');
    } catch (error) {
      console.error(error);
      alert('Erro ao carregar metas dos vendedores.');
    }
  }

  function handleAddFaixa() {
    setFaixas([...faixas, { min_faturamento: 0, taxa: 0 }]);
  }

  function handleRemoveFaixa(index: number) {
    setFaixas(faixas.filter((_, i) => i !== index));
  }

  function handleFaixaChange(index: number, field: 'min_faturamento' | 'taxa', value: number) {
    const updated = [...faixas];
    updated[index][field] = value;
    setFaixas(updated);
  }

  function handleSaveRegraClick() {
    if (faixas.length === 0) {
      alert('Adicione pelo menos uma faixa de comissão para produtos.');
      return;
    }
    setShowRetroactiveModal(true);
  }

  async function handleConfirmRegraSave(retroativo: boolean) {
    setShowRetroactiveModal(false);
    setSavingRegra(true);
    try {
      const faixasDec = faixas.map((f) => ({
        min_faturamento: Number(f.min_faturamento),
        taxa: Number(f.taxa) / 100
      }));

      const payload = {
        centro_custo_id: centroCustoId ? Number(centroCustoId) : null,
        taxa_servico: Number(taxaServico) / 100,
        dias_tolerancia_atraso: Number(diasTolerancia),
        redutor_atraso_intermediario_pct: Number(redutorAtraso) / 100,
        dias_limite_atraso: Number(diasLimite),
        faixas_produtos_json: JSON.stringify(faixasDec),
        retroativo
      };

      await api.post('/comissoes/config/regras', payload);
      alert('Regra de comissão salva com sucesso!');
      
      const { data: regrasData } = await api.get('/comissoes/config/regras');
      setRegras(regrasData);
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao salvar regra de comissão.');
    } finally {
      setSavingRegra(false);
    }
  }

  async function handleDeleteRegra(id: number) {
    if (!window.confirm('Tem certeza que deseja remover esta regra?')) return;
    setDeletingRegraId(id);
    try {
      await api.delete(`/comissoes/config/regras/${id}`);
      alert('Regra de comissão removida!');
      setRegras(regras.filter((r) => r.id !== id));
    } catch (error) {
      console.error(error);
      alert('Erro ao remover regra.');
    } finally {
      setDeletingRegraId(null);
    }
  }

  // Matriz goals editing functions
  function beginCellEdit(vendedorId: number, mes: number, currentValue: number) {
    setEditingCell({ vendedorId, mes });
    setEditingValue(String(currentValue));
  }

  function commitEditingCell() {
    if (!editingCell) return;
    const nextVal = Number(editingValue);
    const safeVal = Number.isFinite(nextVal) ? nextVal : 0;
    
    setMetasMatrix((prev) => 
      prev.map((v) => {
        if (v.vendedor_id !== editingCell.vendedorId) return v;
        return {
          ...v,
          meses: v.meses.map((m) => {
            if (m.mes !== editingCell.mes) return m;
            return { ...m, valor_meta: safeVal };
          })
        };
      })
    );
    setEditingCell(null);
    setEditingValue('');
  }

  function cancelEditingCell() {
    setEditingCell(null);
    setEditingValue('');
  }

  const dirtyPayloads = useMemo(() => {
    const payloads: Array<{ vendedor_id: number; mes: number; ano: number; valor_meta: number }> = [];
    metasMatrix.forEach((v) => {
      v.meses.forEach((m) => {
        const key = `${v.vendedor_id}:${m.mes}`;
        const originalVal = originalMetasValuesRef.current.get(key) ?? 0;
        const currentVal = Number(m.valor_meta) || 0;
        if (Math.abs(currentVal - originalVal) > 0.0001) {
          payloads.push({
            vendedor_id: v.vendedor_id,
            mes: m.mes,
            ano: ano,
            valor_meta: currentVal
          });
        }
      });
    });
    return payloads;
  }, [metasMatrix, ano]);

  const hasPendingChanges = dirtyPayloads.length > 0;

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasPendingChanges) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasPendingChanges]);

  async function handleSaveChanges() {
    let currentMatrix = metasMatrix;
    if (editingCell) {
      const nextVal = Number(editingValue);
      const safeVal = Number.isFinite(nextVal) ? nextVal : 0;
      currentMatrix = metasMatrix.map((v) => {
        if (v.vendedor_id !== editingCell.vendedorId) return v;
        return {
          ...v,
          meses: v.meses.map((m) => {
            if (m.mes !== editingCell.mes) return m;
            return { ...m, valor_meta: safeVal };
          })
        };
      });
      setMetasMatrix(currentMatrix);
      setEditingCell(null);
      setEditingValue('');
    }

    const payloads: Array<{ vendedor_id: number; mes: number; ano: number; valor_meta: number }> = [];
    currentMatrix.forEach((v) => {
      v.meses.forEach((m) => {
        const key = `${v.vendedor_id}:${m.mes}`;
        const originalVal = originalMetasValuesRef.current.get(key) ?? 0;
        const currentVal = Number(m.valor_meta) || 0;
        if (Math.abs(currentVal - originalVal) > 0.0001) {
          payloads.push({
            vendedor_id: v.vendedor_id,
            mes: m.mes,
            ano: ano,
            valor_meta: currentVal
          });
        }
      });
    });

    if (!payloads.length) return;

    setSavingMetas(true);
    try {
      await api.post('/comissoes/config/metas/batch', payloads);
      alert('Metas atualizadas com sucesso!');
      await loadMetas(ano);
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar as metas.');
    } finally {
      setSavingMetas(false);
    }
  }

  async function handleResetChanges() {
    await loadMetas(ano);
  }

  const getLojaMetaForMes = (mesIndex: number) => {
    return metasMatrix.reduce((sum, v) => {
      const m = v.meses.find((item) => item.mes === mesIndex);
      return sum + (m ? m.valor_meta : 0);
    }, 0);
  };

  const getVendedorTotalAno = (v: VendedorAnoMetas) => {
    return v.meses.reduce((sum, m) => sum + m.valor_meta, 0);
  };

  const grandTotalLoja = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => i + 1)
      .reduce((sum, mes) => sum + getLojaMetaForMes(mes), 0);
  }, [metasMatrix]);

  const sortedFaixasWithRanges = useMemo(() => {
    const sorted = [...faixas].sort((a, b) => a.min_faturamento - b.min_faturamento);
    return sorted.map((f, idx) => {
      const nextFaixa = sorted[idx + 1];
      let rangeText = '';
      if (nextFaixa) {
        rangeText = `De ${formatBRL(f.min_faturamento)} até ${formatBRL(nextFaixa.min_faturamento - 0.01)}`;
      } else {
        rangeText = `A partir de ${formatBRL(f.min_faturamento)}`;
      }
      return {
        ...f,
        rangeText,
        originalIndex: faixas.indexOf(f)
      };
    });
  }, [faixas]);

  const currentMonthName = new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-4 space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-none p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4 mb-4">
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-blue-500" /> Metas Mensais de Vendas
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Defina a meta de faturamento de cada vendedor por mês e acompanhe o total da loja.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <span className="font-bold">Ano</span>
              <input
                type="number"
                min={2000}
                max={2100}
                value={ano}
                onChange={(e) => setAno(Number(e.target.value) || currentYear)}
                className="w-16 border-0 bg-transparent p-0 text-right text-xs font-bold outline-none focus:ring-0"
              />
            </label>

            <button
              type="button"
              onClick={handleSaveChanges}
              disabled={!hasPendingChanges || savingMetas}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              Salvar Alterações
            </button>

            <button
              type="button"
              onClick={handleResetChanges}
              disabled={!hasPendingChanges || savingMetas}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Recarregar
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-6 h-6"/></div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <table className="w-full min-w-[1200px] border-separate border-spacing-0 text-sm">
                <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900/50">
                  <tr>
                    <th className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 dark:bg-slate-900 dark:border-slate-700 px-4 py-3 text-left">
                      Vendedor
                    </th>
                    {MONTH_LABELS.map((label) => (
                      <th key={label} className="min-w-[100px] w-[100px] border-b border-r border-slate-200 dark:border-slate-700 px-2 py-3 text-right">
                        {label}
                      </th>
                    ))}
                    <th className="border-b border-slate-200 dark:border-slate-700 px-3 py-3 text-right">
                      Total (Ano)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
                  {metasMatrix.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="px-4 py-12 text-center text-slate-400">
                        Nenhum vendedor ou meta cadastrada para este ano.
                      </td>
                    </tr>
                  ) : (
                    metasMatrix.map((v, idx) => {
                      const rowBg = idx % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/50 dark:bg-slate-900/20';
                      const totalAno = getVendedorTotalAno(v);

                      return (
                        <tr key={v.vendedor_id} className={`${rowBg} hover:bg-slate-100/50 dark:hover:bg-slate-700/20 transition-colors`}>
                          <td className={`sticky left-0 z-10 border-r border-b border-slate-200 dark:border-slate-700 px-4 py-3 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.15)] ${rowBg} font-bold text-slate-900 dark:text-white`}>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{v.nome}</p>
                              <p className="text-[10px] text-slate-400 font-medium truncate">{v.email}</p>
                            </div>
                          </td>

                          {v.meses.map((m) => {
                            const isEditing = editingCell?.vendedorId === v.vendedor_id && editingCell?.mes === m.mes;
                            const key = `${v.vendedor_id}:${m.mes}`;
                            const originalVal = originalMetasValuesRef.current.get(key) ?? 0;
                            const currentVal = m.valor_meta;
                            const isDirty = Math.abs(currentVal - originalVal) > 0.0001;
                            const cellClass = isDirty ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200 font-bold' : '';

                            return (
                              <td
                                key={m.mes}
                                onDoubleClick={() => beginCellEdit(v.vendedor_id, m.mes, currentVal)}
                                className={`min-w-[100px] w-[100px] border-r border-b border-slate-200 dark:border-slate-700 px-2 py-3 text-right cursor-text ${cellClass}`}
                                title="Clique duplo para editar"
                              >
                                <div className="flex items-center justify-end leading-tight min-h-[20px]">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      autoFocus
                                      value={editingValue}
                                      onChange={(e) => setEditingValue(e.target.value)}
                                      onBlur={commitEditingCell}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          commitEditingCell();
                                        }
                                        if (e.key === 'Escape') {
                                          e.preventDefault();
                                          cancelEditingCell();
                                        }
                                      }}
                                      className="w-full appearance-none bg-transparent px-0 py-0 text-right outline-none border-b-2 border-blue-500 text-slate-900 dark:text-slate-100 font-bold [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    />
                                  ) : (
                                    <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                                      {formatBRL(currentVal)}
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          })}

                          <td className="border-b border-slate-200 dark:border-slate-700 px-3 py-3 text-right font-black text-slate-900 dark:text-white tabular-nums bg-slate-50/30 dark:bg-slate-900/10">
                            {formatBRL(totalAno)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                  
                  {/* Linha da Meta da Loja (Soma) */}
                  {metasMatrix.length > 0 && (
                    <tr className="bg-slate-100/90 dark:bg-slate-900/90 font-black text-slate-900 dark:text-white">
                      <td className="sticky left-0 z-10 border-r border-b border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-100 dark:bg-slate-900 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.15)]">
                        <span className="text-xs uppercase tracking-wider">META DA LOJA (Soma)</span>
                      </td>
                      
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
                        const sumVal = getLojaMetaForMes(mes);
                        return (
                          <td key={mes} className="border-r border-b border-slate-200 dark:border-slate-700 px-2 py-3 text-right tabular-nums">
                            {formatBRL(sumVal)}
                          </td>
                        );
                      })}

                      <td className="border-b border-slate-200 dark:border-slate-700 px-3 py-3 text-right tabular-nums">
                        {formatBRL(grandTotalLoja)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400">
              💡 Dica: Dê um duplo clique em qualquer valor da tabela para alterar a meta daquele mês diretamente na célula.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-none p-4 sm:p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-4 mb-4">
            <Percent className="w-5 h-5 text-blue-500" /> Nova Regra de Comissão
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Centro de Custo</label>
              <select
                value={centroCustoId}
                onChange={(e) => setCentroCustoId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="">PADRÃO GLOBAL (Todas as filiais)</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Comissão de Serviços (%)</label>
              <div className="relative">
                <input
                  type="number"
                  value={taxaServico}
                  onChange={(e) => setTaxaServico(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white pr-8 pl-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">%</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/10 p-3.5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-700 dark:text-slate-300">
                <span>Penalidades de Atraso em Boleto</span>
                <span className="text-[10px] text-amber-500 normal-case font-normal">(Apenas para Boleto e Boleto Parcelado)</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5">Tolerância</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={diasTolerancia}
                      onChange={(e) => setDiasTolerancia(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 bg-white pr-12 pl-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 font-bold">dias</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5">Redutor</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={redutorAtraso}
                      onChange={(e) => setRedutorAtraso(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 bg-white pr-8 pl-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 font-bold">%</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5">Limite Máx.</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={diasLimite}
                      onChange={(e) => setDiasLimite(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 bg-white pr-12 pl-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 font-bold">dias</span>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 font-medium">
                💡 A comissão de boletos parcelados é paga conforme o cliente quita as parcelas. Atrasos além da tolerância reduzem a comissão pelo percentual do redutor, e atrasos superiores ao limite máximo zeram a comissão.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/10 p-3.5 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-700 dark:text-slate-300">
                  <span>Escalonamento de Produtos</span>
                  <span className="text-[10px] text-blue-500 normal-case font-normal">(Comissão proporcional ao faturamento)</span>
                </div>
                <button
                  type="button"
                  onClick={handleAddFaixa}
                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-500 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar Faixa
                </button>
              </div>
              
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {sortedFaixasWithRanges.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">Nenhuma faixa de comissão configurada.</p>
                ) : (
                  sortedFaixasWithRanges.map((item) => (
                    <div key={item.originalIndex} className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                      <div className="min-w-0 flex-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                          {item.rangeText}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="relative w-36">
                          <span className="absolute left-2.5 top-2 text-[10px] text-slate-400 font-bold">Mín R$</span>
                          <input
                            type="number"
                            value={item.min_faturamento}
                            onChange={(e) => handleFaixaChange(item.originalIndex, 'min_faturamento', Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-300 bg-white pl-12 pr-2 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />
                        </div>

                        <div className="relative w-24">
                          <input
                            type="number"
                            step="0.01"
                            value={item.taxa}
                            onChange={(e) => handleFaixaChange(item.originalIndex, 'taxa', Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-300 bg-white pr-6 pl-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            placeholder="Taxa"
                          />
                          <span className="absolute right-2 top-2 text-xs text-slate-400 font-bold">%</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveFaixa(item.originalIndex)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition"
                          title="Remover Faixa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end">
              <button
                onClick={handleSaveRegraClick}
                disabled={savingRegra}
                className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {savingRegra ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Regra de Comissão
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-none p-4 sm:p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-4 mb-4">
            Regras Vigentes no Banco
          </h2>
          
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
            {regras.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">Nenhuma regra de comissão cadastrada.</div>
            ) : (
              regras.map((r) => {
                let faixasObj = [];
                try {
                  faixasObj = JSON.parse(r.faixas_produtos_json);
                } catch (e) {}

                return (
                  <div key={r.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20 space-y-3 relative group">
                    <button
                      disabled={deletingRegraId === r.id}
                      onClick={() => void handleDeleteRegra(r.id)}
                      className="absolute top-4 right-4 p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {deletingRegraId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>

                    <div>
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 rounded-md">
                        {r.centro_custo_nome}
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1">Vigência a partir de: {new Date(r.data_inicio).toLocaleDateString('pt-BR')}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 block">Comissão de Serviços:</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200">{(r.taxa_servico * 100).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Atraso Boleto (Tolerância/Limite):</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200">{r.dias_tolerancia_atraso}d / {r.dias_limite_atraso}d</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 block">Redutor Atraso Boleto:</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200">{(r.redutor_atraso_intermediario_pct * 100).toFixed(1)}% de desconto</span>
                      </div>
                    </div>

                    {faixasObj.length > 0 && (
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-2">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase mb-1">Escalonamento de Produtos:</span>
                        <div className="flex flex-wrap gap-2">
                          {faixasObj.map((f: any, idx: number) => (
                            <span key={idx} className="px-2 py-1 text-[10px] font-mono bg-slate-200 dark:bg-slate-800 rounded text-slate-600 dark:text-slate-300">
                              &ge; R$ {f.min_faturamento.toLocaleString('pt-BR')} &rarr; {(f.taxa * 100).toFixed(1)}%
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showRetroactiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 animate-in zoom-in-95">
            <h3 className="text-lg font-black text-slate-900 dark:text-white">Aplicar Retroativamente?</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Você está alterando as regras vigentes para esta filial. Deseja que esta nova configuração seja aplicada de forma retroativa para as comissões calculadas desde o início do mês atual ({currentMonthName})?
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => void handleConfirmRegraSave(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Não (Apenas futuras)
              </button>
              <button
                onClick={() => void handleConfirmRegraSave(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500"
              >
                Sim (Retroativo)
              </button>
            </div>
          </div>
        </div>
      )}

      {hasPendingChanges ? (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-2xl border border-amber-200 bg-white/95 px-4 py-3 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.45)] backdrop-blur animate-[pulse_2.5s_ease-in-out_infinite] dark:border-amber-500/30 dark:bg-slate-950/95 text-slate-800 dark:text-slate-100">
          <div className="hidden sm:block">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">Alterações pendentes nas metas</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Você tem {dirtyPayloads.length} meta(s) modificada(s).</p>
          </div>
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={savingMetas}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {savingMetas ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      ) : null}
    </div>
  );
};

// --- PÁGINA PRINCIPAL ---
export function Configuracoes() {
  type ConfigTab = 'EMPRESA' | 'USUARIO' | 'SEGURANCA' | 'INTERESSADOS' | 'PLANO' | 'IMPORTACAO' | 'FINANCEIRO' | 'RBAC' | 'NFSTOCK' | 'PDV' | 'COMISSOES';
  const [searchParams, setSearchParams] = useSearchParams();
  const [menuCollapsed, setMenuCollapsed] = useState(false);

  const isConfigTab = (value: string | null): value is ConfigTab => {
    return value === 'EMPRESA' || value === 'USUARIO' || value === 'SEGURANCA' || value === 'INTERESSADOS' || value === 'PLANO' || value === 'IMPORTACAO' || value === 'FINANCEIRO' || value === 'RBAC' || value === 'NFSTOCK' || value === 'PDV' || value === 'COMISSOES';
  };

  const [activeTab, setActiveTab] = useState<ConfigTab>(() => {
    const queryTab = searchParams.get('tab');
    return isConfigTab(queryTab) ? queryTab : 'EMPRESA';
  });

  useEffect(() => {
    const queryTab = searchParams.get('tab');
    const target = isConfigTab(queryTab) ? queryTab : 'EMPRESA';
    setActiveTab((prev) => (prev === target ? prev : target));
  }, [searchParams]);

  useEffect(() => {
    const currentTab = searchParams.get('tab');
    if ((activeTab === 'EMPRESA' && currentTab === null) || currentTab === activeTab) {
      return;
    }

    const next = new URLSearchParams(searchParams);
    if (activeTab === 'EMPRESA') {
      next.delete('tab');
    } else {
      next.set('tab', activeTab);
    }
    setSearchParams(next, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  const tabs: Array<{ key: ConfigTab; label: string; description: string; icon: any }> = [
    { key: 'EMPRESA', label: 'Minha Empresa', description: 'Identidade visual e dados da conta', icon: Building2 },
    { key: 'USUARIO', label: 'Meu Usuário', description: 'Foto e dados da conta', icon: Camera },
    { key: 'SEGURANCA', label: 'Segurança e Acessos', description: 'Sessões ativas e histórico', icon: Shield },
    { key: 'INTERESSADOS', label: 'Interessados', description: 'Clientes, fornecedores e contatos', icon: Users },
    { key: 'PLANO', label: 'Plano de Contas', description: 'Estrutura e organização contábil', icon: Layers },
    { key: 'IMPORTACAO', label: 'Importação de Dados', description: 'Entradas em lote e conciliações', icon: UploadCloud },
    { key: 'FINANCEIRO', label: 'Exportação Financeira', description: 'Extração por conta e período', icon: Download },
    { key: 'PDV', label: 'Configurações do PDV', description: 'Mapeamento e liquidação de vendas', icon: ShoppingBag },
    { key: 'NFSTOCK', label: 'NFStock', description: 'Credenciais por centro de custo', icon: UploadCloud },
    { key: 'RBAC', label: 'Perfis de Acesso', description: 'Permissões e governança', icon: Layers },
    { key: 'COMISSOES', label: 'Comissões e Metas', description: 'Regras de comissão e metas de vendas', icon: DollarSign },
  ];

  const getTabClass = (tab: ConfigTab) => {
    const active = activeTab === tab;
    return `flex w-full rounded-xl border transition ${menuCollapsed ? 'items-center justify-center px-2 py-2.5' : 'items-start gap-3 px-3 py-3 text-left'} ${active ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300' : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'}`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex w-full min-h-0 flex-1 flex-col px-0 pb-0 pt-0">
        <div className={`grid min-h-0 flex-1 gap-0 ${menuCollapsed ? 'lg:grid-cols-[86px_minmax(0,1fr)]' : 'lg:grid-cols-[260px_minmax(0,1fr)]'}`}>
          <aside className="custom-scrollbar rounded-none border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80 lg:max-h-full lg:overflow-y-auto">
            <div className={`mb-2 flex ${menuCollapsed ? 'justify-center' : 'justify-end'}`}>
              <button
                type="button"
                onClick={() => setMenuCollapsed((prev) => !prev)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                title={menuCollapsed ? 'Expandir menu' : 'Recolher menu'}
                aria-label={menuCollapsed ? 'Expandir menu de configurações' : 'Recolher menu de configurações'}
              >
                {menuCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>
            <div className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={getTabClass(tab.key)}
                    title={menuCollapsed ? tab.label : undefined}
                  >
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-200">
                      <Icon className="h-4 w-4" />
                    </span>
                    {!menuCollapsed ? (
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{tab.label}</span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{tab.description}</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="custom-scrollbar min-h-0 overflow-y-auto pr-0 animate-in fade-in">
            {activeTab === 'EMPRESA' && <DadosEmpresa />}
            {activeTab === 'USUARIO' && <DadosUsuario />}
            {activeTab === 'SEGURANCA' && <SegurancaSessoes />}
            {activeTab === 'INTERESSADOS' && (
              <div className="animate-in fade-in slide-in-from-right-4">
                <Entidades />
              </div>
            )}
            {activeTab === 'PLANO' && <GestaoPlanoContas />}
            {activeTab === 'IMPORTACAO' && (
              <div className="animate-in fade-in slide-in-from-right-4">
                <Importacao embedded />
              </div>
            )}
            {activeTab === 'FINANCEIRO' && <ExportacaoFinanceira />}
            {activeTab === 'PDV' && <ConfiguracoesPDV />}
            {activeTab === 'NFSTOCK' && <IntegracaoNfstockCentroCusto />}
            {activeTab === 'RBAC' && <RbacManager />}
            {activeTab === 'COMISSOES' && <ConfiguracoesComissoes />}
          </section>
        </div>
      </div>
    </div>
  );
}

const formatMonetario = (val: string | number) => {
  const cleanVal = typeof val === 'number' ? val.toFixed(2).replace('.', '') : String(val || '').replace(/\D/g, '');
  if (!cleanVal) return '';
  const num = parseInt(cleanVal, 10) / 100;
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
};

const parseMonetario = (val: string | number): number => {
  if (typeof val === 'number') return val;
  const cleanVal = String(val || '').replace(/\D/g, '');
  if (!cleanVal) return 0;
  return parseInt(cleanVal, 10) / 100;
};