import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { 
  Landmark, RefreshCw, Plus, Edit2, Trash2, ChevronRight, X, Check, Loader2, ChevronDown,
  Banknote, TrendingUp, AlertTriangle, Filter, Search, Settings
} from 'lucide-react';

// --- TIPAGENS ---
interface Conta {
  id: number;
  nome: string;
  banco?: string;
  agencia?: string | null;
  conta_numero?: string | null;
  conta_digito?: string | null;
  logo_url?: string | null;
  tipo: 'CORRENTE' | 'POUPANCA' | 'CAIXA' | 'INVESTIMENTO';
  saldo_inicial: number;
  saldo_atual: number;
  centro_custo_id?: number;
  status: 'ATIVO' | 'INATIVO';
  tipo_integracao?: string | null;
}

interface CentroCusto {
  id: number;
  nome: string;
}

interface PlanoContas {
  id: number;
  nome: string;
  tipo: string;
  eh_cabecalho?: boolean;
  permite_lancamentos?: boolean;
}

interface LancamentoItem {
  id: number;
  descricao: string;
  tipo: 'RECEITA' | 'DESPESA' | string;
  status: string;
  data_vencimento: string;
  data_pagamento?: string | null;
  valor_previsto: number;
  valor_pago: number;
  plano_contas_id?: number;
  conta_id?: number | null;
  centro_custo_id?: number | null;
}

interface FormConta {
  nome: string;
  banco: string;
  agencia?: string | null;
  conta_numero?: string | null;
  conta_digito?: string | null;
  tipo: string;
  saldo_inicial: string; 
  centro_custo_id: string;
  status: string;
  logo_url?: string | null;
  tipo_integracao?: string | null;
}

interface UserData {
  empresa_id: number;
}

interface EmpresaData {
  cor_primaria: string;
}

const SearchableSelect = ({ options, value, onChange, placeholder, label }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.flatMap((g: any) => g.options).find((o: any) => String(o.id) === String(value));

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredGroups = options.map((group: any) => ({
    ...group,
    options: group.options.filter((opt: any) => opt.label.toLowerCase().includes(search.toLowerCase()))
  })).filter((group: any) => group.options.length > 0);

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer flex justify-between items-center text-sm min-h-11.5 hover:border-blue-500 transition shadow-sm"
      >
        <span className={selectedOption ? 'text-slate-800 dark:text-white font-medium' : 'text-slate-500'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400"/>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl shadow-2xl max-h-96 flex flex-col animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 rounded-t-xl">
            <input 
              autoFocus
              type="text" 
              placeholder="Pesquisar..." 
              className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none text-slate-700 dark:text-white focus:border-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-y-auto custom-scrollbar p-1">
            {filteredGroups.map((group: any, idx: number) => (
              <div key={idx} className="mb-2">
                <div className="px-3 py-1.5 text-[10px] font-bold text-blue-300 uppercase tracking-wider bg-slate-700/30 rounded mb-1 pointer-events-none select-none">
                  {group.label}
                </div>
                {group.options.map((opt: any) => (
                  (() => {
                    const isDisabled = opt.disabled || opt.eh_cabecalho || opt.permite_lancamentos === false;
                    const tipo = String(opt.tipo || opt.grupo || opt.label || '').toUpperCase();
                    const colorClass = tipo.startsWith('D') ? 'text-red-400' : tipo.startsWith('R') ? 'text-emerald-400' : '';
                    return (
                      <div 
                        key={opt.id}
                        onClick={() => { if (!isDisabled) { onChange(opt.id); setIsOpen(false); setSearch(''); } }}
                        className={`px-3 py-2 text-sm rounded transition flex items-center justify-between ${String(value) === String(opt.id) ? 'bg-blue-600 text-white' : `text-slate-600 dark:text-slate-300 ${colorClass}`} ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                      >
                        {opt.label}
                        {String(value) === String(opt.id) && <Check className="w-3 h-3"/>}
                      </div>
                    );
                  })()
                ))}
              </div>
            ))}
            {filteredGroups.length === 0 && <div className="p-4 text-center text-xs text-slate-500">Nada encontrado.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export function Contas() {
  const navigate = useNavigate();
  const bancosEspeciais = [
    {
      id: 'MANUAL',
      label: 'Nenhum',
      value: 'MANUAL',
      logo: null
    },
    {
      id: 'ITAU',
      label: 'Itaú',
      value: 'ITAU',
      logo: '/itau.png'
    },
    {
      id: 'ASAAS',
      label: 'Asaas',
      value: 'ASAAS',
      logo: '/asaas-acelerados.png'
    }
  ];
  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<Conta[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [categorias, setCategorias] = useState<PlanoContas[]>([]);
  
  // Tema Personalizado
  const [primaryColor, setPrimaryColor] = useState('#2563eb'); // Azul padrão (fallback)

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCentroId, setFilterCentroId] = useState('');

  // Drawers e Modais
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [extratoOpen, setExtratoOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [logoRemoved, setLogoRemoved] = useState(false);
  
  // Confirmação de Exclusão
  const [itemToDelete, setItemToDelete] = useState<Conta | null>(null);

  // Dados do Extrato
  const [extratoLoading, setExtratoLoading] = useState(false);
  const [contaExtratoNome, setContaExtratoNome] = useState('');
  const [extratoContaId, setExtratoContaId] = useState<number | null>(null);
  const [extratoConta, setExtratoConta] = useState<Conta | null>(null);
  const [extratoLancamentos, setExtratoLancamentos] = useState<LancamentoItem[]>([]);
  const [lancamentoModalOpen, setLancamentoModalOpen] = useState(false);
  const [lancamentoSaving, setLancamentoSaving] = useState(false);
  const [lancamentoEditing, setLancamentoEditing] = useState<LancamentoItem | null>(null);
  const [lancamentoForm, setLancamentoForm] = useState({
    descricao: '',
    tipo: 'RECEITA',
    status: 'EM ABERTO',
    data_vencimento: '',
    data_pagamento: '',
    valor_previsto: '',
    valor_pago: '',
    plano_contas_id: '',
    centro_custo_id: ''
  });

  // Formulário
  const [form, setForm] = useState<FormConta>({
    nome: '',
    banco: '',
    agencia: '',
    conta_numero: '',
    conta_digito: '',
    tipo: 'CORRENTE',
    saldo_inicial: '',
    centro_custo_id: '',
    status: 'ATIVO',
    tipo_integracao: 'MANUAL'
  });

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function getFullLogoUrl(url?: string | null) {
    if (!url) return null;
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
    if (url.startsWith('/static')) return `${baseURL}${url}`;
    if (url.startsWith('http://') && url.includes('/static/')) {
      try {
        const path = new URL(url).pathname;
        return `${baseURL}${path}`;
      } catch {
        return url;
      }
    }
    return url;
  }

  useEffect(() => {
    carregarDados();
    carregarTema();
  }, []);

  useEffect(() => {
    if (centros.length === 1) {
      const onlyId = String(centros[0].id);
      setFilterCentroId(prev => prev || onlyId);
      setForm(prev => prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId });
    }
  }, [centros]);

  // --- TEMA DINÂMICO ---
  async function carregarTema() {
    try {
      // 1. Pega ID da empresa do usuário logado
      const { data: user } = await api.get<UserData>('/usuarios/me');
      if (user.empresa_id) {
        // 2. Pega a cor da empresa
        const { data: emp } = await api.get<EmpresaData>(`/empresas/${user.empresa_id}`);
        if (emp.cor_primaria) {
          setPrimaryColor(emp.cor_primaria);
          // 3. Injeta a variável CSS para que o Tailwind (bg-[var(--color-primary)]) funcione
          document.documentElement.style.setProperty('--color-primary', emp.cor_primaria);
        }
      }
    } catch (error) {
      console.error("Erro ao carregar tema", error);
    }
  }

  async function carregarDados() {
    setLoading(true);
    try {
      const [resContas, resCentros] = await Promise.all([
        api.get('/contas/'),
        api.get('/centro-custo/') 
      ]);
      setContas(resContas.data);
      setCentros(resCentros.data);
    } catch (error) {
      console.error("Erro ao carregar dados", error);
    } finally {
      setLoading(false);
    }
  }

  async function carregarCategorias() {
    try {
      const { data } = await api.get('/plano-contas/');
      setCategorias(data || []);
    } catch (error) {
      console.error("Erro ao carregar categorias", error);
    }
  }

  // --- ACTIONS ---
  function handleOpenCreate() {
    setIsEditing(false);
    setEditingId(null);
    setForm({ nome: '', banco: '', agencia: '', conta_numero: '', conta_digito: '', tipo: 'CORRENTE', saldo_inicial: '', centro_custo_id: '', status: 'ATIVO', logo_url: null, tipo_integracao: 'MANUAL' });
    setLogoFile(null);
    setLogoPreview('');
    setLogoRemoved(false);
    setDrawerOpen(true);
  }

  function handleOpenEdit(conta: Conta) {
    setIsEditing(true);
    setEditingId(conta.id);
    setForm({
      nome: conta.nome,
      banco: conta.banco || '',
      agencia: conta.agencia || '',
      conta_numero: conta.conta_numero || '',
      conta_digito: conta.conta_digito || '',
      tipo: conta.tipo,
      saldo_inicial: String(conta.saldo_inicial || 0),
      centro_custo_id: conta.centro_custo_id ? String(conta.centro_custo_id) : '',
      status: conta.status,
      logo_url: conta.logo_url || null,
      tipo_integracao: conta.tipo_integracao || 'MANUAL'
    });
    setLogoPreview(conta.logo_url || '');
    setLogoFile(null);
    setLogoRemoved(false);
    setDrawerOpen(true);
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setLogoFile(file || null);
    setLogoRemoved(false);
    if (file) {
      const preview = URL.createObjectURL(file);
      setLogoPreview(preview);
    }
  }

  function handleClearLogo() {
    setLogoFile(null);
    setLogoPreview('');
    setLogoRemoved(true);
    setForm(prev => ({ ...prev, logo_url: null }));
  }

  async function handleSave() {
    if (!form.nome) return alert("O nome da conta é obrigatório.");
    
    setSaving(true);
    try {
      const payload = {
        ...form,
        saldo_inicial: parseFloat(form.saldo_inicial) || 0,
        centro_custo_id: form.centro_custo_id ? parseInt(form.centro_custo_id) : null,
        ...(logoRemoved ? { logo_url: null } : {})
      };

      let response;
      if (isEditing && editingId) {
        response = await api.patch(`/contas/${editingId}`, payload);
      } else {
        response = await api.post('/contas/', payload);
      }

      const contaId = isEditing && editingId ? editingId : response?.data?.id;
      if (logoFile && contaId) {
        const fd = new FormData();
        fd.append('file', logoFile);
        await api.post(`/contas/${contaId}/logo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      
      setDrawerOpen(false);
      carregarDados();
    } catch (error) {
      console.error("Erro ao salvar", error);
      alert("Erro ao salvar conta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!itemToDelete) return;
    try {
      await api.delete(`/contas/${itemToDelete.id}`);
      setItemToDelete(null);
      carregarDados();
    } catch (error) {
      console.error("Erro ao deletar", error);
      alert("Não foi possível excluir. Verifique se há lançamentos vinculados.");
    }
  }

  async function fetchLancamentosConta(contaId: number) {
    setExtratoLoading(true);
    try {
      const { data } = await api.get('/lancamentos/', {
        params: { limit: 5000, conta_id: contaId }
      });
      const items = (data || []) as LancamentoItem[];
      items.sort((a, b) => new Date(b.data_vencimento).getTime() - new Date(a.data_vencimento).getTime());
      setExtratoLancamentos(items);
    } catch (error) {
      console.error("Erro ao carregar extrato", error);
    } finally {
      setExtratoLoading(false);
    }
  }

  function resetLancamentoForm(conta?: Conta) {
    setLancamentoForm({
      descricao: '',
      tipo: 'RECEITA',
      status: 'EM ABERTO',
      data_vencimento: '',
      data_pagamento: '',
      valor_previsto: '',
      valor_pago: '',
      plano_contas_id: '',
      centro_custo_id: conta?.centro_custo_id ? String(conta.centro_custo_id) : ''
    });
  }

  async function handleVerExtrato(conta: Conta) {
    setContaExtratoNome(conta.nome);
    setExtratoContaId(conta.id);
    setExtratoConta(conta);
    setExtratoOpen(true);
    setExtratoLancamentos([]);
    if (categorias.length === 0) {
      await carregarCategorias();
    }
    await fetchLancamentosConta(conta.id);
  }

  function handleVoltarExtrato() {
    setExtratoOpen(false);
    setExtratoLancamentos([]);
    setExtratoConta(null);
    setExtratoContaId(null);
    setContaExtratoNome('');
  }

  function handleAbrirLancamentoModal(lancamento?: LancamentoItem) {
    if (lancamento) {
      setLancamentoEditing(lancamento);
      setLancamentoForm({
        descricao: lancamento.descricao || '',
        tipo: lancamento.tipo as string,
        status: lancamento.status || 'EM ABERTO',
        data_vencimento: lancamento.data_vencimento?.slice(0, 10) || '',
        data_pagamento: lancamento.data_pagamento ? lancamento.data_pagamento.slice(0, 10) : '',
        valor_previsto: String(lancamento.valor_previsto || 0),
        valor_pago: String(lancamento.valor_pago || 0),
        plano_contas_id: lancamento.plano_contas_id ? String(lancamento.plano_contas_id) : '',
        centro_custo_id: lancamento.centro_custo_id ? String(lancamento.centro_custo_id) : (extratoConta?.centro_custo_id ? String(extratoConta.centro_custo_id) : '')
      });
    } else {
      setLancamentoEditing(null);
      resetLancamentoForm(extratoConta || undefined);
    }
    setLancamentoModalOpen(true);
  }

  async function handleSalvarLancamento() {
    if (!extratoContaId) return;
    if (!lancamentoForm.descricao || !lancamentoForm.data_vencimento || !lancamentoForm.valor_previsto || !lancamentoForm.plano_contas_id) {
      alert('Preencha descrição, data, valor e categoria.');
      return;
    }
    setLancamentoSaving(true);
    try {
      const statusPago = lancamentoForm.status === 'PAGO';
      const payloadBase: any = {
        descricao: lancamentoForm.descricao,
        tipo: lancamentoForm.tipo,
        valor_previsto: Number(lancamentoForm.valor_previsto || 0),
        valor_pago: statusPago ? Number(lancamentoForm.valor_pago || lancamentoForm.valor_previsto || 0) : 0,
        data_vencimento: lancamentoForm.data_vencimento,
        data_pagamento: statusPago ? (lancamentoForm.data_pagamento || lancamentoForm.data_vencimento) : null,
        plano_contas_id: Number(lancamentoForm.plano_contas_id),
        conta_id: extratoContaId,
        centro_custo_id: lancamentoForm.centro_custo_id ? Number(lancamentoForm.centro_custo_id) : null
      };

      if (lancamentoEditing) {
        await api.put(`/lancamentos/${lancamentoEditing.id}`, {
          ...payloadBase,
          status: lancamentoForm.status
        });
      } else {
        await api.post('/lancamentos/', payloadBase);
      }
      setLancamentoModalOpen(false);
      setLancamentoEditing(null);
      resetLancamentoForm(extratoConta || undefined);
      await fetchLancamentosConta(extratoContaId);
    } catch (error) {
      console.error('Erro ao salvar lançamento', error);
      alert('Erro ao salvar lançamento.');
    } finally {
      setLancamentoSaving(false);
    }
  }

  async function handleExcluirLancamento(id: number) {
    if (!window.confirm('Deseja excluir este lançamento?')) return;
    try {
      await api.delete(`/lancamentos/${id}`);
      if (extratoContaId) {
        await fetchLancamentosConta(extratoContaId);
      }
    } catch (error) {
      console.error('Erro ao excluir lançamento', error);
      alert('Erro ao excluir lançamento.');
    }
  }

  const filteredContas = contas.filter(c => {
    const matchesSearch = c.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.banco?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCentro = filterCentroId ? String(c.centro_custo_id) === filterCentroId : true;
    return matchesSearch && matchesCentro;
  });

  const saldoTotal = filteredContas.reduce((acc, curr) => acc + (parseFloat(String(curr.saldo_atual)) || 0), 0);

  const catOptions = [
    {
      label: 'DESPESAS',
      options: categorias
        .filter(c => (c.tipo || '').trim().toUpperCase().startsWith('D'))
        .map(c => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
          disabled: c.eh_cabecalho || c.permite_lancamentos === false
        }))
    },
    {
      label: 'RECEITAS',
      options: categorias
        .filter(c => (c.tipo || '').trim().toUpperCase().startsWith('R'))
        .map(c => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
          disabled: c.eh_cabecalho || c.permite_lancamentos === false
        }))
    }
  ];

  const getIcon = (tipo: string) => {
    switch(tipo) {
      case 'CAIXA': return Banknote;
      case 'INVESTIMENTO': return TrendingUp;
      default: return Landmark;
    }
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-slate-50 dark:bg-slate-900">
      
      {/* HEADER */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm z-20 gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-800 dark:text-white">Contas Bancárias</h2>
          <p className="text-sm text-slate-400">Caixas, Bancos e Investimentos</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button 
            onClick={carregarDados}
            className="p-2 text-slate-400 transition border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 hover:brightness-95" 
            style={{ color: loading ? undefined : primaryColor }}
            title="Atualizar"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={handleOpenCreate}
            className="text-white px-5 py-2 rounded-lg shadow-md flex items-center gap-2 font-bold transition active:scale-95 text-sm whitespace-nowrap hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            <Plus className="w-4 h-4" /> Nova Conta
          </button>
        </div>
      </header>

      {/* ÁREA DE CONTEÚDO */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-6 pb-32">
        
        {extratoOpen ? (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">Extrato - {contaExtratoNome}</h3>
                <p className="text-xs text-slate-400">Lançamentos somente desta conta.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleVoltarExtrato}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-bold"
                >
                  Voltar
                </button>
                {extratoConta?.tipo_integracao === 'ITAU' && extratoContaId && (
                  <button
                    onClick={() => window.location.href = `/importacao_itau.html?conta_id=${extratoContaId}&tipo=extrato`}
                    className="px-4 py-2 rounded-lg text-white font-bold text-sm"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Importar Extrato Itaú
                  </button>
                )}
                <button
                  onClick={() => handleAbrirLancamentoModal()}
                  className="px-4 py-2 rounded-lg text-white font-bold text-sm flex items-center gap-2"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Plus className="w-4 h-4" /> Novo lançamento
                </button>
                <button
                  onClick={() => extratoContaId && fetchLancamentosConta(extratoContaId)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-bold flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${extratoLoading ? 'animate-spin' : ''}`} /> Atualizar
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="p-4">Vencimento</th>
                      <th className="p-4">Descrição</th>
                      <th className="p-4">Categoria</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Valor</th>
                      <th className="p-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-100 dark:divide-slate-700">
                    {extratoLoading ? (
                      <tr><td colSpan={6} className="p-6 text-center text-slate-400">Carregando...</td></tr>
                    ) : extratoLancamentos.length === 0 ? (
                      <tr><td colSpan={6} className="p-6 text-center text-slate-400 italic">Nenhum lançamento encontrado.</td></tr>
                    ) : (
                      extratoLancamentos.map(l => (
                        <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                          <td className="p-4 font-mono text-xs text-slate-500">
                            {new Date(l.data_vencimento).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="p-4 font-medium text-slate-700 dark:text-slate-200">{l.descricao}</td>
                          <td className="p-4 text-slate-500">
                            {categorias.find(c => c.id === l.plano_contas_id)?.nome || '-'}
                          </td>
                          <td className="p-4">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {l.status}
                            </span>
                          </td>
                          <td className={`p-4 text-right font-bold ${l.tipo === 'RECEITA' ? 'text-emerald-600' : 'text-red-600'}`}>
                            {l.tipo === 'DESPESA' ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleAbrirLancamentoModal(l)}
                                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleExcluirLancamento(l.id)}
                                className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* CARD DE RESUMO */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
                <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Saldo Geral Disponível</p>
                    <p className={`text-2xl font-black mt-1 ${saldoTotal >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>
                      {BRL.format(saldoTotal)}
                    </p>
                    {filterCentroId && (
                      <p className="text-[10px] mt-1 font-bold" style={{ color: primaryColor }}>
                        * Filtrado por Centro de Custo
                      </p>
                    )}
                </div>
                <div className="p-3 rounded-full" style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>
                    <Landmark className="w-6 h-6" />
                </div>
            </div>

            {/* BARRA DE FILTROS */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative group flex-1">
                    <Search className="absolute left-4 top-3.5 text-slate-400 transition-colors" size={20} 
                      style={{ color: searchTerm ? primaryColor : undefined }}
                    />
                    <input 
                      type="text" 
                      placeholder="Pesquisar conta..." 
                      className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition shadow-sm focus:ring-2"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="relative group w-full md:w-64">
                    <Filter className="absolute left-4 top-3.5 text-slate-400 transition-colors" size={20} 
                       style={{ color: filterCentroId ? primaryColor : undefined }}
                    />
                    <select 
                      className="w-full pl-12 pr-8 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition shadow-sm appearance-none cursor-pointer text-slate-600 dark:text-slate-300 focus:ring-2"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                      value={filterCentroId}
                      onChange={(e) => setFilterCentroId(e.target.value)}
                    >
                        <option value="">Todos os Centros</option>
                        {centros.map(c => (
                          <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                </div>
            </div>

            {/* GRID DE CONTAS */}
            {filteredContas.length === 0 && !loading ? (
               <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                 {contas.length === 0 ? "Nenhuma conta cadastrada." : "Nenhuma conta encontrada com este filtro."}
               </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {filteredContas.map(c => {
                   const IconComp = getIcon(c.tipo);
                   const saldo = parseFloat(String(c.saldo_atual || 0));
                   const nomeCentro = centros.find(ct => ct.id === c.centro_custo_id)?.nome;
                   
                   return (
                     <div key={c.id} 
                        className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 relative group transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                        style={{ '--hover-color': primaryColor } as React.CSSProperties}
                     >
                        <div 
                            className="absolute inset-0 rounded-xl border-2 border-transparent pointer-events-none transition-colors duration-300"
                            style={{ borderColor: 'transparent' }}
                        ></div>

                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-sm overflow-hidden"
                                style={{ backgroundColor: `${primaryColor}10`, color: primaryColor }}
                              >
                                {c.logo_url ? (
                                  <img src={getFullLogoUrl(c.logo_url) || ''} alt={c.nome} className="w-full h-full object-cover" />
                                ) : (
                                  <IconComp className="w-5 h-5" />
                                )}
                              </div>
                                <div>
                                    <h3 className="font-bold text-slate-700 dark:text-slate-200 leading-tight">{c.nome}</h3>
                                    <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">{c.banco || c.tipo}</p>
                                </div>
                            </div>
                            
                            <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
                                {c.tipo_integracao === 'ASAAS' && (
                                  <button
                                    onClick={() => navigate(`/integracoes/asaas?conta_id=${c.id}`)}
                                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded text-slate-500"
                                    title="Configurar integração Asaas"
                                  >
                                    <Settings className="w-4 h-4" />
                                  </button>
                                )}
                                <button onClick={() => handleOpenEdit(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded" style={{ color: primaryColor }}>
                                    <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => setItemToDelete(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded text-red-500">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                            <div className="flex justify-between items-end">
                                <div>
                                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Saldo Atual</p>
                                    <p className={`text-xl font-bold font-mono ${saldo >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>
                                      {BRL.format(saldo)}
                                    </p>
                                </div>
                                <button 
                                  onClick={() => handleVerExtrato(c)}
                                  className="text-xs font-bold hover:underline flex items-center gap-1"
                                  style={{ color: primaryColor }}
                                >
                                    Ver Extrato <ChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                            
                            {nomeCentro && (
                               <div className="mt-3 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] font-mono text-slate-500 border border-slate-200 dark:border-slate-600">
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primaryColor }}></span>
                                  {nomeCentro}
                               </div>
                            )}
                        </div>
                        
                        <div className="absolute bottom-0 left-4 right-4 h-0.5 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300" style={{ backgroundColor: primaryColor }}></div>
                     </div>
                   );
                 })}
              </div>
            )}
          </>
        )}
      </div>

      {/* --- DRAWER (MODAL LATERAL) NOVA/EDITAR CONTA --- */}
      <div 
        className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setDrawerOpen(false)}
      />
      
      <div className={`fixed inset-y-0 right-0 w-full sm:w-125 bg-white dark:bg-slate-900 z-50 transform transition-transform duration-300 ease-out border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{isEditing ? 'Editar Conta' : 'Nova Conta'}</h2>
              <button onClick={() => setDrawerOpen(false)} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full hover:opacity-80 transition">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Nome da Conta / Apelido</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor, borderColor: 'transparent' } as React.CSSProperties} // Trick for focus ring color
                    placeholder="Ex: Itaú Principal" 
                    value={form.nome}
                    onChange={e => setForm({...form, nome: e.target.value})}
                  />
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Tipo</label>
                      <select 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        value={form.tipo}
                        onChange={e => setForm({...form, tipo: e.target.value})}
                      >
                          <option value="CORRENTE">Conta Corrente</option>
                          <option value="POUPANCA">Poupança</option>
                          <option value="CAIXA">Caixa Físico</option>
                          <option value="INVESTIMENTO">Investimento</option>
                      </select>
                  </div>
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Banco</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: Nubank" 
                        value={form.banco}
                        onChange={e => setForm({...form, banco: e.target.value})}
                      />
                  </div>
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Bancos Especiais</label>
                  <div className="grid grid-cols-3 gap-3">
                      {bancosEspeciais.map(banco => {
                        const selected = (form.tipo_integracao || 'MANUAL') === banco.value;
                        return (
                          <button
                            key={banco.id}
                            type="button"
                            onClick={() => setForm({ ...form, tipo_integracao: banco.value })}
                            className={`rounded-lg border px-3 py-3 text-left transition flex flex-col gap-2 ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden shadow-sm">
                                {banco.logo ? (
                                  <img src={banco.logo} alt={banco.label} className="w-full h-full object-cover rounded-full" />
                                ) : (
                                  <span className="text-[12px] text-slate-500">—</span>
                                )}
                              </div>
                              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{banco.label}</div>
                            </div>
                            <div className={`text-[10px] uppercase font-bold ${selected ? 'text-blue-600 dark:text-blue-300' : 'text-slate-400'}`}>
                              {selected ? 'Selecionado' : 'Selecionar'}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Selecione Itaú para aparecer em Bancos Especiais.</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Agência</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: 1234" 
                        value={form.agencia || ''}
                        onChange={e => setForm({...form, agencia: e.target.value})}
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: 56789" 
                        value={form.conta_numero || ''}
                        onChange={e => setForm({...form, conta_numero: e.target.value})}
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Dígito</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: 0" 
                        value={form.conta_digito || ''}
                        onChange={e => setForm({...form, conta_digito: e.target.value})}
                      />
                  </div>
              </div>

              <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-slate-500">Logo / Foto do Banco</label>
                  <div className="flex items-center gap-3">
                      <div className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 overflow-hidden flex items-center justify-center text-[10px] text-slate-400">
                          {logoPreview || form.logo_url ? (
                            <img src={getFullLogoUrl(logoPreview || form.logo_url || '') || ''} alt="Logo" className="w-full h-full object-cover" />
                          ) : (
                            'Sem logo'
                          )}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                          <label className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                              Selecionar arquivo
                              <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                          </label>
                          {(logoPreview || form.logo_url) && (
                            <button type="button" onClick={handleClearLogo} className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 dark:bg-red-900/30 dark:text-red-200">
                                Remover
                            </button>
                          )}
                      </div>
                  </div>
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Saldo Inicial</label>
                  <input 
                    type="number" step="0.01" 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition font-bold text-lg focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    placeholder="0.00" 
                    value={form.saldo_inicial}
                    onChange={e => setForm({...form, saldo_inicial: e.target.value})}
                  />
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Vincular a Centro de Custo</label>
                  <select 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    value={form.centro_custo_id}
                    onChange={e => setForm({...form, centro_custo_id: e.target.value})}
                  >
                      <option value="">Sem vínculo</option>
                      {centros.map(cc => (
                        <option key={cc.id} value={cc.id}>{cc.nome}</option>
                      ))}
                  </select>
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Status</label>
                  <select 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    value={form.status}
                    onChange={e => setForm({...form, status: e.target.value})}
                  >
                      <option value="ATIVO">Ativa</option>
                      <option value="INATIVO">Inativa</option>
                  </select>
              </div>
          </div>

          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3">
              <button 
                onClick={() => setDrawerOpen(false)}
                className="px-5 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="px-8 py-3 rounded-xl text-white font-bold shadow-lg text-sm flex items-center gap-2 active:scale-95 transition disabled:opacity-50 hover:opacity-90"
                style={{ backgroundColor: primaryColor }}
              >
                {saving ? <Loader2 className="animate-spin w-4 h-4"/> : <Check className="w-4 h-4" />} 
                Salvar
              </button>
          </div>
      </div>

      {/* --- MODAL DE LANÇAMENTO (CRIAR/EDITAR) --- */}
      {lancamentoModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setLancamentoModalOpen(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{lancamentoEditing ? 'Editar lançamento' : 'Novo lançamento'}</h2>
              <button onClick={() => setLancamentoModalOpen(false)} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full hover:opacity-80 transition">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Descrição</label>
                <input
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.descricao}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, descricao: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Tipo</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.tipo}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, tipo: e.target.value }))}
                >
                  <option value="RECEITA">Receita</option>
                  <option value="DESPESA">Despesa</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Status</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.status}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="EM ABERTO">Em aberto</option>
                  <option value="PAGO">Pago</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Data vencimento</label>
                <input
                  type="date"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.data_vencimento}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, data_vencimento: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Data pagamento</label>
                <input
                  type="date"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.data_pagamento}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, data_pagamento: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Valor previsto</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.valor_previsto}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, valor_previsto: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Valor pago</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.valor_pago}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, valor_pago: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <SearchableSelect
                  label="Categoria"
                  options={catOptions}
                  value={lancamentoForm.plano_contas_id}
                  placeholder="Selecione..."
                  onChange={(id: number) => setLancamentoForm(prev => ({ ...prev, plano_contas_id: String(id) }))}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setLancamentoModalOpen(false)}
                className="px-5 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleSalvarLancamento}
                disabled={lancamentoSaving}
                className="px-6 py-3 rounded-xl text-white font-bold flex items-center gap-2 disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {lancamentoSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE CONFIRMAÇÃO DE EXCLUSÃO --- */}
      {itemToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={() => setItemToDelete(null)} />
           <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-scale-in border border-slate-700 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4 text-red-500">
                 <AlertTriangle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Excluir Conta?</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
                Tem certeza que deseja remover <strong>{itemToDelete.nome}</strong>? <br/>
                Lançamentos vinculados podem perder a referência.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setItemToDelete(null)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg font-bold transition">
                  Cancelar
                </button>
                <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition shadow-lg">
                  Confirmar Exclusão
                </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}