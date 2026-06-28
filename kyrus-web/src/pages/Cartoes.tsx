import { useEffect, useState, useMemo, useRef } from 'react';
import { api, normalizeListResponse } from '../services/api';
import { Lancamentos } from './Lancamentos';
import { BrandAvatar, CARD_BRAND_OPTIONS, inferCardBrand } from '../components/BrandAvatar';
import { CurrencyInput } from '../components/CurrencyInput';
import { 
  Plus, RefreshCw, Edit2, X, Check, Loader2, 
        ChevronLeft, ChevronRight, CheckCircle2, Building2
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
    competencia?: string | null;
  numero_parcela?: string;
  status: 'PAGO' | 'PENDENTE';
  cartao_id?: number;
}

interface CartaoResumo {
    id: number;
    gastos_pendentes: number;
    saldo_disponivel: number;
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

const CurrencyInputDark = ({ label, className = '', value, onValueChange, ...props }: any) => (
    <div className="w-full">
        {label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{label}</label>}
        <CurrencyInput
            {...props}
            value={value}
            onValueChange={onValueChange}
            className={`w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 ${className}`}
        />
    </div>
);

export function Cartoes() {
  // --- TRAVA DE SEGURANÇA CONTRA DUPLA REQUISIÇÃO ---
  const dataFetchedRef = useRef(false);
    const autoFaturaRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
    const [cartoesResumo, setCartoesResumo] = useState<CartaoResumo[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);

  const [selectedCartaoId, setSelectedCartaoId] = useState<number | null>(null);
  const [mesFatura, setMesFatura] = useState(new Date());
  const [filtroCC, setFiltroCC] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');

  const [showDrawer, setShowDrawer] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
    const [showLaunchDrawer, setShowLaunchDrawer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
    const [lancamentosLoading, setLancamentosLoading] = useState(false);

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

    const lancamentosAbortRef = useRef<AbortController | null>(null);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    const resumoPorCartao = useMemo(() => {
        return new Map(cartoesResumo.map((item) => [item.id, item]));
    }, [cartoesResumo]);

    const launchDrawerSearchParams = useMemo(() => {
        if (!showLaunchDrawer || !selectedCartaoId) return null;
        const params = new URLSearchParams();
        params.set('embed_boletim', '1');
        params.set('origem', 'contas_extrato');
        params.set('novo', '1');
        params.set('cartao_id', String(selectedCartaoId));
        return params;
    }, [showLaunchDrawer, selectedCartaoId]);

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

    const parseCompetenciaMonthKey = (value?: string | null) => {
        const text = String(value || '').trim();
        if (!text) return null;

        const mesAnoMatch = text.match(/^(\d{2})-(\d{4})$/);
        if (mesAnoMatch) {
            const [, mes, ano] = mesAnoMatch;
            return `${ano}-${mes}`;
        }

        const anoMesMatch = text.match(/^(\d{4})-(\d{2})$/);
        if (anoMesMatch) {
            const [, ano, mes] = anoMesMatch;
            return `${ano}-${mes}`;
        }

        return null;
    };

    const getLancamentoFaturaMonthKey = (lancamento: Pick<Lancamento, 'competencia' | 'data_vencimento' | 'data_competencia'>, cartao?: Cartao | null) => {
        const vencimento = parseDateOnly(lancamento.data_vencimento);
        if (vencimento) return getMonthKey(vencimento);

        const competenciaKey = parseCompetenciaMonthKey(lancamento.competencia);
        if (competenciaKey) return competenciaKey;

        const dataCompetencia = parseDateOnly(lancamento.data_competencia);
        if (dataCompetencia) return getMonthKey(dataCompetencia);

        if (cartao && lancamento.data_competencia) {
            const competenciaVencimento = computeCartaoVencimento(lancamento.data_competencia, cartao);
            const parsedCompetenciaVencimento = parseDateOnly(competenciaVencimento);
            if (parsedCompetenciaVencimento) return getMonthKey(parsedCompetenciaVencimento);
        }

        return null;
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

                                                const [resC, resResumo, resCC, resConta] = await Promise.all([
                api.get('/cartoes/'),
                                api.get('/cartoes/resumo'),
                api.get('/centro-custo/'),
                api.get('/contas/', { params: { include_saldo: false } })
            ]);

            setCartoes(normalizeListResponse<Cartao>(resC.data));
                setCartoesResumo(
                        normalizeListResponse<any>(resResumo.data).map((item) => ({
                                id: Number(item.id),
                                gastos_pendentes: Number(item.gastos_pendentes || 0),
                                saldo_disponivel: Number(item.saldo_disponivel || 0),
                        }))
                );
        setCentros(normalizeListResponse<any>(resCC.data));
        setContas(normalizeListResponse<any>(resConta.data));
    } catch (e: any) { 
        console.error("Erro ao carregar dados:", e);
    } finally { 
        setLoading(false); 
    }
  }

    async function carregarLancamentosFatura(cartaoId: number, baseDate: Date, allowFallbackToPrevious = false) {
        lancamentosAbortRef.current?.abort();
        const controller = new AbortController();
        lancamentosAbortRef.current = controller;
        setLancamentosLoading(true);

        try {
            const response = await api.get('/lancamentos/', {
                params: {
                    include_anexos: false,
                    sem_paginacao: true,
                    cartao_id: cartaoId,
                },
                signal: controller.signal,
            });

            const itens = normalizeListResponse<Lancamento>(response.data);
            if (controller.signal.aborted) return;

            setLancamentos(itens);

            const cartao = cartoes.find((item) => item.id === cartaoId);
            if (!cartao) return;

            const currentDue = getCurrentInvoiceDueDate(cartao, baseDate);
            const currentKey = getMonthKey(currentDue);
            const previousDate = new Date(currentDue.getFullYear(), currentDue.getMonth() - 1, 1);
            const previousKey = getMonthKey(previousDate);

            const hasCurrentPending = itens.some((item) => {
                if (String(item.status || '').toUpperCase() === 'PAGO') return false;
                return getLancamentoFaturaMonthKey(item, cartao) === currentKey;
            });

            let targetMonth = currentDue;
            if (allowFallbackToPrevious && !hasCurrentPending) {
                const hasPreviousPending = itens.some((item) => {
                    if (String(item.status || '').toUpperCase() === 'PAGO') return false;
                    return getLancamentoFaturaMonthKey(item, cartao) === previousKey;
                });
                if (hasPreviousPending) {
                    targetMonth = previousDate;
                }
            }

            if (controller.signal.aborted) return;
            setMesFatura(new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1));
        } catch (error: any) {
            if (controller.signal.aborted || error?.code === 'ERR_CANCELED') return;
            console.error('Erro ao carregar lançamentos do cartão:', error);
        } finally {
            if (lancamentosAbortRef.current === controller) {
                lancamentosAbortRef.current = null;
                setLancamentosLoading(false);
            }
        }
    }

    const filteredCartoes = useMemo(() => cartoes.filter(c => !filtroCC || String(c.centro_custo_id) === filtroCC), [cartoes, filtroCC]);

        useEffect(() => {
                if (!filteredCartoes.length) {
                        if (selectedCartaoId !== null) setSelectedCartaoId(null);
                        return;
                }

                const selectedStillVisible = selectedCartaoId !== null && filteredCartoes.some((cartao) => cartao.id === selectedCartaoId);
                if (!selectedStillVisible) {
                        setSelectedCartaoId(filteredCartoes[0].id);
                }
        }, [filteredCartoes, selectedCartaoId]);

        useEffect(() => {
                if (!selectedCartaoId) return;
                if (autoFaturaRef.current === selectedCartaoId) return;
                const cartao = cartoes.find(c => c.id === selectedCartaoId);
                if (!cartao) return;
                autoFaturaRef.current = selectedCartaoId;
                void carregarLancamentosFatura(selectedCartaoId, new Date(), true);
            }, [selectedCartaoId, cartoes]);

            const handleChangeInvoiceMonth = (delta: number) => {
                if (!selectedCartaoId) return;
                setMesFatura((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
            };

            const handleReloadCurrentInvoice = async () => {
                if (!selectedCartaoId) return;
                await carregarLancamentosFatura(selectedCartaoId, mesFatura, false);
            };

  const faturaAtual = useMemo(() => {
    if (!selectedCartaoId) return { itens: [], total: 0, pendente: 0, vencimento: null };
    const cartao = cartoes.find(c => c.id === selectedCartaoId);
    if(!cartao) return { itens: [], total: 0, pendente: 0, vencimento: null };

    const ano = mesFatura.getFullYear();
    const mes = mesFatura.getMonth();
    const diaVenc = cartao.dia_vencimento > 28 ? 28 : (cartao.dia_vencimento || 10);
    const vencimento = new Date(ano, mes, diaVenc);
    const strMes = getMonthKey(vencimento); 
    
    const itens = lancamentos.filter((l) => l.cartao_id === cartao.id && getLancamentoFaturaMonthKey(l, cartao) === strMes);
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

    function handleOpenEdit(c: Cartao, e?: React.MouseEvent) {
        e?.stopPropagation();
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
        autoFaturaRef.current = null;
        dataFetchedRef.current = false; 
        await carregarDados();
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
                await carregarDados();
                await handleReloadCurrentInvoice();
        dataFetchedRef.current = true;
    } catch(e) { alert("Erro ao pagar fatura"); } finally { setSaving(false); }
  }

  const CardVisual = ({ dados, previewMode = false }: any) => {
    const cc = centros.find(c => String(c.id) === String(dados.centro_custo_id));
    const nomeCC = cc ? (cc.nome || cc.descricao || 'GERAL') : 'GERAL';
        const brand = inferCardBrand(dados.bandeira, dados.nome_cartao);
    
    const limiteTotal = parseFloat(String(dados.limite_total).replace(',', '.')) || 0;
    let disponivel = limiteTotal;
    let percentual = 0;
    
    if (!previewMode && dados.id) {
        const resumo = resumoPorCartao.get(Number(dados.id));
        const gastos = resumo ? Number(resumo.gastos_pendentes || 0) : 0;
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
            <button onClick={() => { dataFetchedRef.current = false; void (async () => { await carregarDados(); await handleReloadCurrentInvoice(); })(); }} className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition"><RefreshCw className={`w-5 h-5 ${loading || lancamentosLoading ? 'animate-spin' : ''}`}/></button>
            <button onClick={handleOpenCreate} className="px-4 py-2 rounded-lg text-white font-bold text-sm shadow hover:brightness-110 flex items-center gap-2 w-full sm:w-auto justify-center" style={{backgroundColor: primaryColor}}><Plus className="w-4 h-4"/> Novo</button>
        </div>
      </header>

    <div className="w-full space-y-8 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCartoes.length === 0 && !loading && (
                <div className="col-span-full py-12 text-center text-slate-500 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl">Nenhum cartão encontrado. Clique em "Novo" para criar.</div>
            )}
            {filteredCartoes.map(c => (
                <div key={c.id} className={`rounded-xl transition relative ${selectedCartaoId === c.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''}`}>
                    <button className="block w-full text-left" onClick={() => setSelectedCartaoId(c.id)}>
                        <CardVisual dados={c} />
                    </button>
                    {selectedCartaoId === c.id && <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-4 h-4 bg-white dark:bg-slate-800 rotate-45 border-b border-r border-slate-200 dark:border-slate-700 z-0"></div>}
                </div>
            ))}
        </div>

        {selectedCartaoId && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden animate-in slide-in-from-top-4 fade-in duration-300">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => handleChangeInvoiceMonth(-1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"><ChevronLeft className="w-6 h-6"/></button>
                        <div className="text-center min-w-45">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Fatura de</p>
                            <h3 className="text-2xl font-black text-slate-800 dark:text-white capitalize">{faturaAtual.vencimento?.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) || mesFatura.toLocaleDateString('pt-BR', { month: 'long' })}</h3>
                        </div>
                        <button onClick={() => handleChangeInvoiceMonth(1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"><ChevronRight className="w-6 h-6"/></button>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700/50 w-full">
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Total da Fatura</p>
                            <p className="text-2xl font-black text-slate-800 dark:text-white">{lancamentosLoading ? 'Carregando...' : BRL.format(faturaAtual.total)}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{lancamentosLoading ? 'Atualizando lançamentos do cartão...' : `Vence dia ${faturaAtual.vencimento?.toLocaleDateString('pt-BR', {day:'numeric', month:'short'}) || '--'}`}</p>
                        </div>
                        <button
                            onClick={() => {
                                const cartao = cartoes.find((item) => item.id === selectedCartaoId);
                                if (cartao) handleOpenEdit(cartao);
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
                        >
                            <Edit2 className="w-4 h-4" />
                            Editar dados do cartão
                        </button>
                                                <button
                                                                            onClick={() => {
                                                        if (!selectedCartaoId) return;
                                                        setShowLaunchDrawer(true);
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
                            {lancamentosLoading ? (
                                <tr><td colSpan={5} className="p-10 text-center text-slate-500">Carregando lançamentos do cartão selecionado...</td></tr>
                            ) : faturaAtual.itens.length === 0 ? (
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
                        <CurrencyInputDark label="Limite Total (R$)" className="font-bold text-lg" value={formData.limite_total} onValueChange={(value:string) => setFormData({...formData, limite_total: value})} />

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

            {showLaunchDrawer && launchDrawerSearchParams && (
                <div className="fixed inset-0 z-70 overflow-hidden">
                    <Lancamentos
                        forcedSearchParams={launchDrawerSearchParams}
                        drawerPanelClassName="w-[30vw] min-w-[360px] max-w-[30vw]"
                        onRequestCloseEmbed={() => {
                            dataFetchedRef.current = false;
                            void (async () => {
                                setShowLaunchDrawer(false);
                                await carregarDados();
                                await handleReloadCurrentInvoice();
                            })();
                        }}
                    />
                </div>
            )}
    </div>
  );
}