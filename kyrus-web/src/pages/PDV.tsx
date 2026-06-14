import { useEffect, useMemo, useState, useRef } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, Calendar, Plus, Sparkles, X, Trash2, Edit3, Package, DollarSign, Percent, User, Download, Check, Ban, RotateCcw, UploadCloud } from 'lucide-react';
import { api, toPublicAssetUrl, normalizeListResponse } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { BrandAvatar, inferCardBrand } from '../components/BrandAvatar';

// Interfaces
interface Produto {
  id: number;
  nome: string;
  preco_unitario: number;
  empresa_id: number;
  is_active: boolean;
  tipo?: string;
}

interface PdvVendaItem {
  id: number;
  venda_id_uuid?: string | null;
  rv: string;
  data: string;
  hora?: string | null;
  vendedor: string;
  status: string;
  descricao: string;
  valor: number;
  origem?: string;
  tipo_venda?: string;
  tipoVenda?: string;
  fonte?: string;
  comprovante_url?: string | null;
  comprovante_urls?: string[] | null;
  vendedor_id?: number | null;
  entidade_id?: number | null;
  centro_custo_id?: number | null;
  observacao_texto?: string | null;
  itens_detalhe?: any[] | null;
  pagamentos_detalhe?: any[] | null;
}

interface PdvVendaGrupo {
  data: string;
  total: number;
  quantidade: number;
  vendas: PdvVendaItem[];
}

interface PdvVendasResponse {
  pode_ver_todas: boolean;
  total_vendas: number;
  total_valor: number;
  grupos: PdvVendaGrupo[];
}

interface VendaItemLinha {
  produtoId: string;
  quantidade: number;
  desconto: string;
  precoUnitario?: string;
}

interface VendaPagamentoLinha {
  tipoPagamento: string;
  valor: string;
  numeroParcelas: number;
  valorParcela: string;
  dataPagamento: string;
  bandeira?: string;
}

// Subcomponente Dropdown Pesquisável de Cliente
function SearchableCustomerSelect({
  customers,
  selectedValue,
  onChange,
  onCreateClick,
  placeholder = 'Selecione um cliente'
}: {
  customers: any[];
  selectedValue: string | number;
  onChange: (customerId: number) => void;
  onCreateClick: () => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedCustomer = customers.find((c) => String(c.id) === String(selectedValue));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = customers.filter((c) => {
    const s = search.toLowerCase();
    const nameMatch = (c.nome || '').toLowerCase().includes(s);
    const cpfMatch = (c.cpf_cnpj || '').replace(/\D/g, '').includes(s.replace(/\D/g, ''));
    return nameMatch || cpfMatch;
  });

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      >
        <span className={selectedCustomer ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-400'}>
          {selectedCustomer
            ? `${selectedCustomer.nome} ${selectedCustomer.cpf_cnpj ? `(${selectedCustomer.cpf_cnpj})` : ''}`
            : placeholder}
        </span>
        <span className="text-slate-400 text-xs">▼</span>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-950">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome ou CPF..."
            className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            onClick={(e) => e.stopPropagation()}
          />
          <div
            onClick={(e) => {
              e.stopPropagation();
              onCreateClick();
              setIsOpen(false);
            }}
            className="cursor-pointer rounded-lg px-3 py-2 text-xs transition bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 mb-2 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            + Criar Novo Cliente
          </div>
          
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado</div>
          ) : (
            filtered.map((cust) => (
              <div
                key={cust.id}
                onClick={() => {
                  onChange(cust.id);
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`cursor-pointer rounded-lg px-3 py-2 text-xs transition hover:bg-slate-100 dark:hover:bg-slate-900 ${
                  String(cust.id) === String(selectedValue)
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {cust.nome} {cust.cpf_cnpj ? `- ${cust.cpf_cnpj}` : ''}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Subcomponente Dropdown Pesquisável de Produto
function SearchableProductSelect({
  products,
  selectedValue,
  onChange,
  placeholder = 'Selecione um produto'
}: {
  products: Produto[];
  selectedValue: string;
  onChange: (productId: string) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedProduct = products.find((p) => String(p.id) === String(selectedValue));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = products.filter((p) =>
    p.nome.toLowerCase().includes(search.toLowerCase())
  );

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      >
        <span className={selectedProduct ? 'text-slate-900 dark:text-white font-medium w-full' : 'text-slate-400 w-full'}>
          {selectedProduct ? (
            <span className="flex items-center gap-2">
              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] shrink-0 ${
                selectedProduct.tipo === 'SERVICO'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
              }`}>
                {selectedProduct.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
              </span>
              <span className="truncate">{selectedProduct.nome} - {formatCurrency(Number(selectedProduct.preco_unitario))}</span>
            </span>
          ) : placeholder}
        </span>
        <span className="text-slate-400 text-xs shrink-0">▼</span>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-950">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar..."
            className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            onClick={(e) => e.stopPropagation()}
          />
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Nenhum item encontrado</div>
          ) : (
            filtered.map((prod) => (
              <div
                key={prod.id}
                onClick={() => {
                  onChange(String(prod.id));
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`cursor-pointer rounded-lg px-3 py-2 text-xs transition hover:bg-slate-100 dark:hover:bg-slate-900 ${
                  String(prod.id) === String(selectedValue)
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <div className="flex items-center gap-2 truncate">
                    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0 ${
                      prod.tipo === 'SERVICO'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    }`}>
                      {prod.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
                    </span>
                    <span className="truncate">{prod.nome}</span>
                  </div>
                  <span className="font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                    {formatCurrency(Number(prod.preco_unitario))}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Helpers para formatação e parsing de máscara monetária
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

// Componente Principal
export function PDV() {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const currentUserName = useAuthStore((state) => state.user?.nome ?? state.user?.email ?? '');

  // Tab Control: 'vendas' | 'produtos'
  const [currentTab, setCurrentTab] = useState<'vendas' | 'produtos'>('vendas');

  // Vendas State
  const [data, setData] = useState<PdvVendasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Produtos State
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [errorProdutos, setErrorProdutos] = useState<string | null>(null);
  const [filtroProdutoTipo, setFiltroProdutoTipo] = useState<'TODOS' | 'PRODUTO' | 'SERVICO'>('TODOS');

  // Produto Form State (Modal)
  const [showProdutoForm, setShowProdutoForm] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [produtoNome, setProdutoNome] = useState('');
  const [produtoPreco, setProdutoPreco] = useState('');
  const [produtoTipo, setProdutoTipo] = useState<string>('PRODUTO');
  const [savingProduto, setSavingProduto] = useState(false);

  const empresaId = useAuthStore((state) => state.user?.empresa_id ?? null);
  const [empresa, setEmpresa] = useState<any>(null);

  const paymentMethods = useMemo(() => {
    let list = [
      { key: 'dinheiro', label: 'Dinheiro', parcelada: false, ativa: true },
      { key: 'pix_chave', label: 'PIX (Chave)', parcelada: false, ativa: true },
      { key: 'pix_qr', label: 'PIX (QR Code)', parcelada: false, ativa: true },
      { key: 'cartao_credito_vista', label: 'Cartão de Crédito (À Vista)', parcelada: false, ativa: true },
      { key: 'cartao_credito_parcelado', label: 'Cartão de Crédito (Parcelado)', parcelada: true, ativa: true },
      { key: 'boleto', label: 'Boleto', parcelada: true, ativa: true }
    ];

    if (empresa && empresa.pdv_config) {
      try {
        const parsed = JSON.parse(empresa.pdv_config);
        if (parsed.formas_pagamento && Array.isArray(parsed.formas_pagamento)) {
          list = parsed.formas_pagamento;
        }
      } catch (e) {
        console.error('Erro ao fazer parse de pdv_config em PDV.tsx', e);
      }
    }

    return list.filter((item: any) => item.ativa !== false);
  }, [empresa]);

  const isMethodParcelado = (key: string) => {
    const defaults = ['cartao_credito_parcelado', 'boleto'];
    if (defaults.includes(key)) return true;
    if (empresa && empresa.pdv_config) {
      try {
        const parsed = JSON.parse(empresa.pdv_config);
        if (parsed.formas_pagamento && Array.isArray(parsed.formas_pagamento)) {
          const matched = parsed.formas_pagamento.find((f: any) => f.key === key);
          if (matched) return !!matched.parcelada;
        }
      } catch (e) {
        console.error(e);
      }
    }
    return false;
  };

  // Entidades (Clientes) Lookup de useLookupStore
  const entidadesLookup = useLookupStore((state) => state.entidadesLookup);
  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);

  // Nova Venda Form State (Drawer)
  const [showVendaForm, setShowVendaForm] = useState(false);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [selectedVendedorId, setSelectedVendedorId] = useState<number | null>(null);
  const [vendaItens, setVendaItens] = useState<VendaItemLinha[]>([{ produtoId: '', quantidade: 1, desconto: '0' }]);
  const [vendaObservacao, setVendaObservacao] = useState('');
  
  // Múltiplos Pagamentos, Status e Comprovante
  const [vendaStatus, setVendaStatus] = useState<string>('REALIZADO');
  const [vendaPagamentos, setVendaPagamentos] = useState<VendaPagamentoLinha[]>([
    { tipoPagamento: 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: '' }
  ]);
  const [comprovanteFiles, setComprovanteFiles] = useState<File[]>([]);
  const [existingComprovantes, setExistingComprovantes] = useState<string[]>([]);

  const [savingVenda, setSavingVenda] = useState(false);
  const [errorVenda, setErrorVenda] = useState<string | null>(null);

  // Centros de Custo e Clientes
  const [centrosCusto, setCentrosCusto] = useState<any[]>([]);
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | null>(null);
  const [selectedEntidadeId, setSelectedEntidadeId] = useState<number | null>(null);

  // Venda Extra fields
  const [vendaRv, setVendaRv] = useState('');
  const [vendaDataPagamento, setVendaDataPagamento] = useState('');
  const [isEditingSale, setIsEditingSale] = useState(false);
  const [editingSaleUuid, setEditingSaleUuid] = useState<string | null>(null);

  // Filtros de Histórico de Venda
  const [filtroRv, setFiltroRv] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroVendedor, setFiltroVendedor] = useState('TODOS');

  const activeProdutos = useMemo(() => {
    return produtos.filter((p) => p.is_active !== false);
  }, [produtos]);

  const filteredProdutos = useMemo(() => {
    if (filtroProdutoTipo === 'TODOS') return produtos;
    return produtos.filter((p) => (p.tipo || 'PRODUTO') === filtroProdutoTipo);
  }, [produtos, filtroProdutoTipo]);

  // Flat sales list from groups
  const flatVendas = useMemo(() => {
    if (!data || !data.grupos) return [];
    const list: PdvVendaItem[] = [];
    data.grupos.forEach((g) => {
      list.push(...(g.vendas || []));
    });
    return list;
  }, [data]);

  // Filtered and regrouped sales list
  const filteredAndGroupedVendas = useMemo(() => {
    let result = flatVendas;

    // Filter by RV
    if (filtroRv.trim()) {
      const q = filtroRv.toLowerCase().trim();
      result = result.filter(v => (v.rv || '').toLowerCase().includes(q));
    }

    // Filter by Cliente
    if (filtroCliente.trim()) {
      const q = filtroCliente.toLowerCase().trim();
      result = result.filter(v => (v.descricao || '').toLowerCase().includes(q));
    }

    // Filter by Status
    if (filtroStatus !== 'TODOS') {
      result = result.filter(v => (v.status || '').toUpperCase() === filtroStatus);
    }

    // Filter by Vendedor
    if (filtroVendedor !== 'TODOS') {
      result = result.filter(v => String(v.vendedor_id) === String(filtroVendedor));
    }

    // Group by date
    const groupsMap: Record<string, PdvVendaItem[]> = {};
    result.forEach(v => {
      const dt = v.data; // YYYY-MM-DD
      if (!groupsMap[dt]) {
        groupsMap[dt] = [];
      }
      groupsMap[dt].push(v);
    });

    // Map to group array
    const groups = Object.keys(groupsMap).map(dt => {
      const groupVendas = groupsMap[dt];
      const total = groupVendas.reduce((sum, v) => sum + Number(v.valor), 0);
      return {
        data: dt,
        total,
        quantidade: groupVendas.length,
        vendas: groupVendas
      };
    });

    // Sort by date desc
    groups.sort((a, b) => b.data.localeCompare(a.data));
    return groups;
  }, [flatVendas, filtroRv, filtroCliente, filtroStatus, filtroVendedor]);

  // Cliente Modal State (sub-cadastro)
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [clienteForm, setClienteForm] = useState({
    nome: '',
    tipo_pessoa: 'PF' as 'PF' | 'PJ',
    cpf_cnpj: '',
    email: '',
    telefone: '',
    celular: '',
  });
  const [savingCliente, setSavingCliente] = useState(false);

  // Load Vendas
  async function loadVendas() {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<PdvVendasResponse>('/pdv/vendas');
      if (response.data && typeof response.data === 'object' && 'error' in response.data) {
        setData(null);
        setError(String((response.data as { error?: string }).error || 'Não foi possível carregar as vendas do PDV.'));
      } else {
        setData(normalizePdvResponse(response.data));
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Não foi possível carregar as vendas do PDV.');
    } finally {
      setLoading(false);
    }
  }

  // Load Produtos
  async function loadProdutos() {
    try {
      setLoadingProdutos(true);
      setErrorProdutos(null);
      const response = await api.get<Produto[]>('/pdv/produtos');
      setProdutos(response.data || []);
    } catch (err: any) {
      setErrorProdutos(err?.response?.data?.detail || 'Erro ao carregar produtos.');
    } finally {
      setLoadingProdutos(false);
    }
  }

  // Load Vendedores
  async function loadVendedores() {
    try {
      const response = await api.get('/usuarios/vendedores');
      setVendedores(response.data || []);
    } catch (err) {
      console.error('Erro ao carregar vendedores', err);
    }
  }

  async function loadCentrosCusto() {
    try {
      const response = await api.get('/centro-custo/');
      const list = normalizeListResponse(response.data) as any[];
      setCentrosCusto(list || []);
      if (list && list.length > 0) {
        setSelectedCentroCustoId((prev) => prev ?? list[0].id);
      }
    } catch (err) {
      console.error('Erro ao carregar centros de custo', err);
    }
  }

  async function loadEmpresa() {
    if (!empresaId) return;
    try {
      const response = await api.get(`/empresas/${empresaId}`);
      setEmpresa(response.data);
    } catch (err) {
      console.error('Erro ao carregar dados da empresa', err);
    }
  }

  useEffect(() => {
    void loadEmpresa();
    void loadVendas();
    void loadProdutos();
    void loadVendedores();
    void loadCentrosCusto();
    void fetchEntidadesLookup();
  }, [empresaId]);

  // Formatters
  const currency = useMemo(() => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }), []);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }), []);

  const temVendas = Boolean(data && Array.isArray(data.grupos) && data.grupos.length > 0);

  // Subtotal e Total Dinâmicos da Nova Venda
  const vendaValores = useMemo(() => {
    let subtotal = 0;
    let totalDesconto = 0;

    vendaItens.forEach((item) => {
      if (!item.produtoId) return;
      const prod = produtos.find((p) => String(p.id) === String(item.produtoId));
      if (prod) {
        const precoUsado = (prod.tipo === 'SERVICO' && item.precoUnitario)
          ? parseMonetario(item.precoUnitario)
          : Number(prod.preco_unitario);
        subtotal += precoUsado * item.quantidade;
        totalDesconto += parseMonetario(item.desconto);
      }
    });

    const total = Math.max(0, subtotal - totalDesconto);

    return { subtotal, total, totalDesconto };
  }, [vendaItens, produtos]);

  // Total preenchido nas formas de pagamento
  const paymentTotal = useMemo(() => {
    return vendaPagamentos.reduce((acc, p) => acc + parseMonetario(p.valor), 0);
  }, [vendaPagamentos]);

  const isPaymentValid = useMemo(() => {
    return Math.abs(paymentTotal - vendaValores.total) < 0.05;
  }, [paymentTotal, vendaValores.total]);

  // Submit Produto
  async function handleProdutoSubmit(e: FormEvent) {
    e.preventDefault();
    if (!produtoNome.trim() || !produtoPreco.trim()) return;

    try {
      setSavingProduto(true);
      const body = {
        nome: produtoNome.trim(),
        preco_unitario: parseMonetario(produtoPreco),
        tipo: produtoTipo,
      };

      if (editingProduto) {
        await api.put(`/pdv/produtos/${editingProduto.id}`, body);
      } else {
        await api.post('/pdv/produtos', body);
      }

      setShowProdutoForm(false);
      setProdutoNome('');
      setProdutoPreco('');
      setProdutoTipo('PRODUTO');
      setEditingProduto(null);
      await loadProdutos();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao salvar produto/serviço.');
    } finally {
      setSavingProduto(false);
    }
  }

  // Delete Produto
  async function handleDeleteProduto(id: number) {
    if (!confirm('Deseja realmente remover este produto?')) return;
    try {
      await api.delete(`/pdv/produtos/${id}`);
      await loadProdutos();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao remover produto.');
    }
  }

  // Open Nova Venda
  function openNovaVenda() {
    const todayStr = new Date().toISOString().split('T')[0];
    setVendaItens([{ produtoId: '', quantidade: 1, desconto: '', precoUnitario: '' }]);
    setSelectedEntidadeId(null);
    setVendaRv('');
    setVendaDataPagamento(todayStr);
    setVendaObservacao('');
    setVendaStatus('REALIZADO');
    setVendaPagamentos([{ tipoPagamento: 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: todayStr, bandeira: 'VISA' }]);
    setComprovanteFiles([]);
    setExistingComprovantes([]);
    setSelectedVendedorId(currentUserId);
    setErrorVenda(null);
    setIsEditingSale(false);
    setEditingSaleUuid(null);
    if (centrosCusto.length === 1) {
      setSelectedCentroCustoId(centrosCusto[0].id);
    } else {
      setSelectedCentroCustoId(null);
    }
    setShowVendaForm(true);
  }

  // Open Editar Venda
  function openEditarVenda(venda: PdvVendaItem) {
    setErrorVenda(null);
    setIsEditingSale(true);
    setEditingSaleUuid(venda.venda_id_uuid ?? null);
    setSelectedVendedorId(venda.vendedor_id ?? currentUserId);
    setSelectedEntidadeId(venda.entidade_id ?? null);
    setSelectedCentroCustoId(venda.centro_custo_id ?? (centrosCusto.length === 1 ? centrosCusto[0].id : null));
    setVendaRv(venda.rv ?? '');
    setVendaDataPagamento(venda.data ?? '');
    setVendaObservacao(venda.observacao_texto ?? '');
    setVendaStatus(venda.status ?? 'REALIZADO');
    
    // Map items with formatMonetario
    if (venda.itens_detalhe && venda.itens_detalhe.length > 0) {
      setVendaItens(
        venda.itens_detalhe.map((it: any) => ({
          produtoId: String(it.produto_id),
          quantidade: it.quantidade,
          desconto: formatMonetario(it.desconto || 0),
          precoUnitario: formatMonetario(it.preco_unitario || 0)
        }))
      );
    } else {
      setVendaItens([{ produtoId: '', quantidade: 1, desconto: '', precoUnitario: '' }]);
    }
    
    // Map payments with formatMonetario and dataPagamento
    if (venda.pagamentos_detalhe && venda.pagamentos_detalhe.length > 0) {
      setVendaPagamentos(
        venda.pagamentos_detalhe.map((p: any) => ({
          tipoPagamento: p.tipo_pagamento,
          valor: formatMonetario(p.valor),
          numeroParcelas: p.numero_parcelas || 1,
          valorParcela: formatMonetario(p.valor_parcela || ''),
          dataPagamento: p.data_pagamento || venda.data || new Date().toISOString().split('T')[0],
          bandeira: p.bandeira || 'VISA'
        }))
      );
    } else {
      setVendaPagamentos([{ tipoPagamento: 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: venda.data || new Date().toISOString().split('T')[0], bandeira: 'VISA' }]);
    }
    
    setComprovanteFiles([]);
    const urls = (venda as any).comprovante_urls || (venda.comprovante_url ? [venda.comprovante_url] : []);
    setExistingComprovantes(urls);
    setShowVendaForm(true);
  }

  async function handleUpdateStatusInDrawer(newStatus: string) {
    if (!editingSaleUuid) return;
    await handleUpdateSaleStatus(editingSaleUuid, newStatus);
    setShowVendaForm(false);
  }

  async function handleClienteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clienteForm.nome.trim()) return;

    try {
      setSavingCliente(true);
      const payload = {
        nome: clienteForm.nome.trim(),
        tipo: 'CLIENTE',
        tipo_pessoa: clienteForm.tipo_pessoa,
        cpf_cnpj: clienteForm.cpf_cnpj ? clienteForm.cpf_cnpj.replace(/\D/g, '') : null,
        email: clienteForm.email.trim() || null,
        telefone: clienteForm.telefone ? clienteForm.telefone.replace(/\D/g, '') : null,
        celular: clienteForm.celular ? clienteForm.celular.replace(/\D/g, '') : null,
        status: 'ATIVO',
        empresa_id: empresaId
      };

      const response = await api.post('/entidades/', payload);
      const newCustomer = response.data;
      
      await fetchEntidadesLookup(true);
      setSelectedEntidadeId(newCustomer.id);
      setShowClienteModal(false);
      
      setClienteForm({
        nome: '',
        tipo_pessoa: 'PF',
        cpf_cnpj: '',
        email: '',
        telefone: '',
        celular: '',
      });
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao criar cliente.');
    } finally {
      setSavingCliente(false);
    }
  }

  // Auto preencher o valor restante em um pagamento específico
  function fillRemainingPayment(index: number) {
    const sumOthers = vendaPagamentos.reduce((acc, p, idx) => {
      if (idx === index) return acc;
      return acc + parseMonetario(p.valor);
    }, 0);
    const remaining = Math.max(0, vendaValores.total - sumOthers);
    const updated = [...vendaPagamentos];
    updated[index].valor = formatMonetario(remaining);
    
    if (isMethodParcelado(updated[index].tipoPagamento)) {
      const val = remaining / (updated[index].numeroParcelas || 1);
      updated[index].valorParcela = formatMonetario(val);
    }
    setVendaPagamentos(updated);
  }

  // Manipular alteração de formas de pagamento
  function handlePaymentChange(index: number, field: keyof VendaPagamentoLinha, value: any) {
    const updated = [...vendaPagamentos];
    if (field === 'tipoPagamento') {
      updated[index].tipoPagamento = value;
      if (!isMethodParcelado(value)) {
        updated[index].numeroParcelas = 1;
        updated[index].valorParcela = '';
      }
    } else if (field === 'numeroParcelas') {
      updated[index].numeroParcelas = Math.max(1, parseInt(value) || 1);
    } else if (field === 'valor') {
      updated[index].valor = value;
    } else if (field === 'valorParcela') {
      updated[index].valorParcela = value;
    } else if (field === 'dataPagamento') {
      updated[index].dataPagamento = value;
    } else if (field === 'bandeira') {
      updated[index].bandeira = value;
    }
    
    // Auto-calcula valor da parcela
    if (field === 'valor' || field === 'numeroParcelas' || field === 'tipoPagamento') {
      if (isMethodParcelado(updated[index].tipoPagamento)) {
        const totalVal = parseMonetario(updated[index].valor);
        const parc = updated[index].numeroParcelas || 1;
        updated[index].valorParcela = formatMonetario(totalVal / parc);
      }
    }
    setVendaPagamentos(updated);
  }

  // Drag and drop state e handlers
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      setComprovanteFiles((prev) => [...prev, ...filesArray]);
    }
  };

  const handleComprovanteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      setComprovanteFiles((prev) => [...prev, ...filesArray]);
    }
  };

  const removeSelectedFile = (index: number) => {
    setComprovanteFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit Nova Venda
  async function handleNovaVendaSubmit(e: FormEvent) {
    e.preventDefault();
    const validItens = vendaItens.filter((i) => i.produtoId !== '');
    if (validItens.length === 0) {
      setErrorVenda('Adicione pelo menos um produto válido.');
      return;
    }
    if (!selectedVendedorId) {
      setErrorVenda('Selecione um vendedor.');
      return;
    }
    if (!selectedEntidadeId) {
      setErrorVenda('O cliente é obrigatório.');
      return;
    }
    if (!selectedCentroCustoId) {
      setErrorVenda('O centro de custo é obrigatório.');
      return;
    }
    if (!isPaymentValid) {
      setErrorVenda(`A soma dos pagamentos (${currency.format(paymentTotal)}) deve ser igual ao total líquido da venda (${currency.format(vendaValores.total)}).`);
      return;
    }

    try {
      setSavingVenda(true);
      setErrorVenda(null);

      const body = {
        entidade_id: selectedEntidadeId,
        centro_custo_id: selectedCentroCustoId,
        vendedor_id: selectedVendedorId,
        desconto: vendaValores.totalDesconto,
        status: vendaStatus,
        itens: validItens.map((i) => {
          const prod = produtos.find((p) => String(p.id) === String(i.produtoId));
          const isService = prod?.tipo === 'SERVICO';
          return {
            produto_id: parseInt(i.produtoId),
            quantidade: i.quantidade,
            desconto: parseMonetario(i.desconto),
            preco_unitario: isService && i.precoUnitario ? parseMonetario(i.precoUnitario) : null,
          };
        }),
        pagamentos: vendaPagamentos.map((p) => ({
          tipo_pagamento: p.tipoPagamento,
          valor: parseMonetario(p.valor),
          numero_parcelas: p.numeroParcelas,
          valor_parcela: isMethodParcelado(p.tipoPagamento)
            ? parseMonetario(p.valorParcela)
            : null,
          data_pagamento: p.dataPagamento || null,
          bandeira: p.bandeira || 'OUTROS'
        })),
        rv: vendaRv.trim() || null,
        data_pagamento: vendaDataPagamento || null,
        observacao: vendaObservacao.trim() || null,
        comprovante_urls: existingComprovantes
      };

      let response;
      if (isEditingSale && editingSaleUuid) {
        response = await api.put(`/pdv/vendas/${editingSaleUuid}`, body);
      } else {
        response = await api.post('/pdv/vendas', body);
      }
      
      const createdSale = response.data;
      const targetUuid = isEditingSale ? editingSaleUuid : createdSale?.venda_id_uuid;

      // Upload comprovantes se selecionados (multi-upload usando chave 'files')
      if (comprovanteFiles.length > 0 && targetUuid) {
        const formDataUpload = new FormData();
        comprovanteFiles.forEach((file) => {
          formDataUpload.append('files', file);
        });
        await api.post(`/pdv/vendas/${targetUuid}/comprovante`, formDataUpload, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });
      }

      setShowVendaForm(false);
      setComprovanteFiles([]);
      setExistingComprovantes([]);
      setIsEditingSale(false);
      setEditingSaleUuid(null);
      await loadVendas();
    } catch (err: any) {
      setErrorVenda(err?.response?.data?.detail || 'Não foi possível salvar a venda.');
    } finally {
      setSavingVenda(false);
    }
  }

  // Alterar status de uma venda existente no histórico
  async function handleUpdateSaleStatus(vendaIdUuid: string, novoStatus: string) {
    const statusLabels: Record<string, string> = {
      REALIZADO: 'realizada',
      CANCELADO: 'cancelada',
      DEVOLVIDO: 'devolvida'
    };
    if (!confirm(`Deseja marcar esta venda como ${statusLabels[novoStatus] || novoStatus}?`)) return;
    try {
      setLoading(true);
      await api.patch(`/pdv/vendas/${vendaIdUuid}/status`, null, {
        params: { status_in: novoStatus }
      });
      await loadVendas();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao atualizar status da venda.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-6 pb-8">
        {/* Cabeçalho */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">PDV</p>
                <h1 className="text-xl font-black text-slate-900 dark:text-white">Ponto de Venda</h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {currentTab === 'vendas' && (
                <button
                  type="button"
                  onClick={openNovaVenda}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Venda
                </button>
              )}
              {currentTab === 'produtos' && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingProduto(null);
                    setProdutoNome('');
                    setProdutoPreco('');
                    setProdutoTipo('PRODUTO');
                    setShowProdutoForm(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Cadastrar
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Abas */}
        <div className="flex border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setCurrentTab('vendas')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition cursor-pointer ${
              currentTab === 'vendas'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            Vendas
          </button>
          <button
            onClick={() => setCurrentTab('produtos')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition cursor-pointer ${
              currentTab === 'produtos'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Package className="w-4 h-4" />
            Produtos
          </button>
        </div>

        {/* Conteúdo Aba Vendas */}
        {currentTab === 'vendas' && (
          <>
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900">Carregando vendas do PDV...</div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">Não foi possível carregar o PDV</p>
                    <p className="mt-1 text-sm">{error}</p>
                  </div>
                </div>
              </div>
            ) : temVendas ? (
              <div className="space-y-4">
                {/* Filtros */}
                <div className={`grid gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm ${data?.pode_ver_todas ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Buscar por RV</label>
                    <input
                      type="text"
                      value={filtroRv}
                      onChange={(e) => setFiltroRv(e.target.value)}
                      placeholder="Ex: RV-000001"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Buscar por Cliente</label>
                    <input
                      type="text"
                      value={filtroCliente}
                      onChange={(e) => setFiltroCliente(e.target.value)}
                      placeholder="Nome do cliente..."
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status</label>
                    <select
                      value={filtroStatus}
                      onChange={(e) => setFiltroStatus(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      <option value="TODOS">Todos os Status</option>
                      <option value="REALIZADO">Realizado</option>
                      <option value="ORCAMENTO">Orçamento</option>
                      <option value="CANCELADO">Cancelado</option>
                      <option value="DEVOLVIDO">Devolvido</option>
                    </select>
                  </div>
                  {data?.pode_ver_todas && (
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vendedor</label>
                      <select
                        value={filtroVendedor}
                        onChange={(e) => setFiltroVendedor(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="TODOS">Todos os Vendedores</option>
                        {vendedores.map((v) => (
                          <option key={v.id} value={v.id}>{v.nome || v.email.split('@')[0]}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {filteredAndGroupedVendas.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <h3 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Nenhuma venda corresponde aos filtros</h3>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      Tente alterar os filtros de busca para encontrar a venda desejada.
                    </p>
                  </div>
                ) : (
                  filteredAndGroupedVendas.map((grupo) => (
                  <section key={String(grupo.data)} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500">{dateFormatter.format(new Date(`${grupo.data}T00:00:00`))}</p>
                        <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{grupo.quantidade} venda{grupo.quantidade === 1 ? '' : 's'}</h2>
                      </div>
                      <p className="text-lg font-black text-slate-900 dark:text-white">{currency.format(grupo.total)}</p>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed text-left">
                        <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                          <tr>
                            <th className="w-28 px-4 py-3">Data</th>
                            <th className="w-28 px-4 py-3">RV</th>
                            <th className="px-4 py-3">Descrição</th>
                            <th className="w-48 px-4 py-3">Vendedor</th>
                            <th className="w-28 px-4 py-3 text-center">Status</th>
                            <th className="w-40 px-4 py-3 text-center">Ações</th>
                            <th className="w-32 px-4 py-3 text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {grupo.vendas.map((venda) => (
                            <tr
                              key={venda.id}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                              onClick={() => openEditarVenda(venda)}
                            >
                              <td className="px-4 py-3 align-top text-sm text-slate-500 dark:text-slate-400">
                                <span className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                                  <Calendar className="h-4 w-4 text-blue-500" />
                                  {new Intl.DateTimeFormat('pt-BR').format(new Date(`${venda.data}T00:00:00`))}
                                </span>
                                <div className="mt-1 text-xs">{venda.hora || '--:--'}</div>
                              </td>
                              <td className="px-4 py-3 align-top text-sm font-bold text-slate-900 dark:text-white">{venda.rv}</td>
                              <td className="px-4 py-3 align-top">
                                <div className="font-semibold text-slate-900 dark:text-white">{venda.descricao}</div>
                              </td>
                              <td className="px-4 py-3 align-top text-sm text-slate-700 dark:text-slate-200">{venda.vendedor}</td>
                              <td className="px-4 py-3 align-top text-center"><span className={statusBadgeClass(venda.status)}>{venda.status}</span></td>
                              <td className="px-4 py-3 align-top text-center">
                                <div className="flex items-center justify-center gap-2">
                                  {venda.status === 'ORCAMENTO' && venda.venda_id_uuid && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdateSaleStatus(venda.venda_id_uuid!, 'REALIZADO');
                                      }}
                                      className="text-emerald-600 hover:text-emerald-500 dark:text-emerald-450 font-bold text-xs cursor-pointer"
                                      title="Efetivar venda"
                                    >
                                      Efetivar
                                    </button>
                                  )}
                                  
                                  {venda.status === 'REALIZADO' && venda.venda_id_uuid && (
                                    <>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleUpdateSaleStatus(venda.venda_id_uuid!, 'CANCELADO');
                                        }}
                                        className="text-rose-600 hover:text-rose-500 dark:text-rose-450 font-bold text-xs cursor-pointer"
                                        title="Cancelar venda"
                                      >
                                        Cancelar
                                      </button>
                                      <span className="text-slate-300 select-none">|</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleUpdateSaleStatus(venda.venda_id_uuid!, 'DEVOLVIDO');
                                        }}
                                        className="text-slate-500 hover:text-slate-700 dark:text-slate-400 font-bold text-xs cursor-pointer"
                                        title="Registrar devolução"
                                      >
                                        Devolver
                                      </button>
                                    </>
                                  )}

                                  {venda.status !== 'REALIZADO' && venda.status !== 'ORCAMENTO' && (
                                    <span className="text-slate-400 text-xs font-semibold select-none">--</span>
                                  )}
                                  
                                  {(() => {
                                    const urls = venda.comprovante_urls && venda.comprovante_urls.length > 0
                                      ? venda.comprovante_urls
                                      : venda.comprovante_url
                                        ? [venda.comprovante_url]
                                        : [];
                                    if (urls.length === 0) return null;
                                    return (
                                      <div className="flex items-center gap-1.5 ml-1.5" onClick={(e) => e.stopPropagation()}>
                                        {urls.map((url, idx) => (
                                          <a
                                            key={idx}
                                            href={toPublicAssetUrl(url) || undefined}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-500 hover:text-blue-400 font-bold text-xs flex items-center gap-0.5 cursor-pointer"
                                            title={`Ver comprovante ${idx + 1}`}
                                          >
                                            <Download className="w-3.5 h-3.5" />
                                            {urls.length > 1 && <span className="text-[10px]">{idx + 1}</span>}
                                          </a>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top text-right text-sm font-black text-slate-900 dark:text-white">{currency.format(venda.valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <h3 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Nenhuma venda de PDV encontrada</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Esta tela agora só mostra vendas explicitamente marcadas como PDV. Se você ainda não vendeu, ela fica vazia de propósito.
                </p>
              </div>
            )}
          </>
        )}

        {/* Conteúdo Aba Produtos */}
        {currentTab === 'produtos' && (
          <>
            {loadingProdutos ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900">Carregando itens...</div>
            ) : errorProdutos ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">Não foi possível carregar os itens</p>
                    <p className="mt-1 text-sm">{errorProdutos}</p>
                  </div>
                </div>
              </div>
            ) : produtos.length > 0 ? (
              <>
                {/* Filtros por tipo de item */}
                <div className="flex gap-2 mb-4 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setFiltroProdutoTipo('TODOS')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      filtroProdutoTipo === 'TODOS'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-300'
                    }`}
                  >
                    Todos ({produtos.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroProdutoTipo('PRODUTO')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      filtroProdutoTipo === 'PRODUTO'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-300'
                    }`}
                  >
                    Produtos ({produtos.filter(p => (p.tipo || 'PRODUTO') === 'PRODUTO').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroProdutoTipo('SERVICO')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      filtroProdutoTipo === 'SERVICO'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-300'
                    }`}
                  >
                    Serviços ({produtos.filter(p => p.tipo === 'SERVICO').length})
                  </button>
                </div>

                {filteredProdutos.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <h3 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Nenhum item encontrado</h3>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      Não há itens cadastrados para o tipo de filtro selecionado.
                    </p>
                  </div>
                ) : (
                  <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed text-left">
                        <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                          <tr>
                            <th className="px-5 py-3">Nome / Descrição</th>
                            <th className="w-32 px-5 py-3 text-center">Tipo</th>
                            <th className="w-48 px-5 py-3 text-right">Valor Individual</th>
                            <th className="w-36 px-5 py-3 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {filteredProdutos.map((prod) => (
                            <tr key={prod.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="px-5 py-4 align-middle text-sm font-semibold text-slate-900 dark:text-white">
                                {prod.nome}
                              </td>
                              <td className="px-5 py-4 align-middle text-center">
                                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                  prod.tipo === 'SERVICO'
                                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                                }`}>
                                  {prod.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
                                </span>
                              </td>
                              <td className="px-5 py-4 align-middle text-right text-sm font-black text-slate-900 dark:text-white">
                                {currency.format(prod.preco_unitario)}
                              </td>
                              <td className="px-5 py-4 align-middle text-center">
                                <div className="flex justify-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingProduto(prod);
                                      setProdutoNome(prod.nome);
                                      setProdutoPreco(formatMonetario(prod.preco_unitario));
                                      setProdutoTipo(prod.tipo || 'PRODUTO');
                                      setShowProdutoForm(true);
                                    }}
                                    className="text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 cursor-pointer"
                                    title="Editar item"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteProduto(prod.id)}
                                    className="text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 cursor-pointer"
                                    title="Excluir item"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <h3 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Nenhum produto ou serviço cadastrado</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Clique no botão "+ Cadastrar" para registrar itens e permitir a venda itemizada.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal de Produto */}
      {showProdutoForm && (
        <>
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowProdutoForm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {editingProduto ? (produtoTipo === 'SERVICO' ? 'Editar Serviço' : 'Editar Produto') : (produtoTipo === 'SERVICO' ? 'Novo Serviço' : 'Novo Produto')}
                </h3>
                <button onClick={() => setShowProdutoForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleProdutoSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Tipo de Item</label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setProdutoTipo('PRODUTO')}
                      className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                        produtoTipo === 'PRODUTO'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                      }`}
                    >
                      Produto
                    </button>
                    <button
                      type="button"
                      onClick={() => setProdutoTipo('SERVICO')}
                      className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                        produtoTipo === 'SERVICO'
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                      }`}
                    >
                      Serviço
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">Nome do {produtoTipo === 'SERVICO' ? 'Serviço' : 'Produto'}</label>
                  <input
                    type="text"
                    required
                    value={produtoNome}
                    onChange={(e) => setProdutoNome(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder={produtoTipo === 'SERVICO' ? 'Ex: Corte de Cabelo' : 'Ex: Coca-cola 350ml'}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">Valor Individual (R$)</label>
                  <input
                    type="text"
                    required
                    value={produtoPreco}
                    onChange={(e) => setProdutoPreco(formatMonetario(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder="0,00"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowProdutoForm(false)}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingProduto}
                    className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition disabled:opacity-50"
                  >
                    {savingProduto ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {/* Drawer da Nova Venda (PDV Completo) */}
      {showVendaForm && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowVendaForm(false)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-3xl bg-white dark:bg-slate-900 shadow-2xl z-50 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 translate-x-0">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-900">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">{isEditingSale ? 'Editar Venda' : 'Nova Venda'}</p>
                <h3 className="font-bold text-slate-800 dark:text-white">{isEditingSale ? 'Editar Lançamentos da Venda' : 'Lançamento Assistido - PDV'}</h3>
              </div>
              <button onClick={() => setShowVendaForm(false)} aria-label="Fechar" className="text-slate-500 hover:text-slate-700 dark:hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Scrollable Body */}
            <div className="h-[calc(100vh-140px)] overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/50 dark:bg-slate-950/20">
              {errorVenda && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {errorVenda}
                </div>
              )}

              {/* Ações Circulares no Form de Edição */}
              {isEditingSale && (
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ações da Venda</span>
                  <div className="flex items-center gap-6">
                    {vendaStatus === 'ORCAMENTO' && (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleUpdateStatusInDrawer('REALIZADO')}
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-all hover:scale-105 cursor-pointer"
                          title="Efetivar Venda (Status: Realizado)"
                        >
                          <Check className="h-6 w-6" />
                        </button>
                        <span className="text-[10px] font-bold text-slate-500">Efetivar</span>
                      </div>
                    )}
                    {vendaStatus === 'REALIZADO' && (
                      <>
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleUpdateStatusInDrawer('CANCELADO')}
                            className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow transition-all hover:scale-105 cursor-pointer"
                            title="Cancelar Venda"
                          >
                            <Ban className="h-6 w-6" />
                          </button>
                          <span className="text-[10px] font-bold text-slate-500">Cancelar</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleUpdateStatusInDrawer('DEVOLVIDO')}
                            className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-500 hover:bg-slate-400 text-white shadow transition-all hover:scale-105 cursor-pointer"
                            title="Registrar Devolução"
                          >
                            <RotateCcw className="h-6 w-6" />
                          </button>
                          <span className="text-[10px] font-bold text-slate-500">Devolver</span>
                        </div>
                      </>
                    )}
                    {(vendaStatus === 'CANCELADO' || vendaStatus === 'DEVOLVIDO') && (
                      <span className="text-xs font-bold text-slate-500 italic">Esta venda foi {vendaStatus.toLowerCase()} e não pode mais ser editada.</span>
                    )}
                  </div>
                </div>
              )}

              {/* Informações da Venda */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Identificador (RV)</label>
                  <input
                    type="text"
                    value={vendaRv}
                    onChange={(e) => setVendaRv(e.target.value)}
                    placeholder="Autogerado se vazio"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Cliente / Interessado *</label>
                  <SearchableCustomerSelect
                    customers={entidadesLookup}
                    selectedValue={selectedEntidadeId || ''}
                    onChange={(val) => setSelectedEntidadeId(val)}
                    onCreateClick={() => setShowClienteModal(true)}
                    placeholder="Pesquise o cliente por nome ou CPF..."
                  />
                </div>

                {centrosCusto.length > 1 && (
                  <div>
                    <label className="mb-2 block text-xs font-bold text-slate-400 uppercase tracking-wider">Centro de Custo *</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {centrosCusto.map((cc) => (
                        <button
                          key={cc.id}
                          type="button"
                          onClick={() => setSelectedCentroCustoId(cc.id)}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                            selectedCentroCustoId === cc.id
                              ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {cc.nome}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Vendedores Disponíveis em Botões */}
              <div>
                <label className="mb-2 block text-xs font-bold text-slate-400 uppercase tracking-wider">Vendedor Responsável</label>
                {data?.pode_ver_todas ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {vendedores.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVendedorId(v.id)}
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                          selectedVendedorId === v.id
                            ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'
                        }`}
                      >
                        <User className="w-3.5 h-3.5" />
                        {v.nome || v.email.split('@')[0]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex">
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-blue-600/10 border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-bold"
                    >
                      <User className="w-3.5 h-3.5" />
                      {currentUserName}
                    </button>
                  </div>
                )}
              </div>

              {/* Grade de Seleção de Produtos */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Itens Vendidos</label>
                {produtos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-800">
                    Nenhum produto ou serviço disponível. Cadastre itens na aba "Produtos" antes de efetuar uma venda.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {vendaItens.map((item, index) => {
                      const prod = produtos.find((p) => String(p.id) === String(item.produtoId));
                      const isService = prod?.tipo === 'SERVICO';
                      const precoUsado = (isService && item.precoUnitario)
                        ? parseMonetario(item.precoUnitario)
                        : (prod ? Number(prod.preco_unitario) : 0);
                      const rawSub = precoUsado * item.quantidade;
                      const lineDesc = parseMonetario(item.desconto);
                      const subLine = Math.max(0, rawSub - lineDesc);

                      return (
                        <div key={index} className="flex flex-col gap-3 sm:flex-row sm:items-center bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm relative">
                          <div className="flex-1 min-w-[200px]">
                            <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Item (Produto / Serviço)</label>
                            <SearchableProductSelect
                              products={activeProdutos}
                              selectedValue={item.produtoId}
                              onChange={(val) => {
                                const newItens = [...vendaItens];
                                newItens[index].produtoId = val;
                                const chosen = produtos.find((p) => String(p.id) === String(val));
                                if (chosen) {
                                  newItens[index].precoUnitario = formatMonetario(chosen.preco_unitario);
                                } else {
                                  newItens[index].precoUnitario = '';
                                }
                                setVendaItens(newItens);
                              }}
                            />
                          </div>

                          <div className="w-28 shrink-0">
                            <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Preço (R$)</label>
                            <input
                              type="text"
                              value={item.precoUnitario || (prod ? formatMonetario(prod.preco_unitario) : '')}
                              disabled={!isService}
                              onChange={(e) => {
                                const newItens = [...vendaItens];
                                newItens[index].precoUnitario = formatMonetario(e.target.value);
                                setVendaItens(newItens);
                              }}
                              className={`w-full rounded-xl border px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:bg-slate-950 dark:text-white ${
                                isService
                                  ? 'border-slate-300 dark:border-slate-700 bg-white'
                                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 cursor-not-allowed'
                              }`}
                              placeholder="0,00"
                            />
                          </div>

                          <div className="w-20 shrink-0">
                            <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Qtd</label>
                            <input
                              type="number"
                              min="1"
                              value={item.quantidade}
                              onChange={(e) => {
                                const newItens = [...vendaItens];
                                newItens[index].quantidade = Math.max(1, parseInt(e.target.value) || 1);
                                setVendaItens(newItens);
                              }}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>

                          <div className="w-24 shrink-0">
                            <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Desconto (R$)</label>
                            <input
                              type="text"
                              value={item.desconto}
                              onChange={(e) => {
                                const newItens = [...vendaItens];
                                newItens[index].desconto = formatMonetario(e.target.value);
                                setVendaItens(newItens);
                              }}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                              placeholder="0,00"
                            />
                          </div>

                          <div className="w-28 shrink-0 text-right">
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Líquido</span>
                            <span className="text-sm font-extrabold text-slate-900 dark:text-white block mt-2">
                              {currency.format(subLine)}
                            </span>
                          </div>

                          {vendaItens.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setVendaItens(vendaItens.filter((_, idx) => idx !== index));
                              }}
                              className="absolute top-2 right-2 sm:static sm:mt-5 text-slate-400 hover:text-rose-500 cursor-pointer"
                              title="Remover item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => setVendaItens([...vendaItens, { produtoId: '', quantidade: 1, desconto: '0', precoUnitario: '' }])}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-500 hover:text-blue-600 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Adicionar Item
                    </button>
                  </div>
                )}
              </div>

              {/* Informações Complementares */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Status da Venda</label>
                  <select
                    value={vendaStatus}
                    onChange={(e) => setVendaStatus(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="REALIZADO">Realizado (Venda Concluída)</option>
                    <option value="ORCAMENTO">Orçamento (Apenas Cotação)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Observação (opcional)</label>
                  <input
                    type="text"
                    value={vendaObservacao}
                    onChange={(e) => setVendaObservacao(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder="Observações adicionais"
                  />
                </div>
              </div>

              {/* Formas de Pagamento */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Formas de Pagamento</label>
                  <span className={`text-xs font-black ${isPaymentValid ? 'text-emerald-600 dark:text-emerald-450' : 'text-rose-600 dark:text-rose-450'}`}>
                    Preenchido: {currency.format(paymentTotal)} / Esperado: {currency.format(vendaValores.total)}
                  </span>
                </div>
                
                <div className="space-y-3">
                  {vendaPagamentos.map((pag, index) => {
                    const methodObj = paymentMethods.find((m: any) => m.key === pag.tipoPagamento);
                    const isInstallments = methodObj ? methodObj.parcelada : (pag.tipoPagamento === 'cartao_credito_parcelado' || pag.tipoPagamento === 'boleto');
                    const isCardPayment = pag.tipoPagamento.startsWith('cartao_') || pag.tipoPagamento.includes('cartao');
                    
                    return (
                      <div key={index} className="flex flex-col bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm relative gap-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center w-full">
                          <div className="flex-1 min-w-[150px]">
                            <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Forma de Pagamento</label>
                            <select
                              value={pag.tipoPagamento}
                              onChange={(e) => handlePaymentChange(index, 'tipoPagamento', e.target.value)}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            >
                              {paymentMethods.map((method: any) => (
                                <option key={method.key} value={method.key}>{method.label}</option>
                              ))}
                            </select>
                          </div>

                          <div className="w-32 shrink-0">
                            <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor (R$)</label>
                            <div className="relative">
                              <input
                                type="text"
                                value={pag.valor}
                                onChange={(e) => handlePaymentChange(index, 'valor', formatMonetario(e.target.value))}
                                className="w-full rounded-xl border border-slate-300 bg-white pl-3 pr-8 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                                placeholder="0,00"
                              />
                              <button
                                type="button"
                                onClick={() => fillRemainingPayment(index)}
                                className="absolute right-1 top-1 text-[10px] font-bold text-blue-500 hover:text-blue-600 px-1 py-1 bg-slate-100 dark:bg-slate-800 rounded transition cursor-pointer"
                                title="Preencher valor restante"
                              >
                                ★
                              </button>
                            </div>
                          </div>

                          <div className="w-36 shrink-0">
                            <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data de Pagamento</label>
                            <input
                              type="date"
                              required
                              value={pag.dataPagamento}
                              onChange={(e) => handlePaymentChange(index, 'dataPagamento', e.target.value)}
                              className="w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>

                          {isInstallments && (
                            <>
                              <div className="w-20 shrink-0">
                                <label className="mb-1 block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Parcelas</label>
                                <select
                                  value={pag.numeroParcelas}
                                  onChange={(e) => handlePaymentChange(index, 'numeroParcelas', e.target.value)}
                                  className="w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                                >
                                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                                    <option key={n} value={n}>{n}x</option>
                                  ))}
                                </select>
                              </div>

                              <div className="w-28 shrink-0 text-right">
                                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor Parcela</span>
                                <span className="text-xs font-bold text-slate-500 block mt-2">
                                  {currency.format(parseMonetario(pag.valorParcela) || 0)}
                                </span>
                              </div>
                            </>
                          )}

                          {vendaPagamentos.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setVendaPagamentos(vendaPagamentos.filter((_, idx) => idx !== index));
                              }}
                              className="absolute top-2 right-2 sm:static sm:mt-5 text-slate-400 hover:text-rose-500 cursor-pointer animate-in fade-in"
                              title="Remover pagamento"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* Card brand selector if payment method is card */}
                        {isCardPayment && (
                          <div className="w-full border-t border-slate-100 dark:border-slate-800/80 pt-3 mt-1 space-y-2 animate-in slide-in-from-top-1 duration-200">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bandeira do Cartão</label>
                            <div className="flex flex-wrap gap-2">
                              {['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'OUTROS'].map((brand) => {
                                const isSelected = (pag.bandeira || 'VISA') === brand;
                                const brandObj = inferCardBrand(brand);
                                return (
                                  <button
                                    key={brand}
                                    type="button"
                                    onClick={() => handlePaymentChange(index, 'bandeira', brand)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[11px] font-bold transition duration-200 cursor-pointer ${
                                      isSelected
                                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 hover:dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                                    }`}
                                  >
                                    <BrandAvatar visual={brandObj} size="sm" className="w-5 h-5 shrink-0 rounded-lg text-[7px] border-none shadow-none" />
                                    <span>{brand}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  <button
                    type="button"
                    onClick={() => setVendaPagamentos([...vendaPagamentos, { tipoPagamento: paymentMethods[0]?.key || 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: new Date().toISOString().split('T')[0] }])}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-500 hover:text-blue-600 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Pagamento
                  </button>
                </div>
              </div>

              {/* Resumo Financeiro da Venda */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
                <div className="flex justify-between items-center text-xs font-semibold text-slate-500">
                  <span>Subtotal da Venda</span>
                  <span>{currency.format(vendaValores.subtotal)}</span>
                </div>

                <div className="flex justify-between items-center text-xs font-semibold text-slate-500 border-b border-dashed border-slate-200 dark:border-slate-800 pb-3">
                  <span className="flex items-center gap-1">
                    <Percent className="w-3.5 h-3.5 text-amber-500" />
                    Total de Desconto (por item)
                  </span>
                  <span>-{currency.format(vendaValores.totalDesconto)}</span>
                </div>

                <div className="flex justify-between items-center pt-1">
                  <span className="text-sm font-black text-slate-800 dark:text-white">Valor Líquido Total</span>
                  <span className="text-2xl font-black text-blue-600 dark:text-blue-400">
                    {currency.format(vendaValores.total)}
                  </span>
                </div>
              </div>

              {/* Drag and Drop Container */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Anexar Comprovantes (opcional)</label>
                
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                    isDragActive
                      ? "border-blue-500 bg-blue-50/50 dark:border-blue-400 dark:bg-blue-950/20"
                      : "border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700"
                  }`}
                >
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleComprovanteChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Arraste e solte seus comprovantes aqui ou <span className="text-blue-500 hover:text-blue-600 dark:text-blue-400 font-bold">procure</span>
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">Formatos aceitos: Imagens, PDF</p>
                </div>

                {/* Existing Comprovantes (for editing) */}
                {existingComprovantes.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Comprovantes Salvos:</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {existingComprovantes.map((url, index) => {
                        const fileName = url.split('/').pop() || `Comprovante ${index + 1}`;
                        return (
                          <div key={index} className="flex items-center justify-between rounded-xl bg-slate-100 dark:bg-slate-800/60 p-2.5 text-xs">
                            <span className="text-slate-600 dark:text-slate-300 font-medium truncate max-w-[200px]">{fileName}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={toPublicAssetUrl(url) || undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 font-bold flex items-center gap-0.5"
                                title="Ver comprovante"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              <button
                                type="button"
                                onClick={() => setExistingComprovantes((prev) => prev.filter((_, i) => i !== index))}
                                className="text-slate-400 hover:text-rose-500 transition-colors"
                                title="Remover comprovante"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* New Comprovantes selected */}
                {comprovanteFiles.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Novos Selecionados:</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {comprovanteFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 p-2.5 text-xs">
                          <span className="text-blue-600 dark:text-blue-400 font-medium truncate max-w-[200px]">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => removeSelectedFile(index)}
                            className="text-blue-400 hover:text-rose-500 transition-colors shrink-0"
                            title="Remover arquivo"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex justify-end gap-3 absolute bottom-0 left-0 right-0">
              <button
                type="button"
                onClick={() => setShowVendaForm(false)}
                className="px-5 py-2.5 rounded-lg text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingVenda || produtos.length === 0 || !isPaymentValid}
                onClick={handleNovaVendaSubmit}
                className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg transition disabled:opacity-50 cursor-pointer"
              >
                {savingVenda ? 'Processando...' : 'Salvar Venda'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal Rápido de Cadastro de Cliente */}
      {showClienteModal && (
        <>
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowClienteModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Novo Cliente Rápido
                </h3>
                <button onClick={() => setShowClienteModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleClienteSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-2 mb-4 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setClienteForm(prev => ({ ...prev, tipo_pessoa: 'PF' }))}
                    className={`py-2 text-xs font-bold rounded-lg transition ${
                      clienteForm.tipo_pessoa === 'PF'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                    }`}
                  >
                    Pessoa Física (PF)
                  </button>
                  <button
                    type="button"
                    onClick={() => setClienteForm(prev => ({ ...prev, tipo_pessoa: 'PJ' }))}
                    className={`py-2 text-xs font-bold rounded-lg transition ${
                      clienteForm.tipo_pessoa === 'PJ'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                    }`}
                  >
                    Pessoa Jurídica (PJ)
                  </button>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {clienteForm.tipo_pessoa === 'PF' ? 'Nome Completo' : 'Razão Social'} *
                  </label>
                  <input
                    type="text"
                    required
                    value={clienteForm.nome}
                    onChange={(e) => setClienteForm(prev => ({ ...prev, nome: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder={clienteForm.tipo_pessoa === 'PF' ? 'Ex: Maria Aparecida' : 'Ex: Kyrus Tech Ltda'}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {clienteForm.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'}
                  </label>
                  <input
                    type="text"
                    value={clienteForm.cpf_cnpj}
                    onChange={(e) => setClienteForm(prev => ({ ...prev, cpf_cnpj: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder={clienteForm.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">E-mail</label>
                  <input
                    type="email"
                    value={clienteForm.email}
                    onChange={(e) => setClienteForm(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder="cliente@email.com"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">Telefone</label>
                    <input
                      type="text"
                      value={clienteForm.telefone}
                      onChange={(e) => setClienteForm(prev => ({ ...prev, telefone: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="(00) 0000-0000"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">Celular</label>
                    <input
                      type="text"
                      value={clienteForm.celular}
                      onChange={(e) => setClienteForm(prev => ({ ...prev, celular: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowClienteModal(false)}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingCliente}
                    className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition disabled:opacity-50"
                  >
                    {savingCliente ? 'Salvando...' : 'Criar Cliente'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function statusBadgeClass(status: string) {
  const normalized = String(status || '').toUpperCase();

  if (normalized.includes('REALIZADO') || normalized.includes('PAGO') || normalized.includes('CONCL')) {
    return 'inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  }

  if (normalized.includes('CANCEL') || normalized.includes('DEVOL')) {
    return 'inline-flex rounded-full bg-rose-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
  }

  if (normalized.includes('ABERTO') || normalized.includes('ORCAMENTO') || normalized.includes('PEND')) {
    return 'inline-flex rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  }

  return 'inline-flex rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function isPdvVenda(venda: PdvVendaItem) {
  const markers = [venda.origem, venda.tipo_venda, venda.tipoVenda, venda.fonte]
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase());

  return markers.includes('PDV');
}

function normalizePdvResponse(response: PdvVendasResponse): PdvVendasResponse {
  const grupos = (response.grupos || [])
    .map((grupo) => ({
      ...grupo,
      vendas: (grupo.vendas || []).filter(isPdvVenda),
    }))
    .filter((grupo) => grupo.vendas.length > 0);

  const totalVendas = grupos.reduce((sum, grupo) => sum + grupo.vendas.length, 0);
  const totalValor = grupos.reduce((sum, grupo) => sum + grupo.vendas.reduce((grupoSum, venda) => grupoSum + Number(venda.valor || 0), 0), 0);

  return {
    ...response,
    grupos,
    total_vendas: totalVendas,
    total_valor: totalValor,
  };
}