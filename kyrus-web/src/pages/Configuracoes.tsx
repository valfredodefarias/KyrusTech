import { useState, useEffect } from 'react';
import { api, toPublicAssetUrl } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { 
  Building2, UploadCloud, Layers, Save, Loader2, 
  Palette, Check, AlertCircle, Camera, RefreshCw,
  Download, CalendarRange, Landmark, Trash2
} from 'lucide-react';

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
}

interface UserInfo {
  id: number;
  email: string;
  nome?: string | null;
  foto_url?: string | null;
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

// --- SUB-COMPONENTE: DADOS DA EMPRESA ---
const DadosEmpresa = () => {
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cor, setCor] = useState('#2563eb');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [userPhotoFile, setUserPhotoFile] = useState<File | null>(null);
  const [userPhotoPreview, setUserPhotoPreview] = useState<string | null>(null);
  const invalidatePlanoContas = useLookupStore((state) => state.invalidatePlanoContas);
  const canResetEmpresa = (user?.email || '').trim().toLowerCase() === 'cirocue12@gmail.com';

  useEffect(() => { loadEmpresa(); }, []);

  // Cria preview local imediato quando o usuário seleciona um arquivo
  useEffect(() => {
    if (logoFile) {
        const url = URL.createObjectURL(logoFile);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url); // Limpa memória ao desmontar
    }
  }, [logoFile]);

  useEffect(() => {
    if (userPhotoFile) {
      const url = URL.createObjectURL(userPhotoFile);
      setUserPhotoPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [userPhotoFile]);

  async function loadEmpresa() {
    try {
      const { data: userData } = await api.get<UserInfo & { empresa_id?: number }>('/usuarios/me');
      setUser(userData);
      if (userData.foto_url) {
        setUserPhotoPreview(toPublicAssetUrl(userData.foto_url));
      }
      if (userData.empresa_id) {
        const { data: emp } = await api.get(`/empresas/${userData.empresa_id}`);
        setEmpresa(emp);
        if (emp.cor_primaria) setCor(emp.cor_primaria);
        
        // Ajusta URL da logo se for relativa (vem do backend)
        if (emp.logo_url) {
          setPreviewUrl(toPublicAssetUrl(emp.logo_url));
        }
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        setLogoFile(e.target.files[0]);
    }
  };

  const handleUserPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUserPhotoFile(e.target.files[0]);
    }
  };

  async function handleRemoveUserPhoto() {
    try {
      await api.delete('/usuarios/me/foto');
      setUserPhotoFile(null);
      setUserPhotoPreview(null);
      setUser(prev => prev ? { ...prev, foto_url: null } : prev);
    } catch (e) {
      console.error(e);
      alert('Erro ao remover foto.');
    }
  }

  async function handleSave() {
    if (!empresa) return;
    setSaving(true);
    try {
       if (userPhotoFile) {
         const fdUser = new FormData();
         fdUser.append('file', userPhotoFile);
         const { data } = await api.post('/usuarios/me/foto', fdUser);
         setUser(data);
       }
        // 1. Upload da Logo (se houve alteração)
        if (logoFile) {
             const fdLogo = new FormData();
             fdLogo.append('file', logoFile); // Campo 'file' deve bater com o backend
             await api.post(`/empresas/${empresa.id}/logo`, fdLogo);
        }
        
        // 2. Atualiza Cor e Dados da Empresa
        await api.patch(`/empresas/${empresa.id}`, { cor_primaria: cor });
        
        // Aplica visualmente na hora (sem precisar de refresh para ver a cor)
        document.documentElement.style.setProperty('--color-primary', cor);
        
        alert("Configurações salvas com sucesso!");
        
        // Reload suave para propagar a logo nova para o Sidebar
        window.location.reload(); 
        
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
    <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 sm:p-8 shadow-xl">
        
        {/* CABEÇALHO COM LOGO (CROPADA/REDONDA) */}
        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 mb-10 pb-10 border-b border-slate-200 dark:border-slate-700">
          
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
                    {empresa.cnpj}
                </p>
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold rounded-full border border-emerald-500/20 flex items-center gap-1">
                    <Check className="w-3 h-3"/> CONTA ATIVA
                </span>
            </div>
          </div>
        </div>

        {/* FOTO DO USUÁRIO */}
        <div className="mb-10">
          <label className="text-xs font-bold text-slate-700 dark:text-white uppercase mb-4 flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-500"/> Minha Foto
          </label>
          <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-6">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden border-4 border-slate-200 dark:border-slate-700 shadow-xl">
                {userPhotoPreview ? (
                  <img src={userPhotoPreview} className="w-full h-full object-cover" alt="Foto do usuário" />
                ) : (
                  <span className="text-xl font-bold text-slate-400 bg-slate-200 dark:bg-slate-800 w-full h-full flex items-center justify-center">
                    {(user?.nome || user?.email || 'U').substring(0,2).toUpperCase()}
                  </span>
                )}
              </div>
              <label className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-full cursor-pointer shadow-lg transition-transform hover:scale-110 border-4 border-white dark:border-slate-800">
                <Camera className="w-4 h-4"/>
                <input type="file" accept="image/*" className="hidden" onChange={handleUserPhotoChange}/>
              </label>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-slate-900 dark:text-white font-bold mb-1">{user?.nome || user?.email}</p>
              <p className="text-sm text-slate-400">Sua foto aparece na sidebar e nos dashboards.</p>
            </div>
            {userPhotoPreview && (
              <button
                type="button"
                onClick={handleRemoveUserPhoto}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                Remover
              </button>
            )}
          </div>
        </div>

        {/* FORMULÁRIO (DADOS FISCAIS) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Razão Social</label>
            <input disabled value={empresa.razao_social} className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-medium cursor-not-allowed opacity-70" />
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Dados fiscais são protegidos.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">CNPJ</label>
            <input disabled value={empresa.cnpj} className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-mono cursor-not-allowed opacity-70" />
          </div>
        </div>

        {/* PERSONALIZAÇÃO VISUAL */}
        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-white uppercase mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-blue-500"/> Identidade Visual
          </label>
          <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-6">
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
        <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button 
            onClick={handleSave} 
            disabled={saving} 
            className="px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-xl shadow-blue-900/20 flex items-center gap-3 transition-all hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0" 
            style={{ backgroundColor: cor }}
          >
            {saving ? <Loader2 className="animate-spin w-5 h-5"/> : <Save className="w-5 h-5"/>} 
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>

        {canResetEmpresa ? (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/20">
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

// --- SUB-COMPONENTE: PLANO DE CONTAS (Wrapper) ---
const GestaoPlanoContas = () => {
  const [categorias, setCategorias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const setPlanoContasCache = useLookupStore((state) => state.setPlanoContas);

  // Reutiliza a lógica de carregar categorias
  async function loadCats(force = false) {
    setLoading(true);
    try {
      const data = await fetchPlanoContas(force);
      setCategorias(data);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { loadCats(); }, []);

  // Callback para atualizar lista localmente após drag & drop
  const handleUpdate = (newCats: any[]) => {
    setCategorias(newCats);
    setPlanoContasCache(newCats);
  };

  if(loading) return <div className="p-20 text-center"><Loader2 className="animate-spin w-10 h-10 text-blue-500 mx-auto"/></div>;

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in">
        <div className="mb-8 rounded-4xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-black text-slate-900 dark:text-white">Plano de Contas</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => loadCats(true)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Sincronizar plano
              </button>
            </div>
          </div>
        </div>
        
        {/* Renderiza o componente importado de Importacao.tsx */}
        <PlanoContasManager categorias={categorias} onUpdateList={handleUpdate} />
    </div>
  );
};

const ExportacaoFinanceira = () => {
  const [contas, setContas] = useState<ContaExportacao[]>([]);
  const [categorias, setCategorias] = useState<CategoriaExportacao[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoExportacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState<'csv' | 'xlsx' | null>(null);
  const [contaId, setContaId] = useState('');
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
  }, [periodoIni, periodoFim, contaId]);

  const categoriaPorId = new Map(categorias.map((categoria) => [Number(categoria.id), categoria.nome]));
  const contaPorId = new Map(contas.map((conta) => [Number(conta.id), conta]));

  async function loadBase() {
    setLoading(true);
    try {
      const [rContas, rCategorias] = await Promise.all([
        api.get('/contas/', { params: { include_saldo: false } }),
        api.get('/plano-contas/'),
      ]);
      setContas(rContas.data || []);
      setCategorias(rCategorias.data || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadLancamentos() {
    try {
      const params: Record<string, string | number> = {
        limit: 10000,
        data_inicio: periodoIni,
        data_fim: periodoFim,
      };
      if (contaId) params.conta_id = Number(contaId);
      const response = await api.get('/lancamentos/', { params });
      setLancamentos(response.data || []);
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
      const sufixoConta = contaId ? `conta_${contaId}` : 'todas_contas';
      const fileName = `financeiro_${periodoIni}_${periodoFim}_${sufixoConta}`;

      if (formato === 'csv') {
        const header = 'data_vencimento,data_pagamento,descricao,tipo,categoria,conta,banco,competencia,previsto,valor_previsto,valor_pago,status\n';
        const csv = header + exportRows.map((row) => `${row.data_vencimento},${row.data_pagamento},"${String(row.descricao).replace(/"/g, '""')}",${row.tipo},"${String(row.categoria).replace(/"/g, '""')}","${String(row.conta).replace(/"/g, '""')}","${String(row.banco).replace(/"/g, '""')}",${row.competencia},${row.previsto},${row.valor_previsto},${row.valor_pago},${row.status}`).join('\n');
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
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Exportação financeira</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Baixe o financeiro por período ou banco</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-300">Essa área produz um recorte limpo do financeiro para contabilidade, auditoria, fechamento ou compartilhamento com o cliente.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Receitas</p>
              <p className="mt-2 text-xl font-black text-emerald-600">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(resumo.receitas)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Despesas</p>
              <p className="mt-2 text-xl font-black text-rose-500">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(resumo.despesas)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Saldo</p>
              <p className={`mt-2 text-xl font-black ${saldo >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-500'}`}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldo)}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr_auto]">
          <label className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400"><CalendarRange className="h-4 w-4" /> Período</span>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={periodoIni} onChange={(e) => setPeriodoIni(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-slate-700" />
              <span className="text-xs text-slate-400">até</span>
              <input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-slate-700" />
            </div>
          </label>

          <label className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400"><Landmark className="h-4 w-4" /> Banco / conta</span>
            <select value={contaId} onChange={(e) => setContaId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-slate-700">
              <option value="">Todas as contas</option>
              {contas.map((conta) => (
                <option key={conta.id} value={conta.id}>{conta.nome}{conta.banco ? ` • ${conta.banco}` : ''}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 gap-2">
            <button onClick={() => handleExport('csv')} disabled={exportRows.length === 0 || exportando !== null} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500">
              {exportando === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar CSV
            </button>
            <button onClick={() => handleExport('xlsx')} disabled={exportRows.length === 0 || exportando !== null} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40">
              {exportando === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar XLSX
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-3xl border border-slate-200 dark:border-slate-700">
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

// --- PÁGINA PRINCIPAL ---
export function Configuracoes() {
  const [activeTab, setActiveTab] = useState<'EMPRESA' | 'PLANO' | 'IMPORTACAO' | 'FINANCEIRO'>('EMPRESA');

  // Classe utilitária para as abas (Estilo Sênior)
  const getTabClass = (tab: string) => `
    flex-1 py-4 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-2 cursor-pointer select-none
    ${activeTab === tab 
      ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-slate-100 dark:bg-slate-800/50' 
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/30'}
  `;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-y-auto custom-scrollbar">
      
      {/* HEADER FIXO COM TABS */}
      <div className="sticky top-0 z-30 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 px-6 pt-6">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-6">Configurações</h1>
        
        {/* TAB NAVIGATION */}
        <div className="flex w-full max-w-4xl border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setActiveTab('EMPRESA')} className={getTabClass('EMPRESA')}>
                <Building2 className="w-4 h-4"/> Minha Empresa
            </button>
            <button onClick={() => setActiveTab('PLANO')} className={getTabClass('PLANO')}>
                <Layers className="w-4 h-4"/> Plano de Contas
            </button>
            <button onClick={() => setActiveTab('IMPORTACAO')} className={getTabClass('IMPORTACAO')}>
                <UploadCloud className="w-4 h-4"/> Importação de Dados
            </button>
            <button onClick={() => setActiveTab('FINANCEIRO')} className={getTabClass('FINANCEIRO')}>
              <Download className="w-4 h-4"/> Exportação Financeira
            </button>
        </div>
      </div>

      {/* ÁREA DE CONTEÚDO */}
      <div className="p-6 pb-20">
        {activeTab === 'EMPRESA' && <DadosEmpresa />}
        {activeTab === 'PLANO' && <GestaoPlanoContas />}
        {activeTab === 'IMPORTACAO' && (
            <div className="animate-in fade-in slide-in-from-right-4">
                {/* Importação Completa */}
                <Importacao /> 
            </div>
        )}
        {activeTab === 'FINANCEIRO' && <ExportacaoFinanceira />}
      </div>
    </div>
  );
}