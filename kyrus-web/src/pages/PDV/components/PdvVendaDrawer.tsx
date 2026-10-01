import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle, Calendar, Clock, Plus, X, User, Mail, Check, Ban, RotateCcw,
  RefreshCw, DollarSign, Percent, UploadCloud, Layers
} from 'lucide-react';
import { api, toPublicAssetUrl } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import { useLookupStore } from '../../../store/lookupStore';
import { BrandAvatar, inferCardBrand } from '../../../components/BrandAvatar';

export interface Produto {
  id: number;
  nome: string;
  preco_unitario: number;
  empresa_id: number;
  is_active: boolean;
  tipo?: string;
  codigo_barras?: string | null;
  imagem_url?: string | null;
  preco_custo_medio?: number | null;
  ncm?: string | null;
  cest?: string | null;
  cfop_padrao?: string | null;
  revisao_pendente?: boolean;
  quantidade_estoque?: number;
}

export interface PdvVendaItem {
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
  campos_extras?: Record<string, any> | null;
  desconto?: number;
  lock_reconciled?: boolean;
  criador_nome?: string | null;
  criador_email?: string | null;
  created_at_str?: string | null;
}

export interface VendaItemLinha {
  produtoId: string;
  quantidade: number;
  desconto: string;
  precoUnitario?: string;
}

export interface VendaPagamentoLinha {
  tipoPagamento: string;
  valor: string;
  numeroParcelas: number;
  valorParcela: string;
  dataPagamento: string;
  bandeira?: string;
}

const decodeHtmlSimple = (str: string) => {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

const formatMonetario = (val: string | number): string => {
  if (val === '' || val === null || val === undefined) return '';
  if (typeof val === 'number') {
    if (isNaN(val)) return '';
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  }
  const str = String(val).trim();
  if (!str) return '';
  const cleanDigits = str.replace(/\D/g, '');
  if (!cleanDigits) return '';
  const num = parseInt(cleanDigits, 10) / 100;
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
};

const parseMonetario = (val: string | number): number => {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).trim();
  const cleanDigits = str.replace(/\D/g, '');
  if (!cleanDigits) return 0;
  return parseInt(cleanDigits, 10) / 100;
};

function compressImageToWebp(file: File, quality = 0.75): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                type: 'image/webp',
                lastModified: Date.now()
              });
              resolve(newFile);
            } else {
              resolve(file);
            }
          },
          'image/webp',
          quality
        );
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

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
  onCreateClick?: () => void;
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
    const nameMatch = decodeHtmlSimple(c.nome || '').toLowerCase().includes(s);
    const cpfMatch = (c.cpf_cnpj || '').replace(/\D/g, '').includes(s.replace(/\D/g, ''));
    return nameMatch || cpfMatch;
  });

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        id="customer-search-select-trigger"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(true); }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      >
        <span className={selectedCustomer ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-400'}>
          {selectedCustomer
            ? `${decodeHtmlSimple(selectedCustomer.nome)} ${selectedCustomer.cpf_cnpj ? `(${selectedCustomer.cpf_cnpj})` : ''}`
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
          {onCreateClick && (
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
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado</div>
          ) : (
            filtered.map((c) => (
              <div
                key={c.id}
                onClick={() => {
                  onChange(c.id);
                  setIsOpen(false);
                }}
                className="cursor-pointer rounded-lg px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-850 flex items-center justify-between"
              >
                <span>{decodeHtmlSimple(c.nome)}</span>
                {c.cpf_cnpj && <span className="text-[10px] text-slate-400">{c.cpf_cnpj}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

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
    decodeHtmlSimple(p.nome).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white min-w-0"
      >
        <div className="flex-1 min-w-0 mr-2">
          {selectedProduct ? (
            <div className="flex items-center gap-2 min-w-0">
              {selectedProduct.imagem_url && (
                <img
                  src={toPublicAssetUrl(selectedProduct.imagem_url) ?? undefined}
                  alt={decodeHtmlSimple(selectedProduct.nome)}
                  className="w-5 h-5 rounded object-cover border border-slate-200 dark:border-slate-800 shrink-0 bg-white"
                />
              )}
              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] shrink-0 ${
                selectedProduct.tipo === 'SERVICO'
                  ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50'
                  : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50'
              }`}>
                {selectedProduct.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
              </span>
              <span className="truncate font-medium text-slate-900 dark:text-white">
                {decodeHtmlSimple(selectedProduct.nome)}
              </span>
            </div>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </div>
        <span className="text-slate-400 text-xs shrink-0">▼</span>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-950">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar produto por nome..."
            className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            onClick={(e) => e.stopPropagation()}
          />
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Nenhum produto encontrado</div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  onChange(String(p.id));
                  setIsOpen(false);
                }}
                className="cursor-pointer rounded-lg px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-850 flex items-center justify-between"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className={`inline-flex rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                    p.tipo === 'SERVICO'
                      ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                      : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                  }`}>
                    {p.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
                  </span>
                  <span className="truncate">{decodeHtmlSimple(p.nome)}</span>
                </div>
                <span className="font-mono text-slate-500 shrink-0 ml-2">
                  R$ {formatMonetario(p.preco_unitario)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export interface PdvVendaDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (savedSale?: any) => void;
  venda?: PdvVendaItem | null;
  vendaUuid?: string | null;
  vendaId?: number | string | null;
  produtos?: Produto[];
  vendedores?: any[];
  centrosCusto?: any[];
  pdvConfig?: any;
}

export function PdvVendaDrawer({
  isOpen,
  onClose,
  onSuccess,
  venda: initialVenda,
  vendaUuid,
  vendaId,
  produtos: initialProdutos,
  vendedores: initialVendedores,
  centrosCusto: initialCentrosCusto,
  pdvConfig: initialPdvConfig,
}: PdvVendaDrawerProps) {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const empresa = useAuthStore((state) => state.empresa);
  const lookupStore = useLookupStore();

  const [editingSaleItem, setEditingSaleItem] = useState<PdvVendaItem | null>(initialVenda || null);
  const [editingSaleUuid, setEditingSaleUuid] = useState<string | null>(null);
  const [isEditingSale, setIsEditingSale] = useState(false);
  const [loadingSale, setLoadingSale] = useState(false);
  const [saleLocked, setSaleLocked] = useState(false);
  const [savingVenda, setSavingVenda] = useState(false);
  const [errorVenda, setErrorVenda] = useState<string | null>(null);

  // Lists
  const [produtos, setProdutos] = useState<Produto[]>(initialProdutos || []);
  const [vendedores, setVendedores] = useState<any[]>(initialVendedores || []);
  const [centrosCusto, setCentrosCusto] = useState<any[]>(initialCentrosCusto || []);
  const [pdvConfig, setPdvConfig] = useState<any>(initialPdvConfig || null);

  // Form Fields
  const [selectedVendedorId, setSelectedVendedorId] = useState<number | null>(null);
  const [selectedEntidadeId, setSelectedEntidadeId] = useState<number | null>(null);
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | null>(null);
  const [vendaRv, setVendaRv] = useState('');
  const [vendaDataPagamento, setVendaDataPagamento] = useState('');
  const [vendaObservacao, setVendaObservacao] = useState('');
  const [vendaStatus, setVendaStatus] = useState<string>('REALIZADO');
  const [camposExtrasForm, setCamposExtrasForm] = useState<Record<string, any>>({});

  // Direct sale vs itemized
  const [isDirectSale, setIsDirectSale] = useState(false);
  const [directSaleValue, setDirectSaleValue] = useState('');
  const [directSaleDiscount, setDirectSaleDiscount] = useState('');
  const [directSaleDescription, setDirectSaleDescription] = useState('');
  const [showDescriptionAccordion, setShowDescriptionAccordion] = useState(false);

  // Itens & Pagamentos
  const [vendaItens, setVendaItens] = useState<VendaItemLinha[]>([{ produtoId: '', quantidade: 1, desconto: '0' }]);
  const [vendaPagamentos, setVendaPagamentos] = useState<VendaPagamentoLinha[]>([
    { tipoPagamento: 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: '', bandeira: 'VISA' }
  ]);
  const [comprovanteFiles, setComprovanteFiles] = useState<File[]>([]);
  const [existingComprovantes, setExistingComprovantes] = useState<string[]>([]);

  // Fast customer creation
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [savingCliente, setSavingCliente] = useState(false);
  const [clienteForm, setClienteForm] = useState({
    nome: '',
    tipo_pessoa: 'PF',
    cpf_cnpj: '',
    email: '',
    telefone: '',
    celular: '',
  });

  const handleClienteSubmit = async (e: FormEvent) => {
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
        empresa_id: empresa?.id
      };

      const response = await api.post('/entidades/', payload);
      const newCustomer = response.data;
      
      await lookupStore.fetchEntidadesLookup(true);
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
  };

  // Load auxiliary lists if needed
  useEffect(() => {
    if (!isOpen) return;

    if (!initialProdutos || initialProdutos.length === 0) {
      api.get<Produto[]>('/pdv/produtos/').then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setProdutos(list.filter(p => p.is_active));
      }).catch(() => {});
    }

    if (!initialVendedores || initialVendedores.length === 0) {
      api.get('/usuarios/').then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setVendedores(list);
      }).catch(() => {});
    }

    if (!initialCentrosCusto || initialCentrosCusto.length === 0) {
      lookupStore.fetchCentrosCusto().then(setCentrosCusto).catch(() => {});
    }

    if (!initialPdvConfig) {
      api.get('/config/pdv').then((res) => setPdvConfig(res.data)).catch(() => {});
    }
  }, [isOpen, initialProdutos, initialVendedores, initialCentrosCusto, initialPdvConfig]);

  // Load sale item by ID or UUID if not provided
  useEffect(() => {
    if (!isOpen) return;

    if (initialVenda) {
      setEditingSaleItem(initialVenda);
      populateSale(initialVenda);
    } else if (vendaUuid || vendaId) {
      setLoadingSale(true);
      const targetIdentifier = vendaUuid || vendaId;
      api.get<PdvVendaItem>(`/pdv/vendas/${targetIdentifier}`)
        .then((res) => {
          setEditingSaleItem(res.data);
          populateSale(res.data);
        })
        .catch((err) => {
          console.error("Erro ao carregar venda:", err);
          alert(err?.response?.data?.detail || "Erro ao carregar detalhes da venda.");
          onClose();
        })
        .finally(() => setLoadingSale(false));
    } else {
      // New sale defaults
      setIsEditingSale(false);
      setEditingSaleUuid(null);
      setEditingSaleItem(null);
      setSaleLocked(false);
      setSelectedVendedorId(currentUserId);
      setSelectedEntidadeId(null);
      const pdvCcId = pdvConfig?.pdv_centro_custo_padrao_id ?? pdvConfig?.centro_custo_padrao_id;
      setSelectedCentroCustoId(pdvCcId || (centrosCusto.length === 1 ? centrosCusto[0].id : null));
      setVendaRv('');
      setVendaDataPagamento(new Date().toISOString().split('T')[0]);
      setVendaObservacao('');
      setVendaStatus('REALIZADO');
      setIsDirectSale(false);
      setDirectSaleValue('');
      setDirectSaleDiscount('');
      setDirectSaleDescription('');
      setVendaItens([{ produtoId: '', quantidade: 1, desconto: '0' }]);
      setVendaPagamentos([{ tipoPagamento: 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: new Date().toISOString().split('T')[0], bandeira: 'VISA' }]);
      setComprovanteFiles([]);
      setExistingComprovantes([]);
      setCamposExtrasForm({});
    }
  }, [isOpen, initialVenda, vendaUuid, vendaId]);

  function populateSale(venda: PdvVendaItem) {
    setErrorVenda(null);
    setIsEditingSale(true);
    setEditingSaleUuid(venda.venda_id_uuid ?? String(venda.id));
    setSaleLocked(Boolean(venda.lock_reconciled));
    setSelectedVendedorId(venda.vendedor_id ?? currentUserId);
    setSelectedEntidadeId(venda.entidade_id ?? null);
    setSelectedCentroCustoId(venda.centro_custo_id ?? null);
    setVendaRv(venda.rv ?? '');
    setVendaDataPagamento(venda.data ?? '');
    setVendaObservacao(venda.observacao_texto ?? '');
    setVendaStatus(venda.status ?? 'REALIZADO');

    // Detect direct sale
    const firstItem = venda.itens_detalhe?.[0];
    const isGenericProduct = firstItem && (
      Number(firstItem.produto_id) <= 0 ||
      firstItem.produto_nome === 'Venda Geral' ||
      firstItem.nome === 'Venda Geral'
    );
    const isDirect = (venda as any).is_direct_sale || (venda.itens_detalhe?.length === 1 && isGenericProduct);
    setIsDirectSale(Boolean(isDirect));
    if (isDirect && firstItem) {
      setDirectSaleValue(formatMonetario((firstItem.preco_unitario || 0) * (firstItem.quantidade || 1)));
      setDirectSaleDiscount(formatMonetario(firstItem.desconto || 0));
      setDirectSaleDescription(firstItem.nome || firstItem.nome_customizado || firstItem.produto_nome || 'Venda Geral');
    } else {
      setDirectSaleValue('');
      setDirectSaleDiscount('');
      setDirectSaleDescription('');
    }

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
      setVendaItens([{ produtoId: '', quantidade: 1, desconto: '0', precoUnitario: '' }]);
    }

    if (venda.pagamentos_detalhe && venda.pagamentos_detalhe.length > 0) {
      setVendaPagamentos(
        venda.pagamentos_detalhe.map((p: any) => ({
          tipoPagamento: p.tipo_pagamento || p.tipoPagamento || 'dinheiro',
          valor: formatMonetario(p.valor || 0),
          numeroParcelas: p.numero_parcelas || p.numeroParcelas || 1,
          valorParcela: p.valor_parcela ? formatMonetario(p.valor_parcela) : '',
          dataPagamento: p.data_pagamento ? p.data_pagamento.substring(0, 10) : new Date().toISOString().split('T')[0],
          bandeira: p.bandeira || 'OUTROS'
        }))
      );
    } else {
      setVendaPagamentos([
        { tipoPagamento: 'dinheiro', valor: formatMonetario(venda.valor || 0), numeroParcelas: 1, valorParcela: '', dataPagamento: new Date().toISOString().split('T')[0], bandeira: 'OUTROS' }
      ]);
    }

    const urls = (venda as any).comprovante_urls || (venda.comprovante_url ? [venda.comprovante_url] : []);
    setExistingComprovantes(urls);
    setCamposExtrasForm(venda.campos_extras || {});
  }

  // Calculated values
  const vendaValores = useMemo(() => {
    let subtotal = 0;
    let desconto = 0;

    if (isDirectSale) {
      subtotal = parseMonetario(directSaleValue);
      desconto = parseMonetario(directSaleDiscount);
    } else {
      vendaItens.forEach((it) => {
        const prod = produtos.find((p) => String(p.id) === it.produtoId);
        const precoUnit = it.precoUnitario ? parseMonetario(it.precoUnitario) : (prod?.preco_unitario || 0);
        const lineSub = precoUnit * (it.quantidade || 1);
        const lineDesc = parseMonetario(it.desconto);
        subtotal += lineSub;
        desconto += lineDesc;
      });
    }

    const total = Math.max(0, subtotal - desconto);
    const pagamentosTotal = vendaPagamentos.reduce((acc, p) => acc + parseMonetario(p.valor), 0);
    const troco = Math.max(0, pagamentosTotal - total);

    return { subtotal, desconto, total, pagamentosTotal, troco };
  }, [isDirectSale, directSaleValue, directSaleDiscount, vendaItens, produtos, vendaPagamentos]);

  const isPaymentValid = Math.abs(vendaValores.pagamentosTotal - vendaValores.total) < 0.05 || vendaValores.pagamentosTotal >= vendaValores.total;

  const handleUpdateStatus = async (newStatus: string) => {
    if (!editingSaleUuid) return;
    try {
      await api.patch(`/pdv/vendas/${editingSaleUuid}/status`, { status: newStatus });
      setVendaStatus(newStatus);
      onSuccess?.({ status: newStatus });
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao atualizar status da venda.');
    }
  };

  const handleSaveVenda = async (e: FormEvent) => {
    e.preventDefault();
    if (savingVenda) return;

    let validItens = [];
    if (isDirectSale) {
      if (!directSaleValue || parseMonetario(directSaleValue) <= 0) {
        setErrorVenda('O valor da venda direta deve ser maior que zero.');
        return;
      }
      validItens = [{
        produto_id: 0,
        quantidade: 1,
        preco_unitario: parseMonetario(directSaleValue),
        desconto: parseMonetario(directSaleDiscount || '0'),
        nome_customizado: directSaleDescription.trim() || 'Venda Geral'
      }];
    } else {
      validItens = vendaItens.filter((i) => i.produtoId !== '').map((i) => ({
        produto_id: Number(i.produtoId),
        quantidade: i.quantidade,
        preco_unitario: i.precoUnitario ? parseMonetario(i.precoUnitario) : undefined,
        desconto: parseMonetario(i.desconto || '0')
      }));
      if (validItens.length === 0) {
        setErrorVenda('Adicione pelo menos um produto válido.');
        return;
      }
    }

    if (!isPaymentValid) {
      setErrorVenda(`O total pago (R$ ${formatMonetario(vendaValores.pagamentosTotal)}) deve ser igual ou maior que o total da venda (R$ ${formatMonetario(vendaValores.total)}).`);
      return;
    }

    setSavingVenda(true);
    setErrorVenda(null);

    try {
      const payload = {
        entidade_id: selectedEntidadeId,
        centro_custo_id: selectedCentroCustoId,
        vendedor_id: selectedVendedorId,
        rv: vendaRv.trim() || null,
        data_pagamento: vendaDataPagamento || new Date().toISOString().split('T')[0],
        observacao: vendaObservacao.trim() || null,
        desconto: vendaValores.desconto,
        status: vendaStatus,
        itens: validItens,
        pagamentos: vendaPagamentos.map((p) => ({
          tipo_pagamento: p.tipoPagamento,
          valor: parseMonetario(p.valor),
          numero_parcelas: p.numeroParcelas || 1,
          valor_parcela: p.valorParcela ? parseMonetario(p.valorParcela) : null,
          data_pagamento: p.dataPagamento || new Date().toISOString().split('T')[0],
          bandeira: p.bandeira || 'OUTROS'
        })),
        campos_extras: Object.keys(camposExtrasForm).length > 0 ? camposExtrasForm : null
      };

      let savedData: any;
      if (isEditingSale && editingSaleUuid) {
        const res = await api.put(`/pdv/vendas/${editingSaleUuid}`, payload);
        savedData = res.data;
      } else {
        const res = await api.post('/pdv/vendas', payload);
        savedData = res.data;
      }

      // Upload receipts if added
      const targetUuid = savedData?.venda_id_uuid || editingSaleUuid;
      if (comprovanteFiles.length > 0 && targetUuid) {
        const formDataUpload = new FormData();
        for (const file of comprovanteFiles) {
          formDataUpload.append('files', file);
        }
        await api.post(`/pdv/vendas/${targetUuid}/comprovante`, formDataUpload, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }

      onSuccess?.(savedData);
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar venda:', err);
      setErrorVenda(err?.response?.data?.detail || 'Erro ao registrar venda.');
    } finally {
      setSavingVenda(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm" onClick={() => !savingVenda && onClose()} />
      <div className="fixed inset-y-0 right-0 w-full md:max-w-[75vw] bg-white dark:bg-slate-900 shadow-2xl z-50 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 translate-x-0">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-900">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">{isEditingSale ? 'Editar Venda' : 'Nova Venda'}</p>
            <h3 className="font-bold text-slate-800 dark:text-white">{isEditingSale ? 'Editar Lançamentos da Venda' : 'Lançamento Assistido - PDV'}</h3>
          </div>
          <button onClick={() => !savingVenda && onClose()} aria-label="Fechar" className="text-slate-500 hover:text-slate-700 dark:hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadingSale ? (
          <div className="h-[calc(100vh-140px)] flex flex-col items-center justify-center p-8 text-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mb-2" />
            <span className="text-xs font-bold">Carregando dados da venda...</span>
          </div>
        ) : (
          /* Form Scrollable Body */
          <div className="h-[calc(100vh-140px)] overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/50 dark:bg-slate-950/20">
            {saleLocked && (
              <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 p-3.5 rounded-xl border border-amber-200/40 text-xs select-none shadow-sm">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <div>
                  <strong>Venda Bloqueada para Alterações:</strong> Esta venda possui recebíveis agrupados de cartão que já foram liquidados (pagos) no banco e conciliados no financeiro. Por segurança, alterações ou cancelamentos não são permitidos.
                </div>
              </div>
            )}

            {errorVenda && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {errorVenda}
              </div>
            )}

            {/* Informações de Auditoria: Criador da Venda */}
            {isEditingSale && editingSaleItem && (
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-blue-500" />
                    Auditoria de Criação da Venda
                  </span>
                  <span className="text-[9px] font-mono font-bold px-2 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-lg">
                    {editingSaleItem.rv || 'Venda PDV'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                    <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                      {(editingSaleItem.criador_nome || editingSaleItem.vendedor || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-800 dark:text-white truncate">
                        {editingSaleItem.criador_nome || editingSaleItem.vendedor}
                      </div>
                      {editingSaleItem.criador_email ? (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate font-mono">
                          <Mail className="w-3 h-3 shrink-0 text-slate-400" />
                          {editingSaleItem.criador_email}
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400 italic">Vendedor Responsável</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-950 px-3 py-2.5 rounded-lg border border-slate-100 dark:border-slate-800 text-xs">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Criado em:
                    </span>
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                      {editingSaleItem.created_at_str || `${editingSaleItem.data} às ${editingSaleItem.hora || '00:00'}`}
                    </span>
                  </div>
                </div>
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
                        onClick={() => handleUpdateStatus('REALIZADO')}
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
                          onClick={() => handleUpdateStatus('CANCELADO')}
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
                          onClick={() => handleUpdateStatus('DEVOLVIDO')}
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-500 hover:bg-slate-400 text-white shadow transition-all hover:scale-105 cursor-pointer"
                          title="Registrar Devolução"
                        >
                          <RotateCcw className="h-6 w-6" />
                        </button>
                        <span className="text-[10px] font-bold text-slate-500">Devolver</span>
                      </div>
                    </>
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
                  customers={lookupStore.entidadesLookup}
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
            {vendedores.length > 1 && (
              <div>
                <label className="mb-2 block text-xs font-bold text-slate-400 uppercase tracking-wider">Vendedor Responsável</label>
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
              </div>
            )}

            {/* Alternância Venda Direta vs Catálogo */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <button
                type="button"
                onClick={() => setIsDirectSale(false)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  !isDirectSale
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                Catálogo de Itens
              </button>
              <button
                type="button"
                onClick={() => setIsDirectSale(true)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  isDirectSale
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                Venda Direta / Rápida
              </button>
            </div>

            {/* Itens da Venda */}
            {isDirectSale ? (
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1 space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Valor Bruto da Venda *</label>
                    <input
                      type="text"
                      value={directSaleValue}
                      onChange={(e) => setDirectSaleValue(formatMonetario(e.target.value))}
                      placeholder="0,00"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-bold"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Desconto (R$)</label>
                    <input
                      type="text"
                      value={directSaleDiscount}
                      onChange={(e) => setDirectSaleDiscount(formatMonetario(e.target.value))}
                      placeholder="0,00"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Descrição dos Itens Vendidos (Opcional)</label>
                  <input
                    type="text"
                    value={directSaleDescription}
                    onChange={(e) => setDirectSaleDescription(e.target.value)}
                    placeholder="Ex: Coca-cola 2L, 3 Salgados, etc."
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Itens Vendidos</label>
                {vendaItens.map((item, index) => {
                  const prod = produtos.find((p) => String(p.id) === String(item.produtoId));
                  const isService = prod?.tipo === 'SERVICO';
                  const precoUsado = item.precoUnitario
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
                          products={produtos}
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
                        <span className="text-sm font-extrabold text-slate-900 dark:text-white block mt-2 font-mono">
                          R$ {formatMonetario(subLine)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={() => setVendaItens((prev) => [...prev, { produtoId: '', quantidade: 1, desconto: '0' }])}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-xl transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Item
                  </button>
                </div>
              </div>
            )}

            {/* Pagamentos */}
            <div className="space-y-4">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Pagamentos da Venda</label>
              {vendaPagamentos.map((pag, index) => {
                const isCard = pag.tipoPagamento.includes('credito') || pag.tipoPagamento.includes('debito');
                return (
                  <div key={index} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Forma de Pagamento</label>
                        <select
                          value={pag.tipoPagamento}
                          onChange={(e) => {
                            const updated = [...vendaPagamentos];
                            updated[index].tipoPagamento = e.target.value;
                            setVendaPagamentos(updated);
                          }}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        >
                          <option value="dinheiro">Dinheiro</option>
                          <option value="pix">PIX</option>
                          <option value="cartao_debito">Cartão de Débito</option>
                          <option value="cartao_credito_vista">Crédito à Vista</option>
                          <option value="cartao_credito_parcelado">Crédito Parcelado</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Valor (R$)</label>
                        <input
                          type="text"
                          value={pag.valor}
                          onChange={(e) => {
                            const updated = [...vendaPagamentos];
                            updated[index].valor = formatMonetario(e.target.value);
                            setVendaPagamentos(updated);
                          }}
                          placeholder="0,00"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white font-mono"
                        />
                      </div>

                      {pag.tipoPagamento === 'cartao_credito_parcelado' && (
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Parcelas</label>
                          <input
                            type="number"
                            min="2"
                            max="12"
                            value={pag.numeroParcelas}
                            onChange={(e) => {
                              const updated = [...vendaPagamentos];
                              updated[index].numeroParcelas = Math.max(1, parseInt(e.target.value) || 1);
                              setVendaPagamentos(updated);
                            }}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white font-mono"
                          />
                        </div>
                      )}
                    </div>

                    {isCard && (
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Bandeira</label>
                        <div className="flex flex-wrap gap-2">
                          {['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OUTROS'].map((brand) => (
                            <button
                              key={brand}
                              type="button"
                              onClick={() => {
                                const updated = [...vendaPagamentos];
                                updated[index].bandeira = brand;
                                setVendaPagamentos(updated);
                              }}
                              className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold transition cursor-pointer ${
                                (pag.bandeira || 'OUTROS') === brand
                                  ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400'
                              }`}
                            >
                              {brand}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={() => setVendaPagamentos((prev) => [
                    ...prev,
                    { tipoPagamento: 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: new Date().toISOString().split('T')[0], bandeira: 'OUTROS' }
                  ])}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-xl transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Pagamento
                </button>
              </div>
            </div>

            {/* Resumo Financeiro */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-2">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Subtotal:</span>
                <span className="font-mono font-bold">R$ {formatMonetario(vendaValores.subtotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-rose-500">
                <span>Desconto:</span>
                <span className="font-mono font-bold">- R$ {formatMonetario(vendaValores.desconto)}</span>
              </div>
              <div className="flex justify-between text-base font-extrabold text-slate-800 dark:text-white pt-2 border-t border-slate-100 dark:border-slate-800">
                <span>Total a Pagar:</span>
                <span className="font-mono text-blue-600 dark:text-blue-400">R$ {formatMonetario(vendaValores.total)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 pt-1">
                <span>Total Informado nos Pagamentos:</span>
                <span className={`font-mono font-bold ${vendaValores.pagamentosTotal < vendaValores.total ? 'text-amber-500' : 'text-emerald-500'}`}>
                  R$ {formatMonetario(vendaValores.pagamentosTotal)}
                </span>
              </div>
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex justify-end gap-3 absolute bottom-0 left-0 right-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={savingVenda || loadingSale || saleLocked}
            onClick={handleSaveVenda}
            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg transition disabled:opacity-50 cursor-pointer"
          >
            {savingVenda ? 'Salvando...' : (saleLocked ? 'Venda Bloqueada' : 'Salvar Venda')}
          </button>
        </div>

      </div>

      {/* Modal Rápido de Cadastro de Cliente */}
      {showClienteModal && (
        <>
          <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowClienteModal(false)} />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
