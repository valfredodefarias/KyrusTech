import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../services/api';
import { BrandAvatar, CARD_BRAND_OPTIONS, inferCardBrand } from '../components/BrandAvatar';
import { 
  Plus, RefreshCw, Edit2, X, Check, Loader2, 
    ChevronLeft, ChevronRight, CheckCircle2, Building2, ChevronDown
} from 'lucide-react';

// --- INTERFACES ---
interface Cartao {
  id: number;
  nome_cartao: string;
    bandeira?: string | null;
  limite_total: number;
  dia_fechamento: number;
  dia_vencimento: number;
  centro_custo_id?: number;
  conta_id?: number;
  status: 'ATIVO' | 'INATIVO';
  empresa_id: number;
}

interface Lancamento {
  id: number;
  descricao: string;
  valor_previsto: number;
  data_competencia: string;
  data_vencimento: string;
  numero_parcela?: string;
  status: 'PAGO' | 'PENDENTE';
  cartao_id?: number;
}

interface Categoria {
    id: number;
    nome: string;
    tipo?: string;
    eh_cabecalho?: boolean;
    permite_lancamentos?: boolean;
}

interface CentroCusto { id: number; nome?: string; descricao?: string; }
interface Conta { id: number; nome?: string; descricao?: string; }

// --- COMPONENTE INPUT ---
const InputDark = (props: any) => (
  <div className="w-full">
    {props.label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{props.label}</label>}
    <input 
      {...props} 
    className={`w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 ${props.className || ''}`} 
    />
  </div>
);

const SearchableSelect = ({ options, value, onChange, placeholder, label }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.flatMap((g:any) => g.options).find((o:any) => String(o.id) === String(value));

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
            {label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{label}</label>}
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 cursor-pointer flex justify-between items-center text-sm min-h-11.5 hover:border-blue-500 transition shadow-sm"
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

export function Cartoes() {
  // --- TRAVA DE SEGURANÇA CONTRA DUPLA REQUISIÇÃO ---
  const dataFetchedRef = useRef(false);
    const autoFaturaRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
    const [categorias, setCategorias] = useState<Categoria[]>([]);

  const [selectedCartaoId, setSelectedCartaoId] = useState<number | null>(null);
  const [mesFatura, setMesFatura] = useState(new Date());
  const [filtroCC, setFiltroCC] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');

  const [showDrawer, setShowDrawer] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
    const [showAddLancamento, setShowAddLancamento] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [formData, setFormData] = useState({
    id: null as number | null,
    nome_cartao: '',
        bandeira: '',
    limite_total: '',
    dia_fechamento: '',
    dia_vencimento: '',
    centro_custo_id: '',
    conta_id: '',
    status: 'ATIVO'
  });

  const [payData, setPayData] = useState({
    data: new Date().toISOString().split('T')[0],
    conta_id: ''
  });

    const [novoLancamento, setNovoLancamento] = useState({
        descricao: '',
        valor: '',
        data_compra: new Date().toISOString().split('T')[0],
        plano_contas_id: '',
        is_parcelado: false,
        qtd_parcelas: 2,
        modo_calculo: 'TOTAL'
    });

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    const formatDateYMD = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const getMonthKey = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    };

    const parseDateOnly = (value?: string | null) => {
        if (!value) return null;
        const datePart = value.slice(0, 10);
        const [y, m, d] = datePart.split('-').map(Number);
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d);
    };

    const computeCartaoVencimento = (purchaseDate?: string, cartao?: Cartao | null) => {
        if (!purchaseDate || !cartao) return null;
        const [y, m, d] = purchaseDate.split('-').map(Number);
        if (!y || !m || !d) return null;

        const fechamento = Number(cartao.dia_fechamento || 1);
        const venc = Number(cartao.dia_vencimento || 10);
        const statementOffset = d > fechamento ? 1 : 0;
        const dueOffset = statementOffset + (venc <= fechamento ? 1 : 0);
        const monthIndex = (m - 1) + dueOffset;
        const daysInMonth = new Date(y, monthIndex + 1, 0).getDate();
        const day = Math.min(venc, daysInMonth);
        return formatDateYMD(new Date(y, monthIndex, day));
    };

    const getCurrentInvoiceDueDate = (cartao: Cartao, baseDate: Date) => {
        const y = baseDate.getFullYear();
        const m = baseDate.getMonth();
        const d = baseDate.getDate();
        const fechamento = Number(cartao.dia_fechamento || 1);
        const venc = Number(cartao.dia_vencimento || 10);
        const statementOffset = d > fechamento ? 1 : 0;
        const dueOffset = statementOffset + (venc <= fechamento ? 1 : 0);
        const monthIndex = m + dueOffset;
        const daysInMonth = new Date(y, monthIndex + 1, 0).getDate();
        const day = Math.min(venc, daysInMonth);
        return new Date(y, monthIndex, day);
    };

  useEffect(() => {
    // SE JÁ CARREGOU, NÃO CARREGA DE NOVO
    if (dataFetchedRef.current) return;
    dataFetchedRef.current = true;

    const cor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
    if(cor) setPrimaryColor(cor);
    carregarDados();
  }, []);

    useEffect(() => {
        if (centros.length === 1) {
            const onlyId = String(centros[0].id);
            setFiltroCC(prev => prev || onlyId);
            setFormData(prev => prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId });
        }
    }, [centros]);

  async function carregarDados() {
    setLoading(true);
    try {
      console.log("⚡ Carregando dados de Cartões (Única Vez)...");

                        const [resC, resL, resCC, resConta, resCat] = await Promise.all([
                api.get('/cartoes/'),
                api.get('/lancamentos/', { params: { limit: 2000 } }),
                api.get('/centro-custo/'),
                api.get('/contas/', { params: { include_saldo: false } }),
                api.get('/plano-contas/')
            ]);

      setCartoes(resC.data || []);
      setLancamentos(resL.data || []);
    setCentros(resCC.data || []);
    setContas(resConta.data || []);
    setCategorias(resCat.data || []);
    } catch (e: any) { 
        console.error("Erro ao carregar dados:", e);
    } finally { 
        setLoading(false); 
    }
  }

  const filteredCartoes = cartoes.filter(c => !filtroCC || String(c.centro_custo_id) === filtroCC);

    const catOptions = [
        { label: 'DESPESAS', options: categorias.filter(c=> (c.tipo||'').trim().toUpperCase().startsWith('D')).map(c=>({id:c.id, label:c.nome, tipo: c.tipo, grupo: 'DESPESAS', disabled: c.eh_cabecalho || c.permite_lancamentos === false, eh_cabecalho: c.eh_cabecalho, permite_lancamentos: c.permite_lancamentos})) }
    ];

    useEffect(() => {
        if (!selectedCartaoId) return;
        if (autoFaturaRef.current === selectedCartaoId) return;
        const cartao = cartoes.find(c => c.id === selectedCartaoId);
        if (!cartao) return;

        const currentDue = getCurrentInvoiceDueDate(cartao, new Date());
        const prevDue = new Date(currentDue.getFullYear(), currentDue.getMonth() - 1, currentDue.getDate());
        const prevKey = getMonthKey(prevDue);

        const hasPrevPending = lancamentos.some(l => l.cartao_id === cartao.id && l.data_vencimento?.startsWith(prevKey) && l.status !== 'PAGO');
        const target = hasPrevPending ? prevDue : currentDue;
        setMesFatura(new Date(target.getFullYear(), target.getMonth(), 1));
        autoFaturaRef.current = selectedCartaoId;
    }, [selectedCartaoId, cartoes, lancamentos]);

  const faturaAtual = useMemo(() => {
    if (!selectedCartaoId) return { itens: [], total: 0, pendente: 0, vencimento: null };
    const cartao = cartoes.find(c => c.id === selectedCartaoId);
    if(!cartao) return { itens: [], total: 0, pendente: 0, vencimento: null };

    const ano = mesFatura.getFullYear();
    const mes = mesFatura.getMonth();
    const diaVenc = cartao.dia_vencimento > 28 ? 28 : (cartao.dia_vencimento || 10);
    const vencimento = new Date(ano, mes, diaVenc);
    const strMes = vencimento.toISOString().slice(0, 7); 
    
    const itens = lancamentos.filter(l => l.cartao_id === cartao.id && l.data_vencimento.startsWith(strMes));
    const total = itens.reduce((acc, l) => acc + (Number(l.valor_previsto) || 0), 0);
    const pendente = itens.filter(l => l.status !== 'PAGO').reduce((acc, l) => acc + (Number(l.valor_previsto) || 0), 0);

    return { itens, total, pendente, vencimento };
  }, [selectedCartaoId, mesFatura, lancamentos, cartoes]);

  function handleOpenCreate() {
    setFormData({ 
        id: null, nome_cartao: '', bandeira: '', limite_total: '', dia_fechamento: '', dia_vencimento: '', 
        centro_custo_id: '', conta_id: '', status: 'ATIVO' 
    });
    setIsEditing(false);
    setShowDrawer(true);
  }

  function handleOpenEdit(c: Cartao, e: React.MouseEvent) {
    e.stopPropagation();
    setIsEditing(true);
    setFormData({
        id: c.id,
        nome_cartao: c.nome_cartao, 
        bandeira: c.bandeira || '',
        limite_total: String(c.limite_total || 0),
        dia_fechamento: String(c.dia_fechamento), 
        dia_vencimento: String(c.dia_vencimento),
        centro_custo_id: c.centro_custo_id ? String(c.centro_custo_id) : '',
        conta_id: c.conta_id ? String(c.conta_id) : '',
        status: c.status || 'ATIVO'
    });
    setShowDrawer(true);
  }

  const safeFloat = (val: any) => { const v = parseFloat(String(val).replace(',', '.')); return isNaN(v) ? 0 : v; };
  const safeInt = (val: any) => { 
      if (!val || val === '') return null;
      const v = parseInt(String(val)); 
      return isNaN(v) ? null : v; 
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.nome_cartao || !formData.limite_total) return alert("Preencha Nome e Limite.");
    
    setSaving(true);
    try {
        const payload = {
            nome_cartao: formData.nome_cartao,
            bandeira: formData.bandeira || null,
            limite_total: safeFloat(formData.limite_total),
            dia_fechamento: safeInt(formData.dia_fechamento) || 1,
            dia_vencimento: safeInt(formData.dia_vencimento) || 10,
            centro_custo_id: safeInt(formData.centro_custo_id),
            conta_id: safeInt(formData.conta_id),
            empresa_id: 0 
        };

        if (isEditing && formData.id) {
            await api.put(`/cartoes/${formData.id}`, payload);
        } else {
            await api.post('/cartoes/', payload);
        }

        setShowDrawer(false);
        // Force reload bypass ref
        dataFetchedRef.current = false; 
        carregarDados();
        dataFetchedRef.current = true;
    } catch(e: any) { 
        console.error("Erro no save:", e);
        alert("Erro ao salvar.");
    } finally { 
        setSaving(false); 
    }
  }

  async function handlePayInvoice() {
    if(!faturaAtual.itens.length) return;
    setSaving(true);
    try {
        const ids = faturaAtual.itens.filter(l => l.status !== 'PAGO').map(l => l.id);
        
        await api.post('/lancamentos/bulk-pay', {
            ids,
            data_pagamento: payData.data,
            conta_id: payData.conta_id ? parseInt(payData.conta_id) : null,
            copiar_valor: true
        });
        
        setShowPayModal(false);
        dataFetchedRef.current = false;
        carregarDados();
        dataFetchedRef.current = true;
    } catch(e) { alert("Erro ao pagar fatura"); } finally { setSaving(false); }
  }

    async function handleCreateLancamentoCartao(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedCartaoId) return;
        const cartao = cartoes.find(c => c.id === selectedCartaoId);
        if (!cartao) return;
        if (!novoLancamento.descricao || !novoLancamento.valor || !novoLancamento.plano_contas_id) {
            alert('Preencha descrição, categoria e valor.');
            return;
        }

        setSaving(true);
        try {
            const dataCompra = novoLancamento.data_compra || new Date().toISOString().split('T')[0];
            const valorBase = parseFloat(novoLancamento.valor);

            if (novoLancamento.is_parcelado) {
                const qtd = Math.max(2, Number(novoLancamento.qtd_parcelas) || 2);
                const valorParcela = novoLancamento.modo_calculo === 'TOTAL' ? (valorBase / qtd) : valorBase;

                const [y, m, d] = dataCompra.split('-').map(Number);
                const lista = Array.from({ length: qtd }).map((_, i) => {
                    const dt = new Date(y, (m - 1) + i, d);
                    const compra = formatDateYMD(dt);
                    const venc = computeCartaoVencimento(compra, cartao) || compra;
                    return {
                        descricao: `${novoLancamento.descricao} (${i + 1}/${qtd})`,
                        tipo: 'DESPESA',
                        valor_previsto: valorParcela,
                        data_vencimento: venc,
                        data_competencia: compra,
                        plano_contas_id: parseInt(novoLancamento.plano_contas_id),
                        cartao_id: cartao.id,
                        centro_custo_id: cartao.centro_custo_id ?? null,
                        status: 'PENDENTE',
                        numero_parcela: i + 1
                    };
                });

                await api.post('/lancamentos/bulk', lista);
            } else {
                const dataVenc = computeCartaoVencimento(dataCompra, cartao) || dataCompra;
                const payload = {
                    descricao: novoLancamento.descricao,
                    tipo: 'DESPESA',
                    valor_previsto: valorBase,
                    data_vencimento: dataVenc,
                    data_competencia: dataCompra,
                    plano_contas_id: parseInt(novoLancamento.plano_contas_id),
                    cartao_id: cartao.id,
                    centro_custo_id: cartao.centro_custo_id ?? null,
                    status: 'PENDENTE'
                };

                await api.post('/lancamentos/', payload);
            }
            setShowAddLancamento(false);
            setNovoLancamento({
                descricao: '',
                valor: '',
                data_compra: new Date().toISOString().split('T')[0],
                plano_contas_id: '',
                is_parcelado: false,
                qtd_parcelas: 2,
                modo_calculo: 'TOTAL'
            });
            dataFetchedRef.current = false;
            carregarDados();
            dataFetchedRef.current = true;
        } catch (e) {
            console.error('Erro ao criar lançamento no cartão', e);
            alert('Erro ao criar lançamento no cartão.');
        } finally {
            setSaving(false);
        }
    }

  const CardVisual = ({ dados, previewMode = false }: any) => {
    const cc = centros.find(c => String(c.id) === String(dados.centro_custo_id));
    const nomeCC = cc ? (cc.nome || cc.descricao || 'GERAL') : 'GERAL';
        const brand = inferCardBrand(dados.bandeira, dados.nome_cartao);
    
    const limiteTotal = parseFloat(String(dados.limite_total).replace(',', '.')) || 0;
    let disponivel = limiteTotal;
    let percentual = 0;
    
    if (!previewMode && dados.id) {
        const gastos = lancamentos
            .filter(l => l.cartao_id === dados.id && l.status !== 'PAGO')
            .reduce((acc, l) => acc + (Number(l.valor_previsto) || 0), 0);
            
        disponivel = limiteTotal - gastos;
        percentual = limiteTotal > 0 ? (gastos / limiteTotal) * 100 : 0;
    }

    return (
        <div className={`relative overflow-hidden rounded-xl p-6 text-white shadow-lg transition-all duration-300 ${previewMode ? 'h-48' : 'h-48 cursor-pointer hover:shadow-xl hover:scale-[1.02]'}`}
             style={{ background: `linear-gradient(135deg, ${brand.accent} 0%, #0f172a 100%)` }}>
            
            <div className="absolute top-0 right-0 -mr-10 -mt-10 w-32 h-32 bg-white opacity-10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="flex justify-between items-start z-10 relative">
                <div>
                    <div className="font-mono text-xs opacity-70 tracking-widest font-bold">{brand.label.toUpperCase()}</div>
                    <div className="mt-2 text-[10px] bg-white/20 px-2 py-0.5 rounded font-bold uppercase backdrop-blur-sm shadow-sm w-fit">{nomeCC}</div>
                </div>
                <BrandAvatar visual={brand} size="sm" className="border-white/20 bg-white/90" />
            </div>

            <div className="mt-4 z-10 relative">
                <div className="text-[10px] uppercase opacity-70 mb-1">Nome do Cartão</div>
                <div className="font-bold text-xl tracking-wide truncate">{dados.nome_cartao || 'NOVO CARTÃO'}</div>
            </div>

            <div className="mt-auto pt-4 flex justify-between items-end z-10 relative">
                <div>
                    <div className="text-[10px] uppercase opacity-70">Disponível</div>
                    <div className="font-bold font-mono text-lg">{BRL.format(disponivel)}</div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase opacity-70">Vence Dia</div>
                    <div className="font-bold font-mono text-xl">{dados.dia_vencimento || '--'}</div>
                </div>
            </div>

            {!previewMode && (
                <div className="absolute bottom-0 left-0 w-full h-1.5 bg-black/30">
                    <div className="h-full bg-white transition-all duration-1000 ease-out shadow-[0_0_10px_white]" style={{ width: `${Math.min(percentual, 100)}%` }}></div>
                </div>
            )}
        </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-y-auto custom-scrollbar">
    <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 sticky top-0 z-20 shadow-md">
        <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Cartões de Crédito</h2>
            <p className="text-sm text-slate-400">Gestão de limites e faturas</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none sm:w-48">
                <Building2 className="absolute left-3 top-2.5 w-4 h-4 text-slate-400"/>
                <select className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-white text-sm outline-none focus:ring-2 focus:ring-blue-500" value={filtroCC} onChange={e => setFiltroCC(e.target.value)}>
                    <option value="">Todas as Filiais</option>
                    {centros.map(c => <option key={c.id} value={c.id}>{c.nome || c.descricao}</option>)}
                </select>
            </div>
            <button onClick={() => { dataFetchedRef.current = false; carregarDados(); }} className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition"><RefreshCw className={`w-5 h-5 ${loading?'animate-spin':''}`}/></button>
            <button onClick={handleOpenCreate} className="px-4 py-2 rounded-lg text-white font-bold text-sm shadow hover:brightness-110 flex items-center gap-2 w-full sm:w-auto justify-center" style={{backgroundColor: primaryColor}}><Plus className="w-4 h-4"/> Novo</button>
        </div>
      </header>

      <div className="p-6 space-y-8 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCartoes.length === 0 && !loading && (
                <div className="col-span-full py-12 text-center text-slate-500 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl">Nenhum cartão encontrado. Clique em "Novo" para criar.</div>
            )}
            {filteredCartoes.map(c => (
                <div key={c.id} className={`rounded-xl transition group relative ${selectedCartaoId === c.id ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-blue-500' : ''}`} onClick={() => setSelectedCartaoId(c.id)}>
                    <CardVisual dados={c} />
                    <button onClick={(e) => handleOpenEdit(c, e)} className="absolute top-4 right-4 p-1.5 bg-black/20 hover:bg-black/40 rounded text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition"><Edit2 className="w-4 h-4"/></button>
                    {selectedCartaoId === c.id && <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-4 h-4 bg-white dark:bg-slate-800 rotate-45 border-b border-r border-slate-200 dark:border-slate-700 z-0"></div>}
                </div>
            ))}
        </div>

        {selectedCartaoId && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden animate-in slide-in-from-top-4 fade-in duration-300">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setMesFatura(new Date(mesFatura.setMonth(mesFatura.getMonth() - 1)))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"><ChevronLeft className="w-6 h-6"/></button>
                        <div className="text-center min-w-45">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Fatura de</p>
                            <h3 className="text-2xl font-black text-slate-800 dark:text-white capitalize">{faturaAtual.vencimento?.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) || mesFatura.toLocaleDateString('pt-BR', { month: 'long' })}</h3>
                        </div>
                        <button onClick={() => setMesFatura(new Date(mesFatura.setMonth(mesFatura.getMonth() + 1)))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"><ChevronRight className="w-6 h-6"/></button>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700/50 w-full">
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Total da Fatura</p>
                            <p className="text-2xl font-black text-slate-800 dark:text-white">{BRL.format(faturaAtual.total)}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Vence dia {faturaAtual.vencimento?.toLocaleDateString('pt-BR', {day:'numeric', month:'short'}) || '--'}</p>
                        </div>
                                                <button
                                                    onClick={() => {
                                                        const defaultCat = categorias.find(c => (c.tipo || '').toUpperCase().startsWith('D'))?.id || categorias[0]?.id || '';
                                                        setNovoLancamento(prev => ({
                                                            ...prev,
                                                            data_compra: new Date().toISOString().split('T')[0],
                                                            plano_contas_id: prev.plano_contas_id || (defaultCat ? String(defaultCat) : '')
                                                        }));
                                                        setShowAddLancamento(true);
                                                    }}
                                                    className="bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-white px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 shadow flex items-center gap-2 transition"
                                                >
                                                    <Plus className="w-4 h-4" /> Novo lançamento
                                                </button>
                        {faturaAtual.pendente > 0 && (
                            <button onClick={() => {
                                const cartao = cartoes.find(c => c.id === selectedCartaoId);
                                setPayData({ 
                                    data: new Date().toISOString().split('T')[0], 
                                    conta_id: cartao?.conta_id ? String(cartao.conta_id) : '' 
                                });
                                setShowPayModal(true);
                            }} className="bg-emerald-600 hover:bg-emerald-500 text-white pl-4 pr-5 py-2.5 rounded-lg shadow-lg flex items-center gap-3 transition transform active:scale-95">
                                <div className="bg-white/20 p-1.5 rounded"><CheckCircle2 className="w-5 h-5"/></div>
                                <div className="text-left">
                                    <p className="text-[10px] font-bold uppercase opacity-90 leading-none mb-0.5">Pagar Fatura</p>
                                    <p className="text-sm font-bold">{BRL.format(faturaAtual.pendente)}</p>
                                </div>
                            </button>
                        )}
                    </div>
                </div>

                <div className="max-h-125 overflow-y-auto custom-scrollbar overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs font-bold text-slate-400 uppercase sticky top-0 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4">Data Compra</th>
                                <th className="px-6 py-4">Descrição</th>
                                <th className="px-6 py-4">Parcela</th>
                                <th className="px-6 py-4 text-right">Valor</th>
                                <th className="px-6 py-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                            {faturaAtual.itens.length === 0 ? (
                                <tr><td colSpan={5} className="p-10 text-center text-slate-500">Nenhuma despesa nesta fatura.</td></tr>
                            ) : (
                                faturaAtual.itens.map(l => (
                                    <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
                                                                                <td className="px-6 py-4 font-mono text-slate-500 text-xs">
                                                                                    {(parseDateOnly(l.data_competencia || l.data_vencimento) || new Date()).toLocaleDateString('pt-BR')}
                                                                                </td>
                                        <td className="px-6 py-4 font-medium text-slate-800 dark:text-white">{l.descricao}</td>
                                        <td className="px-6 py-4 text-xs text-slate-500">{l.numero_parcela || 'À vista'}</td>
                                        <td className="px-6 py-4 text-right font-bold text-slate-700 dark:text-slate-200">{BRL.format(l.valor_previsto)}</td>
                                        <td className="px-6 py-4 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${l.status==='PAGO'?'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900':'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}>{l.status}</span></td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </div>

            {showAddLancamento && (
                <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddLancamento(false)}></div>
                    <form onSubmit={handleCreateLancamentoCartao} className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 border border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white">Novo lançamento no cartão</h3>

                        <div className="space-y-4">
                            <InputDark label="Descrição" value={novoLancamento.descricao} onChange={(e:any)=>setNovoLancamento({...novoLancamento, descricao: e.target.value})} />
                            <InputDark label="Valor (R$)" type="number" step="0.01" value={novoLancamento.valor} onChange={(e:any)=>setNovoLancamento({...novoLancamento, valor: e.target.value})} />
                            <InputDark label="Data da compra" type="date" value={novoLancamento.data_compra} onChange={(e:any)=>setNovoLancamento({...novoLancamento, data_compra: e.target.value})} />
                            <div>
                                <SearchableSelect
                                  label="Categoria"
                                  placeholder="Selecione..."
                                  options={catOptions}
                                  value={novoLancamento.plano_contas_id}
                                  onChange={(id:any)=>setNovoLancamento({...novoLancamento, plano_contas_id: String(id)})}
                                />
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 accent-blue-600"
                                        checked={novoLancamento.is_parcelado}
                                        onChange={e=>setNovoLancamento({...novoLancamento, is_parcelado: e.target.checked})}
                                    />
                                    <span className="text-sm font-bold text-slate-800 dark:text-white">Lançamento parcelado</span>
                                </label>

                                {novoLancamento.is_parcelado && (
                                    <div className="mt-4 space-y-3">
                                        <div className="grid grid-cols-2 gap-4">
                                            <InputDark
                                                label="Qtd. de parcelas"
                                                type="number"
                                                min={2}
                                                value={novoLancamento.qtd_parcelas}
                                                onChange={(e:any)=>setNovoLancamento({...novoLancamento, qtd_parcelas: Math.max(2, Number(e.target.value) || 2)})}
                                            />
                                            <div>
                                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cálculo</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={()=>setNovoLancamento({...novoLancamento, modo_calculo: 'TOTAL'})}
                                                        className={`py-2 rounded-lg text-xs font-bold border transition ${novoLancamento.modo_calculo==='TOTAL' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                                    >
                                                        Total
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={()=>setNovoLancamento({...novoLancamento, modo_calculo: 'PARCELA'})}
                                                        className={`py-2 rounded-lg text-xs font-bold border transition ${novoLancamento.modo_calculo==='PARCELA' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                                    >
                                                        Por parcela
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {novoLancamento.valor && novoLancamento.qtd_parcelas && (
                                            <div className="text-xs text-slate-400">
                                                {novoLancamento.modo_calculo === 'TOTAL' ? (
                                                    <>{novoLancamento.qtd_parcelas}x de <strong className="text-blue-300">{BRL.format(Number(novoLancamento.valor) / Number(novoLancamento.qtd_parcelas || 1))}</strong></>
                                                ) : (
                                                    <>{novoLancamento.qtd_parcelas}x de <strong className="text-blue-300">{BRL.format(Number(novoLancamento.valor))}</strong> • Total {BRL.format(Number(novoLancamento.valor) * Number(novoLancamento.qtd_parcelas || 1))}</>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-2 mt-6">
                            <button type="button" onClick={() => setShowAddLancamento(false)} className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">Cancelar</button>
                            <button type="submit" disabled={saving} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow-lg transition">
                                {saving ? 'Salvando...' : 'Salvar'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

      {showDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setShowDrawer(false)}></div>
            <div className="relative w-full max-w-md bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-700">
                <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
                    <h2 className="text-lg font-bold text-white">{isEditing ? 'Editar Cartão' : 'Novo Cartão'}</h2>
                    <button onClick={() => setShowDrawer(false)} className="p-2 hover:bg-slate-700 rounded-full text-slate-400"><X className="w-5 h-5"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="transform scale-90 origin-top">
                        <CardVisual dados={formData} previewMode={true} />
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Centro de Custo</label>
                                <select className="w-full p-2.5 rounded-lg border border-slate-600 bg-slate-800 text-white text-sm outline-none focus:border-blue-500" value={formData.centro_custo_id} onChange={e => setFormData({...formData, centro_custo_id: e.target.value})}>
                                    <option value="">Selecione...</option>
                                    {centros.map(c => <option key={c.id} value={c.id}>{c.nome || c.descricao}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Conta Padrão</label>
                                <select className="w-full p-2.5 rounded-lg border border-slate-600 bg-slate-800 text-white text-sm outline-none focus:border-blue-500" value={formData.conta_id} onChange={e => setFormData({...formData, conta_id: e.target.value})}>
                                    <option value="">Perguntar ao pagar</option>
                                    {contas.map(c => <option key={c.id} value={c.id}>{c.nome || c.descricao}</option>)}
                                </select>
                            </div>
                        </div>

                        <InputDark label="Nome do Cartão" placeholder="Ex: Nubank Platinum" value={formData.nome_cartao} onChange={(e:any) => setFormData({...formData, nome_cartao: e.target.value})} />
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Bandeira</label>
                            <div className="grid grid-cols-2 gap-2">
                                {CARD_BRAND_OPTIONS.map((option: (typeof CARD_BRAND_OPTIONS)[number]) => {
                                    const selected = formData.bandeira === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, bandeira: option.value })}
                                            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${selected ? 'border-white/40 bg-white/10 text-white' : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-500'}`}
                                        >
                                            <BrandAvatar visual={option.visual} size="sm" />
                                            <span className="text-sm font-semibold">{option.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <button type="button" onClick={() => setFormData({ ...formData, bandeira: '' })} className="mt-2 text-xs font-semibold text-slate-400 hover:text-white transition">
                                Limpar bandeira selecionada
                            </button>
                        </div>
                        <InputDark label="Limite Total (R$)" type="number" step="0.01" className="font-bold text-lg" value={formData.limite_total} onChange={(e:any) => setFormData({...formData, limite_total: e.target.value})} />

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-purple-400 uppercase mb-1">Dia Fechamento</label>
                                <input type="number" min="1" max="31" className="w-full p-3 text-center rounded-lg border border-purple-900/50 bg-purple-900/20 text-purple-400 font-bold outline-none focus:border-purple-500" value={formData.dia_fechamento} onChange={e => setFormData({...formData, dia_fechamento: e.target.value})} placeholder="01" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-red-400 uppercase mb-1">Dia Vencimento</label>
                                <input type="number" min="1" max="31" className="w-full p-3 text-center rounded-lg border border-red-900/50 bg-red-900/20 text-red-400 font-bold outline-none focus:border-red-500" value={formData.dia_vencimento} onChange={e => setFormData({...formData, dia_vencimento: e.target.value})} placeholder="10" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-700 bg-slate-800 flex justify-end gap-3">
                    <button onClick={() => setShowDrawer(false)} className="px-5 py-2.5 rounded-lg text-slate-400 font-bold hover:bg-slate-700 transition">Cancelar</button>
                    <button onClick={handleSave} disabled={saving} className="px-8 py-2.5 rounded-lg text-white font-bold shadow-lg flex items-center gap-2 hover:brightness-110 disabled:opacity-50" style={{ backgroundColor: primaryColor }}>
                        {saving ? <Loader2 className="animate-spin w-4 h-4"/> : <Check className="w-4 h-4"/>} Salvar
                    </button>
                </div>
            </div>
        </div>
      )}

      {showPayModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setShowPayModal(false)}></div>
            <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 border border-slate-700">
                <h3 className="font-bold text-lg mb-4 text-white">Confirmar Pagamento</h3>
                
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 mb-4 text-center">
                    <p className="text-xs font-bold text-slate-500 uppercase">Total a Pagar</p>
                    <p className="text-3xl font-black text-emerald-500 mt-1">{BRL.format(faturaAtual.pendente)}</p>
                </div>

                <div className="space-y-4">
                    <InputDark label="Data do Pagamento" type="date" value={payData.data} onChange={(e:any) => setPayData({...payData, data: e.target.value})} />
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Sair da Conta</label>
                        <select className="w-full p-3 rounded-lg border border-slate-600 bg-slate-700 text-white outline-none focus:border-blue-500" value={payData.conta_id} onChange={e => setPayData({...payData, conta_id: e.target.value})}>
                            <option value="">Selecione...</option>
                            {contas.map(c => <option key={c.id} value={c.id}>{c.nome || c.descricao}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex gap-2 mt-6">
                    <button onClick={() => setShowPayModal(false)} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-700 rounded-lg transition">Cancelar</button>
                    <button onClick={handlePayInvoice} className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 shadow-lg transition">Confirmar</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}