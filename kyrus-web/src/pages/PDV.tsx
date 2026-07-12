import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { FormEvent } from 'react';
import { AlertCircle, Calendar, Plus, Sparkles, X, Trash2, Edit3, Package, DollarSign, Percent, User, Download, Check, Ban, RotateCcw, UploadCloud, Search, Loader2, Info, QrCode, Camera, Printer } from 'lucide-react';
import { api, toPublicAssetUrl, normalizeListResponse } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { BrandAvatar, inferCardBrand } from '../components/BrandAvatar';
import { usePosStore } from '../store/usePosStore';

// Interfaces
interface Produto {
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
  campos_extras?: Record<string, any> | null;
  desconto?: number;
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
  has_more?: boolean;
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

function compressImageToWebp(file: File, quality = 0.75): Promise<File> {
  return new Promise((resolve, reject) => {
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
        let width = img.width;
        let height = img.height;
        
        const MAX_DIM = 1600;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const newFileName = file.name.substring(0, file.name.lastIndexOf('.')) + '.webp';
              const newFile = new File([blob], newFileName, {
                type: 'image/webp',
                lastModified: Date.now(),
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

function imprimirCupom(venda: PdvVendaItem) {
  const printWindow = window.open('', '_blank', 'width=300,height=600');
  if (!printWindow) return;

  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const itensHtml = (venda.itens_detalhe || []).map((it: any) => `
    <tr>
      <td colspan="3" style="padding-top: 5px;">${it.nome}</td>
    </tr>
    <tr style="border-bottom: 1px dashed #ccc;">
      <td style="padding-bottom: 5px;">${it.quantidade} x ${currency.format(it.preco_unitario)}</td>
      <td style="text-align: right; padding-bottom: 5px;">${currency.format(it.desconto > 0 ? -it.desconto : 0)}</td>
      <td style="text-align: right; padding-bottom: 5px;">${currency.format((it.preco_unitario * it.quantidade) - (it.desconto || 0))}</td>
    </tr>
  `).join('');

  const pagamentosHtml = (venda.pagamentos_detalhe || []).map((p: any) => `
    <div style="display: flex; justify-content: space-between; font-size: 11px;">
      <span>${p.tipo_pagamento.replace('_', ' ').toUpperCase()} ${p.numero_parcelas > 1 ? `(${p.numero_parcelas}x)` : ''}</span>
      <span>${currency.format(p.valor)}</span>
    </div>
  `).join('');

  const camposExtrasHtml = Object.entries(venda.campos_extras || {}).map(([key, val]) => `
    <div style="font-size: 10px; color: #555;">
      <strong>${key.toUpperCase()}:</strong> ${val}
    </div>
  `).join('');

  printWindow.document.write(`
    <html>
      <head>
        <title>Cupom Não Fiscal - ${venda.rv}</title>
        <style>
          @page {
            size: 80mm auto;
            margin: 0;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 72mm;
            margin: 0;
            padding: 4mm;
            font-size: 12px;
            line-height: 1.2;
            color: #000;
            background: #fff;
          }
          .text-center { text-align: center; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .bold { font-weight: bold; }
          .totals-table td { padding: 2px 0; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <h3 style="margin: 0; font-size: 14px;">KYRUS ERP</h3>
          <p style="margin: 2px 0; font-size: 10px;">CUPOM NÃO FISCAL</p>
        </div>
        
        <div class="divider"></div>
        
        <div style="font-size: 11px;">
          <div><strong>RV:</strong> ${venda.rv}</div>
          <div><strong>Data:</strong> ${venda.data} ${venda.hora ? ` - ${venda.hora}` : ''}</div>
          <div><strong>Vendedor:</strong> ${venda.vendedor}</div>
          ${camposExtrasHtml}
        </div>
        
        <div class="divider"></div>
        
        <table>
          <thead>
            <tr style="border-bottom: 1px solid #000;">
              <th style="text-align: left;">Qtd x Unit</th>
              <th style="text-align: right;">Desc</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itensHtml}
          </tbody>
        </table>
        
        <div class="divider"></div>
        
        <table class="totals-table">
          <tr>
            <td>SUBTOTAL:</td>
            <td style="text-align: right;">${currency.format(Number(venda.valor) + Number(venda.desconto || 0))}</td>
          </tr>
          ${venda.desconto ? `
          <tr>
            <td>DESCONTO:</td>
            <td style="text-align: right;">-${currency.format(venda.desconto)}</td>
          </tr>
          ` : ''}
          <tr class="bold" style="font-size: 13px;">
            <td>TOTAL LÍQUIDO:</td>
            <td style="text-align: right;">${currency.format(venda.valor)}</td>
          </tr>
        </table>
        
        <div class="divider"></div>
        
        <div class="bold" style="font-size: 10px; margin-bottom: 4px;">PAGAMENTOS:</div>
        ${pagamentosHtml}
        
        <div class="divider"></div>
        
        <div class="text-center" style="font-size: 10px; margin-top: 10px;">
          OBRIGADO PELA PREFERÊNCIA!
        </div>
        
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
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
        id="customer-search-select-trigger"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(true); }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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
  onCreateClick,
  placeholder = 'Selecione um produto'
}: {
  products: Produto[];
  selectedValue: string;
  onChange: (productId: string) => void;
  onCreateClick?: () => void;
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
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white min-w-0"
      >
        <div className="flex-1 min-w-0 mr-2">
          {selectedProduct ? (
            <div className="flex items-center gap-2 min-w-0">
              {selectedProduct.imagem_url && (
                <img
                  src={toPublicAssetUrl(selectedProduct.imagem_url) ?? undefined}
                  alt={selectedProduct.nome}
                  className="w-5 h-5 rounded object-cover border border-slate-200 dark:border-slate-800 shrink-0 bg-white"
                />
              )}
              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] shrink-0 ${
                selectedProduct.tipo === 'SERVICO'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
              }`}>
                {selectedProduct.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
              </span>
              {selectedProduct.revisao_pendente && (
                <span className="inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  Revisar
                </span>
              )}
              <span className="truncate text-slate-900 dark:text-white font-medium">{selectedProduct.nome} - {formatCurrency(Number(selectedProduct.preco_unitario))}</span>
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
            placeholder="Pesquisar..."
            className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            onClick={(e) => e.stopPropagation()}
          />
          {onCreateClick && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onCreateClick();
                setIsOpen(false);
                setSearch('');
              }}
              className="cursor-pointer rounded-lg px-3 py-2 text-xs transition bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 mb-2 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              + Cadastrar Novo Item
            </div>
          )}
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
                className={`cursor-pointer rounded-xl p-2.5 text-xs transition hover:bg-slate-100 dark:hover:bg-slate-900 border-b border-slate-100/50 dark:border-slate-900/50 last:border-b-0 ${
                  String(prod.id) === String(selectedValue)
                    ? 'bg-blue-50/50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex gap-2.5 items-start min-w-0 w-full">
                  {prod.imagem_url ? (
                    <img
                      src={toPublicAssetUrl(prod.imagem_url) ?? undefined}
                      alt={prod.nome}
                      className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-800 shrink-0 bg-white"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center text-[8px] font-bold text-slate-400 shrink-0">
                      N/A
                    </div>
                  )}

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="font-bold text-slate-900 dark:text-white truncate">
                      {prod.nome}
                    </div>

                    <div className="flex flex-wrap items-center gap-1 text-[9px]">
                      <span className={`inline-flex rounded px-1.5 py-0.5 font-bold uppercase shrink-0 ${
                        prod.tipo === 'SERVICO'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      }`}>
                        {prod.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
                      </span>

                      {prod.revisao_pendente && (
                        <span className="inline-flex rounded px-1.5 py-0.5 font-bold uppercase shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          Revisar
                        </span>
                      )}

                      {prod.tipo === 'PRODUTO' && (
                        <span className={`inline-flex rounded px-1.5 py-0.5 font-bold uppercase shrink-0 ${
                          Number(prod.quantidade_estoque || 0) > 0
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300'
                        }`}>
                          Estoque: {prod.quantidade_estoque ?? 0}
                        </span>
                      )}

                      <span className="font-bold text-slate-500 dark:text-slate-400 ml-auto text-[10px]">
                        {formatCurrency(Number(prod.preco_unitario))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
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

const handleDownloadQrCode = async (product: Produto) => {
  try {
    const data = product.codigo_barras || `KYRUS-PROD-${product.id}`;
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data)}`;
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${product.nome.toLowerCase().replace(/\s+/g, '_')}_qrcode.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("Erro ao baixar o QR Code:", error);
    const data = product.codigo_barras || `KYRUS-PROD-${product.id}`;
    window.open(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data)}`, '_blank');
  }
};

// Componente Principal
export function PDV() {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const currentUserName = useAuthStore((state) => state.user?.nome ?? state.user?.email ?? '');

  const pendingSales = usePosStore((state) => state.pendingSales);
  const isOnline = usePosStore((state) => state.isOnline);
  const addSale = usePosStore((state) => state.addSale);
  const syncPendingSales = usePosStore((state) => state.syncPendingSales);



  // Vendas State
  const [data, setData] = useState<PdvVendasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Produtos State
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [errorProdutos, setErrorProdutos] = useState<string | null>(null);
  const [filtroProdutoTipo, setFiltroProdutoTipo] = useState<'TODOS' | 'PRODUTO' | 'SERVICO'>('TODOS');
  const [filtroRevisaoPendente, setFiltroRevisaoPendente] = useState<boolean>(false);

  // Produto Form State (Modal)
  const [showProdutoForm, setShowProdutoForm] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [produtoNome, setProdutoNome] = useState('');
  const [produtoPreco, setProdutoPreco] = useState('');
  const [produtoTipo, setProdutoTipo] = useState<string>('PRODUTO');
  const [produtoRevisaoPendente, setProdutoRevisaoPendente] = useState<boolean>(false);
  const [savingProduto, setSavingProduto] = useState(false);

  // Mapeamento / Mesclagem State
  const [showVincularModal, setShowVincularModal] = useState(false);
  const [selectedExistenteId, setSelectedExistenteId] = useState<string>('');
  const [merging, setMerging] = useState(false);

  // QR Code & Scanner State
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrModalProduct, setQrModalProduct] = useState<Produto | null>(null);
  const [showScannerModal, setShowScannerModal] = useState(false);

  const handleScanBarcode = (barcode: string) => {
    const found = produtos.find(p => p.codigo_barras === barcode && p.is_active !== false);
    if (!found) {
      alert(`Código de barras "${barcode}" não encontrado no catálogo de produtos.`);
      return;
    }
    
    // Add to vendaItens or replace the first empty item
    const emptyIndex = vendaItens.findIndex(item => !item.produtoId);
    if (emptyIndex !== -1) {
      const newItens = [...vendaItens];
      newItens[emptyIndex] = {
        produtoId: String(found.id),
        quantidade: 1,
        desconto: '0',
        precoUnitario: formatMonetario(found.preco_unitario)
      };
      setVendaItens(newItens);
    } else {
      setVendaItens([...vendaItens, {
        produtoId: String(found.id),
        quantidade: 1,
        desconto: '0',
        precoUnitario: formatMonetario(found.preco_unitario)
      }]);
    }
    setShowScannerModal(false);
  };

  // Novos campos para aba e catalogacao detalhada (Passo 6)
  const [produtoCodigoBarras, setProdutoCodigoBarras] = useState('');
  const [produtoImagemUrl, setProdutoImagemUrl] = useState('');
  const [produtoPrecoCustoMedio, setProdutoPrecoCustoMedio] = useState('');
  const [produtoNcm, setProdutoNcm] = useState('');
  const [produtoCest, setProdutoCest] = useState('');
  const [produtoCfopPadrao, setProdutoCfopPadrao] = useState('');
  const [filtroProdutoNome, setFiltroProdutoNome] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const empresaId = useAuthStore((state) => state.user?.empresa_id ?? null);
  const empresa = useAuthStore((state) => state.empresa);
  const setEmpresa = useAuthStore((state) => state.setEmpresa);

  const pdvConfig = useMemo(() => {
    if (!empresa || !empresa.pdv_config) return null;
    try {
      return JSON.parse(empresa.pdv_config);
    } catch (e) {
      return null;
    }
  }, [empresa]);

  const customFields = useMemo(() => {
    return pdvConfig?.campos_personalizados || [];
  }, [pdvConfig]);

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

  const initStaticPayments = useCallback((existingPagamentos?: any[]) => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (existingPagamentos && existingPagamentos.length > 0) {
      return existingPagamentos.map((existing: any) => {
        const tipoPagamento = existing.tipoPagamento || existing.tipo_pagamento || 'dinheiro';
        const valor = existing.valor || 0;
        const numeroParcelas = existing.numeroParcelas ?? existing.numero_parcelas ?? 1;
        const valorParcela = existing.valorParcela ?? existing.valor_parcela ?? '';
        const dataPagamento = existing.dataPagamento ?? existing.data_pagamento ?? todayStr;
        const bandeira = existing.bandeira ?? 'OUTROS';

        return {
          tipoPagamento,
          valor: formatMonetario(valor),
          numeroParcelas,
          valorParcela: valorParcela ? formatMonetario(valorParcela) : '',
          dataPagamento,
          bandeira
        };
      });
    }
    const defaultKey = pdvConfig?.forma_pagamento_padrao || 'dinheiro';
    return [
      { tipoPagamento: defaultKey, valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: todayStr, bandeira: 'OUTROS' }
    ];
  }, [pdvConfig]);

  const isMethodParcelado = (key: string) => {
    if (!key) return false;
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
  const [camposExtrasForm, setCamposExtrasForm] = useState<Record<string, any>>({});
  const [limit, setLimit] = useState(200);
  const [isDirectSale, setIsDirectSale] = useState(false);
  const [directSaleValue, setDirectSaleValue] = useState('');
  const [directSaleDiscount, setDirectSaleDiscount] = useState('');
  const [directSaleDescription, setDirectSaleDescription] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  
  // Múltiplos Pagamentos, Status e Comprovante
  const [vendaStatus, setVendaStatus] = useState<string>('REALIZADO');
  const [vendaPagamentos, setVendaPagamentos] = useState<VendaPagamentoLinha[]>([
    { tipoPagamento: 'dinheiro', valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: '', bandeira: 'VISA' }
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
    let result = produtos;
    if (filtroProdutoTipo !== 'TODOS') {
      result = result.filter((p) => (p.tipo || 'PRODUTO') === filtroProdutoTipo);
    }
    if (filtroRevisaoPendente) {
      result = result.filter((p) => p.revisao_pendente);
    }
    if (filtroProdutoNome.trim()) {
      const q = filtroProdutoNome.toLowerCase().trim();
      result = result.filter(
        (p) =>
          p.nome.toLowerCase().includes(q) ||
          (p.codigo_barras && p.codigo_barras.toLowerCase().includes(q))
      );
    }
    return result;
  }, [produtos, filtroProdutoTipo, filtroRevisaoPendente, filtroProdutoNome]);

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
  async function loadVendas(limitVal = limit) {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<PdvVendasResponse>(`/pdv/vendas?limit=${limitVal}`);
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
      const pdvCcId = pdvConfig?.pdv_centro_custo_padrao_id ?? pdvConfig?.centro_custo_padrao_id;
      if (pdvCcId) {
        setSelectedCentroCustoId(pdvCcId);
      } else if (list && list.length > 0) {
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
    void loadProdutos();
    void loadVendedores();
    void loadCentrosCusto();
    void fetchEntidadesLookup();
  }, [empresaId]);

  useEffect(() => {
    void loadVendas(limit);
  }, [empresaId, limit]);

  useEffect(() => {
    if (isOnline) {
      void syncPendingSales();
    }
  }, [isOnline]);

  // Hook Global para Leitor de Código de Barras (Passo 6)
  const barcodeBufferRef = useRef<string>('');
  const lastCharTimeRef = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Atalhos Globais quando a gaveta de Venda está aberta
      if (showVendaForm) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowVendaForm(false);
          return;
        }
        if (e.key === 'F4') {
          e.preventDefault();
          setIsDirectSale((prev) => !prev);
          return;
        }
        if (e.key === 'F2') {
          e.preventDefault();
          handleNovaVendaSubmit(new Event('submit') as any);
          return;
        }
      }

      // Ignora teclas de modificação comuns
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = Date.now();
      const timeDiff = now - lastCharTimeRef.current;
      
      if (e.key === 'Enter') {
        const barcode = barcodeBufferRef.current.trim();
        barcodeBufferRef.current = ''; // Limpa buffer
        
        if (barcode.length >= 8 && /^[0-9a-zA-Z]+$/.test(barcode)) {
          e.preventDefault();
          e.stopPropagation();
          
          // Ação ao detectar o código de barras
          const foundProduct = produtos.find(
            (p) => p.codigo_barras && p.codigo_barras.trim().toLowerCase() === barcode.toLowerCase()
          );

          if (foundProduct) {
            if (showVendaForm) {
              // Se a gaveta de venda estiver aberta, adiciona/incrementa o produto
              setVendaItens((prevItens) => {
                const existingIdx = prevItens.findIndex((item) => String(item.produtoId) === String(foundProduct.id));
                if (existingIdx > -1) {
                  const updated = [...prevItens];
                  updated[existingIdx].quantidade += 1;
                  return updated;
                }
                const last = prevItens[prevItens.length - 1];
                if (last && !last.produtoId) {
                  const updated = [...prevItens];
                  updated[updated.length - 1] = {
                    produtoId: String(foundProduct.id),
                    quantidade: 1,
                    desconto: '0',
                    precoUnitario: formatMonetario(foundProduct.preco_unitario),
                  };
                  return updated;
                }
                return [
                  ...prevItens,
                  {
                    produtoId: String(foundProduct.id),
                    quantidade: 1,
                    desconto: '0',
                    precoUnitario: formatMonetario(foundProduct.preco_unitario),
                  },
                ];
              });
            } else {
              // Se a gaveta de venda estiver fechada, abre e adiciona o produto
              setShowVendaForm(true);
              setVendaItens([
                {
                  produtoId: String(foundProduct.id),
                  quantidade: 1,
                  desconto: '0',
                  precoUnitario: formatMonetario(foundProduct.preco_unitario),
                },
              ]);
            }
          } else {
            alert(`Produto com código de barras "${barcode}" não cadastrado.`);
          }
          return;
        }
      }

      // Se o tempo desde o último caractere for superior a 50ms, assume-se que é digitação manual
      if (timeDiff > 50) {
        barcodeBufferRef.current = '';
      }

      // Acumula apenas caracteres alfanuméricos
      if (e.key.length === 1 && /^[0-9a-zA-Z]$/.test(e.key)) {
        barcodeBufferRef.current += e.key;
        lastCharTimeRef.current = now;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [produtos, showVendaForm, isDirectSale, directSaleValue, directSaleDiscount, vendaItens]);

  // Formatters
  const currency = useMemo(() => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }), []);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }), []);

  const temVendas = Boolean(data && Array.isArray(data.grupos) && data.grupos.length > 0);

  // Subtotal e Total Dinâmicos da Nova Venda
  const vendaValores = useMemo(() => {
    if (isDirectSale) {
      const subtotal = parseMonetario(directSaleValue);
      const totalDesconto = parseMonetario(directSaleDiscount);
      const total = Math.max(0, subtotal - totalDesconto);
      return { subtotal, total, totalDesconto };
    }

    let subtotal = 0;
    let totalDesconto = 0;

    vendaItens.forEach((item) => {
      if (!item.produtoId) return;
      const prod = produtos.find((p) => String(p.id) === String(item.produtoId));
      if (prod) {
        const precoUsado = item.precoUnitario
          ? parseMonetario(item.precoUnitario)
          : Number(prod.preco_unitario);
        subtotal += precoUsado * item.quantidade;
        totalDesconto += parseMonetario(item.desconto);
      }
    });

    const total = Math.max(0, subtotal - totalDesconto);

    return { subtotal, total, totalDesconto };
  }, [isDirectSale, directSaleValue, directSaleDiscount, vendaItens, produtos]);

  // Total preenchido nas formas de pagamento
  const paymentTotal = useMemo(() => {
    return vendaPagamentos.reduce((acc, p) => acc + parseMonetario(p.valor), 0);
  }, [vendaPagamentos]);

  const isPaymentValid = useMemo(() => {
    const hasDinheiro = vendaPagamentos.some((p) => p.tipoPagamento === 'dinheiro' && parseMonetario(p.valor) > 0);
    if (hasDinheiro && paymentTotal >= vendaValores.total) {
      return true; // Dinheiro permite troco
    }
    return Math.abs(paymentTotal - vendaValores.total) < 0.05;
  }, [paymentTotal, vendaValores.total, vendaPagamentos]);

  const troco = useMemo(() => {
    if (paymentTotal > vendaValores.total) {
      return paymentTotal - vendaValores.total;
    }
    return 0;
  }, [paymentTotal, vendaValores.total]);

  // Auto-sincronizar valor da Venda Direta com a forma de pagamento padrão
  useEffect(() => {
    if (isDirectSale && !isEditingSale) {
      const defaultKey = pdvConfig?.forma_pagamento_padrao || 'dinheiro';
      setVendaPagamentos((prev) =>
        prev.map((p) =>
          p.tipoPagamento === defaultKey
            ? { ...p, valor: directSaleValue }
            : p
        )
      );
    }
  }, [isDirectSale, isEditingSale, directSaleValue, pdvConfig?.forma_pagamento_padrao]);

  // Foco automático ao abrir o drawer
  useEffect(() => {
    if (showVendaForm) {
      setTimeout(() => {
        if (isDirectSale) {
          const valInput = document.getElementById('direct-sale-value-input');
          if (valInput) {
            (valInput as HTMLInputElement).focus();
            (valInput as HTMLInputElement).select();
          }
        } else {
          const customerSelect = document.getElementById('customer-search-select-trigger');
          if (customerSelect) {
            (customerSelect as HTMLInputElement).focus();
          }
        }
      }, 150);
    }
  }, [showVendaForm, isDirectSale]);

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
        codigo_barras: produtoCodigoBarras.trim() || null,
        imagem_url: produtoImagemUrl.trim() || null,
        preco_custo_medio: produtoPrecoCustoMedio ? parseMonetario(produtoPrecoCustoMedio) : 0.0,
        ncm: produtoNcm.trim() || null,
        cest: produtoCest.trim() || null,
        cfop_padrao: produtoCfopPadrao.trim() || null,
        revisao_pendente: false,
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
      setProdutoCodigoBarras('');
      setProdutoImagemUrl('');
      setProdutoPrecoCustoMedio('');
      setProdutoNcm('');
      setProdutoCest('');
      setProdutoCfopPadrao('');
      setProdutoRevisaoPendente(false);
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

  // Mesclar/Vincular Produto
  async function handleMesclarProdutos() {
    if (!editingProduto || !selectedExistenteId) return;
    try {
      setMerging(true);
      await api.post(`/pdv/produtos/${editingProduto.id}/mesclar/${selectedExistenteId}`);
      setShowVincularModal(false);
      setShowProdutoForm(false);
      setEditingProduto(null);
      setSelectedExistenteId('');
      alert('Produtos mesclados com sucesso!');
      await loadProdutos();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao mesclar produtos.');
    } finally {
      setMerging(false);
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
    
    // Ler preferência modo venda
    const modoPadrao = pdvConfig?.modo_venda_padrao === 'direta';
    setIsDirectSale(modoPadrao);
    setDirectSaleValue('');
    setDirectSaleDiscount('');
    setDirectSaleDescription('');
    
    // Inicializar pagamentos estáticos
    setVendaPagamentos(initStaticPayments());
    
    setComprovanteFiles([]);
    setExistingComprovantes([]);
    setCamposExtrasForm({});
    setSelectedVendedorId(currentUserId);
    setErrorVenda(null);
    setIsEditingSale(false);
    setEditingSaleUuid(null);
    const pdvCcId = pdvConfig?.pdv_centro_custo_padrao_id ?? pdvConfig?.centro_custo_padrao_id;
    if (pdvCcId) {
      setSelectedCentroCustoId(pdvCcId);
    } else if (centrosCusto.length === 1) {
      setSelectedCentroCustoId(centrosCusto[0].id);
    } else {
      setSelectedCentroCustoId(null);
    }
    
    // Checar rascunho
    const draft = localStorage.getItem('kyrus_pdv_venda_draft');
    setHasDraft(!!draft);
    
    setShowVendaForm(true);
  }

  // Open Editar Venda
  function openEditarVenda(venda: PdvVendaItem) {
    setErrorVenda(null);
    setIsEditingSale(true);
    setEditingSaleUuid(venda.venda_id_uuid ?? null);
    setSelectedVendedorId(venda.vendedor_id ?? currentUserId);
    setSelectedEntidadeId(venda.entidade_id ?? null);
    setSelectedCentroCustoId(venda.centro_custo_id ?? pdvConfig?.pdv_centro_custo_padrao_id ?? pdvConfig?.centro_custo_padrao_id ?? (centrosCusto.length === 1 ? centrosCusto[0].id : null));
    setVendaRv(venda.rv ?? '');
    setVendaDataPagamento(venda.data ?? '');
    setVendaObservacao(venda.observacao_texto ?? '');
    setVendaStatus(venda.status ?? 'REALIZADO');
    
    // Detectar Venda Direta
    const firstItem = venda.itens_detalhe?.[0];
    const isDirect = (venda as any).is_direct_sale || (venda.itens_detalhe?.length === 1 && (Number(firstItem?.produto_id) <= 0 || firstItem?.produto_nome === 'Venda Geral'));
    setIsDirectSale(!!isDirect);
    if (isDirect && firstItem) {
      setDirectSaleValue(formatMonetario((firstItem.preco_unitario || 0) * (firstItem.quantidade || 1)));
      setDirectSaleDiscount(formatMonetario(firstItem.desconto || 0));
      setDirectSaleDescription(firstItem.nome || firstItem.nome_customizado || firstItem.produto_nome || 'Venda Geral');
    } else {
      setDirectSaleValue('');
      setDirectSaleDiscount('');
      setDirectSaleDescription('');
    }
    
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
    
    // Map static payments with existing payments values
    setVendaPagamentos(initStaticPayments(venda.pagamentos_detalhe || undefined));
    
    setComprovanteFiles([]);
    const urls = (venda as any).comprovante_urls || (venda.comprovante_url ? [venda.comprovante_url] : []);
    setExistingComprovantes(urls);
    setCamposExtrasForm(venda.campos_extras || {});
    setHasDraft(false);
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

  function handleAddPaymentLine() {
    const todayStr = new Date().toISOString().split('T')[0];
    const defaultKey = pdvConfig?.forma_pagamento_padrao || 'dinheiro';
    setVendaPagamentos((prev) => [
      ...prev,
      { tipoPagamento: defaultKey, valor: '', numeroParcelas: 1, valorParcela: '', dataPagamento: todayStr, bandeira: 'OUTROS' }
    ]);
  }

  function handleRemovePaymentLine(index: number) {
    setVendaPagamentos((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      const compressed = await Promise.all(filesArray.map(f => compressImageToWebp(f)));
      setComprovanteFiles((prev) => [...prev, ...compressed]);
    }
  };

  const handleComprovanteChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      const compressed = await Promise.all(filesArray.map(f => compressImageToWebp(f)));
      setComprovanteFiles((prev) => [...prev, ...compressed]);
    }
  };

  const removeSelectedFile = (index: number) => {
    setComprovanteFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit Nova Venda
  async function handleNovaVendaSubmit(e: FormEvent) {
    e.preventDefault();
    
    let validItens = [];
    if (isDirectSale) {
      if (!directSaleDescription.trim()) {
        setErrorVenda('A descrição dos itens vendidos é obrigatória.');
        return;
      }
      if (!directSaleValue || parseMonetario(directSaleValue) <= 0) {
        setErrorVenda('O valor da venda direta deve ser maior que zero.');
        return;
      }
      validItens = [{
        produtoId: '0',
        quantidade: 1,
        precoUnitario: directSaleValue,
        desconto: directSaleDiscount || '0'
      }];
    } else {
      validItens = vendaItens.filter((i) => i.produtoId !== '');
      if (validItens.length === 0) {
        setErrorVenda('Adicione pelo menos um produto válido.');
        return;
      }
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

    // Validar campos personalizados (offline-first)
    let pdvConfig: any = {};
    if (empresa && empresa.pdv_config) {
      try {
        pdvConfig = JSON.parse(empresa.pdv_config);
      } catch (e) {}
    }
    const camposConfig = pdvConfig.campos_personalizados || [];
    for (const campo of camposConfig) {
      // Verificar dependência
      if (campo.depends_on) {
        const depVal = camposExtrasForm[campo.depends_on.field];
        if (depVal !== campo.depends_on.value) {
          continue;
        }
      }
      const val = camposExtrasForm[campo.id];
      if (campo.required) {
        if (val === undefined || val === null || String(val).trim() === '') {
          setErrorVenda(`O campo personalizado "${campo.label}" é obrigatório.`);
          return;
        }
      }
      if (campo.regex && val !== undefined && val !== null && String(val).trim() !== '') {
        try {
          const r = new RegExp(campo.regex);
          if (!r.test(String(val))) {
            setErrorVenda(`O campo personalizado "${campo.label}" está com formato inválido.`);
            return;
          }
        } catch (e) {}
      }
    }

    try {
      setSavingVenda(true);
      setErrorVenda(null);

      // Se NÃO for edição, salvamos Offline-First na fila local!
      if (!isEditingSale) {
        const selectedCliente = entidadesLookup.find((c) => String(c.id) === String(selectedEntidadeId));
        const selectedVendedor = vendedores.find((v) => String(v.id) === String(selectedVendedorId));
        const selectedCentro = centrosCusto.find((cc) => String(cc.id) === String(selectedCentroCustoId));

        const itemNomesList = validItens.map((i) => {
          if (isDirectSale) {
            return `${directSaleDescription.trim() || 'Venda Direta'} x${i.quantidade}`;
          }
          const prod = produtos.find((p) => String(p.id) === String(i.produtoId));
          return `${prod?.nome || 'Item'} x${i.quantidade}`;
        }).join(', ');

        const comprovanteFilesBase64: { name: string; type: string; data: string }[] = [];
        for (const file of comprovanteFiles) {
          const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
              const resStr = reader.result as string;
              resolve(resStr.split(',')[1]);
            };
            reader.onerror = reject;
          });
          comprovanteFilesBase64.push({
            name: file.name,
            type: file.type,
            data: base64Data,
          });
        }

        const salePayload = {
          entidade_id: selectedEntidadeId,
          centro_custo_id: selectedCentroCustoId,
          vendedor_id: selectedVendedorId,
          desconto: vendaValores.totalDesconto,
          status: vendaStatus,
          is_direct_sale: isDirectSale,
          itens: validItens.map((i) => {
            const prod = produtos.find((p) => String(p.id) === String(i.produtoId));
            const isService = prod?.tipo === 'SERVICO';
            const isGeneric = parseInt(i.produtoId) <= 0;
            return {
              produto_id: parseInt(i.produtoId),
              quantidade: i.quantidade,
              desconto: parseMonetario(i.desconto),
              preco_unitario: (isService || isGeneric || i.precoUnitario) ? parseMonetario(i.precoUnitario || 0) : null,
              nome_customizado: isDirectSale ? (directSaleDescription.trim() || 'Venda Direta') : null,
            };
          }),
          pagamentos: vendaPagamentos.filter((p) => p.valor && parseMonetario(p.valor) > 0).map((p) => ({
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
          comprovante_urls: existingComprovantes,
          comprovanteFiles: comprovanteFilesBase64,
          campos_extras: camposExtrasForm,

          clienteNome: selectedCliente?.nome || 'Consumidor Final',
          vendedorNome: selectedVendedor?.nome || currentUserName || 'Vendedor',
          centroCustoNome: selectedCentro?.nome || 'Geral',
          itensNomes: itemNomesList
        };

        addSale(salePayload);

        localStorage.removeItem('kyrus_pdv_venda_draft');
        setHasDraft(false);
        setShowVendaForm(false);
        setComprovanteFiles([]);
        setExistingComprovantes([]);
        setIsEditingSale(false);
        setEditingSaleUuid(null);

        // Se online, aguarda brevemente a sincronização inicial e recarrega
        if (isOnline) {
          setTimeout(() => {
            void loadVendas();
          }, 800);
        }
        return;
      }

      // Fluxo padrão para edição
      const body = {
        entidade_id: selectedEntidadeId,
        centro_custo_id: selectedCentroCustoId,
        vendedor_id: selectedVendedorId,
        desconto: vendaValores.totalDesconto,
        status: vendaStatus,
        itens: validItens.map((i) => {
          const prod = produtos.find((p) => String(p.id) === String(i.produtoId));
          const isService = prod?.tipo === 'SERVICO';
          const isGeneric = parseInt(i.produtoId) <= 0;
          return {
            produto_id: parseInt(i.produtoId),
            quantidade: i.quantidade,
            desconto: parseMonetario(i.desconto),
            preco_unitario: (isService || isGeneric || i.precoUnitario) ? parseMonetario(i.precoUnitario || '0') : null,
          };
        }),
        pagamentos: vendaPagamentos.filter((p) => p.valor && parseMonetario(p.valor) > 0).map((p) => ({
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
        comprovante_urls: existingComprovantes,
        campos_extras: camposExtrasForm
      };

      await api.put(`/pdv/vendas/${editingSaleUuid}`, body);
      const targetUuid = editingSaleUuid;

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

      localStorage.removeItem('kyrus_pdv_venda_draft');
      setHasDraft(false);
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
              <Link
                to="/pdv/importar"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-250 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-white transition cursor-pointer"
              >
                <Download className="h-4 w-4 text-emerald-500" />
                Importar Vendas
              </Link>
              <button
                type="button"
                onClick={openNovaVenda}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Venda
              </button>
            </div>
          </div>
        </section>

            {/* Visual Queue for Pending Sales */}
            {pendingSales.length > 0 && (
              <div className="rounded-3xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20 backdrop-blur-sm shadow-sm space-y-3 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UploadCloud className="h-5 w-5 text-amber-600 dark:text-amber-400 animate-pulse" />
                    <h3 className="font-bold text-sm text-amber-900 dark:text-amber-200">
                      Vendas em fila de sincronização ({pendingSales.length})
                    </h3>
                  </div>
                  {!isOnline && (
                    <span className="text-[10px] bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Offline
                    </span>
                  )}
                  {isOnline && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-450 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Online - Sincronizando
                    </span>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {pendingSales.map((sale) => (
                    <div key={sale.idempotency_key} className="bg-white/70 dark:bg-slate-900/60 rounded-2xl p-3 border border-amber-100 dark:border-amber-950/50 flex flex-col justify-between gap-3 shadow-sm transition hover:scale-[1.01]">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-xs text-slate-800 dark:text-white truncate">
                            {sale.clienteNome || 'Consumidor Final'}
                          </span>
                          <span className="text-xs font-black text-slate-900 dark:text-white shrink-0">
                            {currency.format(sale.pagamentos.reduce((acc, p) => acc + p.valor, 0))}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                          {sale.itensNomes}
                        </p>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                        <span>
                          {sale.dataHoraLocal 
                            ? new Date(sale.dataHoraLocal).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
                            : '--:--'}
                        </span>
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold">
                          <RotateCcw className="w-2.5 h-2.5 animate-spin" />
                          Salvando
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                                <div className="flex items-center justify-center gap-1.5">
                                  {venda.status === 'ORCAMENTO' && venda.venda_id_uuid && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdateSaleStatus(venda.venda_id_uuid!, 'REALIZADO');
                                      }}
                                      className="flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold transition duration-200 shadow-sm border border-emerald-250/20 cursor-pointer"
                                      title="Efetivar venda"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>Efetivar</span>
                                    </button>
                                  )}
                                  
                                  {venda.status === 'REALIZADO' && venda.venda_id_uuid && (
                                    <>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          imprimirCupom(venda);
                                        }}
                                        className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold transition duration-200 shadow-sm cursor-pointer"
                                        title="Imprimir Cupom"
                                      >
                                        <Printer className="w-3.5 h-3.5" />
                                        <span>Cupom</span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleUpdateSaleStatus(venda.venda_id_uuid!, 'CANCELADO');
                                        }}
                                        className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-450 rounded-lg text-xs font-bold transition duration-200 shadow-sm cursor-pointer"
                                        title="Cancelar venda"
                                      >
                                        <Ban className="w-3.5 h-3.5" />
                                        <span>Cancelar</span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleUpdateSaleStatus(venda.venda_id_uuid!, 'DEVOLVIDO');
                                        }}
                                        className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-650 dark:text-slate-300 rounded-lg text-xs font-bold transition duration-200 shadow-sm cursor-pointer"
                                        title="Registrar devolução"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        <span>Devolver</span>
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
                {data?.has_more && (
                  <div className="flex justify-center mt-6">
                    <button
                      type="button"
                      onClick={() => setLimit((prev) => prev + 150)}
                      className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:bg-slate-900 transition font-bold text-sm cursor-pointer shadow-sm"
                    >
                      Carregar Mais Vendas
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <h3 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Nenhuma venda de PDV encontrada</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Esta tela agora só mostra vendas explicitamente marcadas como PDV. Se você ainda não vendeu, ela fica vazia de propósito.
                </p>
              </div>
            )}



      </div>

      {/* Modal de Produto */}
      {showProdutoForm && (
        <>
          <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowProdutoForm(false)} />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between items-center p-6 pb-4 border-b border-slate-150 dark:border-slate-800/80 shrink-0">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {editingProduto ? (produtoTipo === 'SERVICO' ? 'Editar Serviço' : 'Editar Produto') : (produtoTipo === 'SERVICO' ? 'Novo Serviço' : 'Novo Produto')}
                </h3>
                <button onClick={() => setShowProdutoForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleProdutoSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                {produtoRevisaoPendente && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-250 dark:border-amber-900/40 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <span className="font-bold">Item Pendente de Revisão:</span> Salvar este formulário irá aprovar e validar as informações do produto, removendo a pendência de revisão.
                    </div>
                  </div>
                )}
                {/* Seção: Informações Básicas */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" />
                    Informações Básicas
                  </h4>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Tipo de Item</label>
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950 p-1.5 rounded-xl border border-slate-250 dark:border-slate-800">
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
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Nome do {produtoTipo === 'SERVICO' ? 'Serviço' : 'Produto'}</label>
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
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Valor Individual (R$)</label>
                    <input
                      type="text"
                      required
                      value={produtoPreco}
                      onChange={(e) => setProdutoPreco(formatMonetario(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="0,00"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Imagem (opcional)</label>
                    <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                      {produtoImagemUrl ? (
                        <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-250 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 flex items-center justify-center shadow-sm">
                          <img src={toPublicAssetUrl(produtoImagemUrl) ?? undefined} alt="Preview do Produto" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setProdutoImagemUrl('')}
                            className="absolute top-0.5 right-0.5 p-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded-full transition shadow cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingImage}
                          className="w-16 h-16 border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-lg flex flex-col items-center justify-center text-slate-400 dark:border-slate-800 dark:text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-900/40 shrink-0 cursor-pointer"
                        >
                          {uploadingImage ? (
                            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mb-0.5" />
                              <span className="text-[8px] font-bold uppercase tracking-wider">Imagem</span>
                            </>
                          )}
                        </button>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            setUploadingImage(true);
                            const formData = new FormData();
                            formData.append('file', file);
                            const res = await api.post<{ url: string }>('/anexos/upload', formData, {
                              headers: { 'Content-Type': 'multipart/form-data' },
                            });
                            setProdutoImagemUrl(res.data.url);
                          } catch (err: any) {
                            alert(err?.response?.data?.detail || 'Erro ao enviar imagem.');
                          } finally {
                            setUploadingImage(false);
                          }
                        }}
                        className="hidden"
                      />
                      <div className="text-[10px] text-slate-400 leading-normal">
                        Formatos aceitos: JPG, PNG, WEBP ou GIF. Limite máximo: 2MB.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-b border-slate-150 dark:border-slate-800/80" />

                {/* Seção: Códigos de Identificação */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5" />
                    Identificação e Código de Barras
                  </h4>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Código de Barras / EAN</label>
                    <input
                      type="text"
                      value={produtoCodigoBarras}
                      onChange={(e) => setProdutoCodigoBarras(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white font-mono"
                      placeholder="Ex: 7891234567890"
                    />
                    <p className="mt-1.5 text-[10px] text-slate-400 leading-normal">
                      Código de fábrica para leitura óptica automática.
                    </p>

                    {/* QR Code preview if code exists */}
                    {produtoCodigoBarras && (
                      <div className="mt-3 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(produtoCodigoBarras)}`}
                          alt="Preview QR Code"
                          className="w-12 h-12 object-contain"
                        />
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Código de Barras Ativo</span>
                          <span className="font-mono text-xs text-slate-800 dark:text-slate-200 font-bold">{produtoCodigoBarras}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-b border-slate-150 dark:border-slate-800/80" />

                {/* Seção: Parâmetros Fiscais */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <Percent className="w-3.5 h-3.5" />
                    Parâmetros Fiscais
                  </h4>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">NCM (Nomenclatura Comum do Mercosul)</label>
                    <input
                      type="text"
                      value={produtoNcm}
                      onChange={(e) => setProdutoNcm(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="Ex: 2202.10.00"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">CEST (Cód. Especificador da Subst. Tributária)</label>
                    <input
                      type="text"
                      value={produtoCest}
                      onChange={(e) => setProdutoCest(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="Ex: 03.010.00"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">CFOP Padrão de Venda</label>
                    <input
                      type="text"
                      value={produtoCfopPadrao}
                      onChange={(e) => setProdutoCfopPadrao(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="Ex: 5102"
                    />
                  </div>
                </div>

                <div className="border-b border-slate-150 dark:border-slate-800/80" />

                {/* Seção: Custos e Margens */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    Custos e Estoque
                  </h4>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Preço de Custo Médio (R$)</label>
                    <input
                      type="text"
                      value={produtoPrecoCustoMedio}
                      onChange={(e) => setProdutoPrecoCustoMedio(formatMonetario(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="0,00"
                    />
                    <p className="mt-2 text-[10px] text-blue-700 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/20 p-2.5 rounded-xl border border-blue-100 dark:border-blue-900/30 leading-normal flex items-start gap-1.5">
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Atualizado automaticamente ao importar XML de NF-e de compra.</span>
                    </p>
                  </div>

                  {editingProduto && editingProduto.tipo === 'PRODUTO' && (
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Saldo Atual em Estoque</label>
                      <div className="w-full rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2">
                        <Package className="w-4 h-4 text-blue-500" />
                        {editingProduto.quantidade_estoque ?? 0} unidades
                      </div>
                    </div>
                  )}
                </div>
              </form>

              <div className="flex justify-end gap-3 p-6 pt-4 border-t border-slate-150 dark:border-slate-800/80 shrink-0">
                {produtoRevisaoPendente && (
                  <button
                    type="button"
                    onClick={() => setShowVincularModal(true)}
                    className="mr-auto px-4 py-2 rounded-xl text-sm font-bold text-amber-650 border border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-900/50 dark:hover:bg-amber-950/20 transition cursor-pointer"
                  >
                    Vincular a Existente (De/Para)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowProdutoForm(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingProduto || uploadingImage}
                  onClick={() => {
                    const form = document.querySelector('form') as HTMLFormElement;
                    if (form) {
                      form.requestSubmit();
                    }
                  }}
                  className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition disabled:opacity-50 cursor-pointer"
                >
                  {savingProduto ? 'Salvando...' : (produtoRevisaoPendente ? 'Salvar e Tirar da Revisão' : 'Salvar')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}


      {/* Drawer da Nova Venda (PDV Completo) */}
      {showVendaForm && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowVendaForm(false)} />
          <div className="fixed inset-y-0 right-0 w-full md:max-w-[75vw] bg-white dark:bg-slate-900 shadow-2xl z-50 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 translate-x-0">
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

                {(!pdvConfig || (pdvConfig.pdv_centro_custo_flexivel ?? pdvConfig.centro_custo_flexivel) !== false || !(pdvConfig.pdv_centro_custo_padrao_id ?? pdvConfig.centro_custo_padrao_id)) && centrosCusto.length > 1 && (
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

              {/* Campos Personalizados Dinâmicos */}
              {customFields.length > 0 && (
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Campos Personalizados</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {customFields.map((campo: any) => {
                      if (campo.depends_on) {
                        const depVal = camposExtrasForm[campo.depends_on.field];
                        if (depVal !== campo.depends_on.value) {
                          return null;
                        }
                      }

                      const value = camposExtrasForm[campo.id] ?? '';
                      const handleChange = (val: any) => {
                        setCamposExtrasForm((prev) => ({ ...prev, [campo.id]: val }));
                      };

                      return (
                        <div key={campo.id} className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 dark:text-slate-350 flex items-center gap-1">
                            {campo.label}
                            {campo.required && <span className="text-rose-500">*</span>}
                          </label>

                          {campo.type === 'text' && (
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => handleChange(e.target.value)}
                              placeholder={campo.placeholder || ''}
                              className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                            />
                          )}

                          {campo.type === 'select' && (
                            <select
                              value={value}
                              onChange={(e) => handleChange(e.target.value)}
                              className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="">Selecione...</option>
                              {(campo.options || []).map((opt: string) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          )}

                          {campo.type === 'boolean' && (
                            <div className="flex items-center gap-2 h-[38px]">
                              <input
                                type="checkbox"
                                checked={!!value}
                                onChange={(e) => handleChange(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-slate-650 dark:text-slate-350">Sim / Ativo</span>
                            </div>
                          )}

                          {campo.type === 'number' && (
                            <input
                              type="number"
                              value={value}
                              onChange={(e) => handleChange(e.target.value === '' ? '' : Number(e.target.value))}
                              placeholder={campo.placeholder || '0'}
                              className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                            />
                          )}

                          {campo.type === 'currency' && (
                            <input
                              type="text"
                              value={formatMonetario(value)}
                              onChange={(e) => handleChange(parseMonetario(e.target.value))}
                              placeholder="0,00"
                              className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isDirectSale ? (
                /* Bloco Venda Direta */
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 animate-in fade-in">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Venda Direta (Consolidada)</span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Descrição dos Itens Vendidos *</label>
                      <input
                        type="text"
                        value={directSaleDescription}
                        onChange={(e) => setDirectSaleDescription(e.target.value)}
                        placeholder="Ex: Coca-cola 2L, 3 Salgados, etc."
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                        required
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Valor Total da Venda (R$) *</label>
                      <input
                        type="text"
                        id="direct-sale-value-input"
                        value={directSaleValue}
                        onChange={(e) => setDirectSaleValue(formatMonetario(e.target.value))}
                        placeholder="0,00"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-bold"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Desconto Concedido (R$)</label>
                      <input
                        type="text"
                        value={directSaleDiscount}
                        onChange={(e) => setDirectSaleDiscount(formatMonetario(e.target.value))}
                        placeholder="0,00"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* Grade de Seleção de Produtos */
                <div className="space-y-3 animate-in fade-in">
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
                                onCreateClick={() => {
                                  setEditingProduto(null);
                                  setProdutoNome('');
                                  setProdutoPreco('');
                                  setProdutoTipo('PRODUTO');
                                  setProdutoCodigoBarras('');
                                  setProdutoImagemUrl('');
                                  setProdutoPrecoCustoMedio('');
                                  setProdutoNcm('');
                                  setProdutoCest('');
                                  setProdutoCfopPadrao('');
                                  setProdutoRevisaoPendente(false);
                                  setShowProdutoForm(true);
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

                            <button
                              type="button"
                              onClick={() => {
                                const rest = vendaItens.filter((_, idx) => idx !== index);
                                if (rest.length === 0) {
                                  setIsDirectSale(true);
                                  setVendaItens([{ produtoId: '', quantidade: 1, desconto: '', precoUnitario: '' }]);
                                } else {
                                  setVendaItens(rest);
                                }
                              }}
                              className="absolute top-2 right-2 sm:static sm:mt-5 text-slate-400 hover:text-rose-500 cursor-pointer"
                              title="Remover item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}

                      <div className="pt-2 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => setVendaItens([...vendaItens, { produtoId: '', quantidade: 1, desconto: '0', precoUnitario: '' }])}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-500 hover:text-blue-600 transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Adicionar Item
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowScannerModal(true)}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-600 transition cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          Escanear com Câmera
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                  <div className="flex items-center gap-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Formas de Pagamento</label>
                    <button
                      type="button"
                      onClick={() => setVendaPagamentos((prev) => prev.map(p => ({ ...p, valor: '', valorParcela: '' })))}
                      className="text-[10px] text-slate-400 hover:text-slate-650 dark:hover:text-white font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded transition cursor-pointer"
                      title="Zerar divisões de valores de pagamentos"
                    >
                      Limpar
                    </button>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className={`text-xs font-black ${isPaymentValid || troco > 0 ? 'text-emerald-600 dark:text-emerald-450' : 'text-rose-600 dark:text-rose-450'}`}>
                      Preenchido: {currency.format(paymentTotal)} / Esperado: {currency.format(vendaValores.total)}
                    </span>
                    {troco > 0 && (
                      <span className="text-[10px] font-bold text-blue-600 dark:text-blue-450 mt-0.5 animate-in slide-in-from-right-1">
                        Troco a Devolver: {currency.format(troco)}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  {vendaPagamentos.map((pag, index) => {
                    const methodObj = paymentMethods.find((m: any) => m.key === pag.tipoPagamento);
                    const isInstallments = methodObj ? methodObj.parcelada : (pag.tipoPagamento && (pag.tipoPagamento === 'cartao_credito_parcelado' || pag.tipoPagamento === 'boleto'));
                    const isCardPayment = pag.tipoPagamento && (pag.tipoPagamento.startsWith('cartao_') || pag.tipoPagamento.includes('cartao'));
                    
                    return (
                      <div key={index} className="flex flex-col bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm relative gap-3 animate-in fade-in">
                        <div className="flex items-center justify-between font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          <select
                            value={pag.tipoPagamento}
                            onChange={(e) => handlePaymentChange(index, 'tipoPagamento', e.target.value)}
                            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1 text-xs font-bold text-slate-850 dark:text-white outline-none cursor-pointer hover:border-slate-400 transition"
                          >
                            {paymentMethods.filter((m: any) => m.ativa !== false).map((m: any) => (
                              <option key={m.key} value={m.key}>{m.label}</option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => handleRemovePaymentLine(index)}
                            className="text-rose-500 hover:text-rose-650 hover:bg-rose-50 dark:hover:bg-rose-950/20 p-1.5 rounded transition cursor-pointer"
                            title="Remover esta forma de pagamento"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2 sm:col-span-1">
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

                          <div className="col-span-2 sm:col-span-1">
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
                              <div className="col-span-1">
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

                              <div className="col-span-1 text-right flex flex-col justify-end pb-2">
                                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor Parcela</span>
                                <span className="text-xs font-bold text-slate-500 block">
                                  {currency.format(parseMonetario(pag.valorParcela) || 0)}
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Card brand selector if payment method is card */}
                        {isCardPayment && (
                          <div className="w-full border-t border-slate-100 dark:border-slate-800/80 pt-3 mt-1 space-y-2 animate-in slide-in-from-top-1 duration-200">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bandeira do Cartão</label>
                            <div className="flex flex-wrap gap-2">
                              {['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'OUTROS'].map((brand) => {
                                const isSelected = (pag.bandeira || 'OUTROS') === brand;
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
                                    <BrandAvatar visual={brandObj} size="sm" className="w-8 h-5 shrink-0 rounded-lg text-[8px] border-none shadow-none" />
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
                </div>

                <div className="flex justify-start pt-1">
                  <button
                    type="button"
                    onClick={handleAddPaymentLine}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-xl transition cursor-pointer shadow-sm border border-slate-250 dark:border-slate-700"
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
      {/* Modal de Vinculação Retroativa (De/Para) */}
      {showVincularModal && (
        <>
          <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowVincularModal(false)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Package className="w-5 h-5 text-amber-500" />
                  Vincular a Produto Existente
                </h3>
                <button onClick={() => setShowVincularModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="text-sm text-slate-600 dark:text-slate-350 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 leading-normal">
                  Esta ação irá transferir todo o estoque e movimentações de <strong>"{produtoNome}"</strong> para o produto selecionado abaixo, e recalculará o preço de custo médio dele. O produto temporário será arquivado.
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Selecionar Produto Oficial</label>
                  <SearchableProductSelect
                    products={produtos.filter(p => !p.revisao_pendente && p.is_active !== false && p.id !== editingProduto?.id)}
                    selectedValue={selectedExistenteId}
                    onChange={(val) => setSelectedExistenteId(val)}
                    placeholder="Busque o produto no catálogo..."
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowVincularModal(false);
                      setSelectedExistenteId('');
                    }}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={merging || !selectedExistenteId}
                    onClick={handleMesclarProdutos}
                    className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition disabled:opacity-50"
                  >
                    {merging ? 'Vinculando...' : 'Vincular e Mesclar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal de QR Code */}
      {showQrModal && qrModalProduct && (
        <>
          <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowQrModal(false)} />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center relative">
              <button onClick={() => setShowQrModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">QR Code do Produto</h3>
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-6">{qrModalProduct.nome}</p>
              
              <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 inline-block mb-6 shadow-inner">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrModalProduct.codigo_barras || `KYRUS-PROD-${qrModalProduct.id}`)}`}
                  alt="QR Code"
                  className="w-40 h-40 object-contain mx-auto"
                />
              </div>

              <div className="space-y-4">
                <div className="text-xs bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-slate-400 block uppercase tracking-wider mb-1 text-[9px]">Código de Barras</span>
                  <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{qrModalProduct.codigo_barras || `Sem EAN (ID: ${qrModalProduct.id})`}</span>
                </div>
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        printWindow.document.write(`
                          <html>
                            <head>
                              <title>Imprimir QR Code - ${qrModalProduct.nome}</title>
                              <style>
                                body {
                                  display: flex;
                                  flex-direction: column;
                                  align-items: center;
                                  justify-content: center;
                                  height: 100vh;
                                  margin: 0;
                                  font-family: sans-serif;
                                  text-align: center;
                                }
                                .card {
                                  border: 1px solid #ccc;
                                  padding: 20px;
                                  border-radius: 8px;
                                }
                                img {
                                  width: 200px;
                                  height: 200px;
                                }
                                h1 { font-size: 16px; margin: 10px 0 5px 0; }
                                p { font-size: 14px; font-weight: bold; margin: 0; }
                              </style>
                            </head>
                            <body onload="window.print(); window.close();">
                              <div class="card">
                                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrModalProduct.codigo_barras || `KYRUS-PROD-${qrModalProduct.id}`)}" />
                                <h1>${qrModalProduct.nome}</h1>
                                <p>${qrModalProduct.codigo_barras || `ID: ${qrModalProduct.id}`}</p>
                              </div>
                            </body>
                          </html>
                        `);
                        printWindow.document.close();
                      }
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition cursor-pointer"
                  >
                    Imprimir Código
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadQrCode(qrModalProduct)}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-center transition cursor-pointer"
                  >
                    Download PNG
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal de Simulação de Escaner de Código de Barras */}
      {showScannerModal && (
        <>
          <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowScannerModal(false)} />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 relative">
              <button onClick={() => setShowScannerModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">Simulador de Leitor (Câmera)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Para fins de simulação e teste, escolha um produto ativo ou insira seu código de barras para simular a leitura óptica.</p>

              {/* Viewfinder Animation */}
              <div className="relative w-full h-44 bg-slate-950 rounded-2xl overflow-hidden mb-6 flex flex-col items-center justify-center border border-slate-800 shadow-inner">
                {/* Camera preview mock overlay */}
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#22c55e_1px,transparent_1px)] [background-size:16px_16px]" />
                <div className="absolute w-full h-0.5 bg-green-500/80 animate-[bounce_3s_infinite] shadow-[0_0_8px_#22c55e]" />
                <div className="absolute border-2 border-slate-500/30 w-4/5 h-2/3 rounded-xl flex items-center justify-center pointer-events-none">
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-green-500 rounded-tl" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-green-500 rounded-tr" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-green-500 rounded-bl" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-green-500 rounded-br" />
                </div>
                <Camera className="w-8 h-8 text-slate-600 animate-pulse" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2 animate-pulse">Aguardando código...</span>
              </div>

              {/* Manual Input */}
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Digitar Código Manualmente</label>
                  <div className="flex gap-2">
                    <input
                      id="scanner-manual-input"
                      type="text"
                      placeholder="Ex: 7891234567890"
                      className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const inputVal = (e.target as HTMLInputElement).value.trim();
                          if (inputVal) {
                            handleScanBarcode(inputVal);
                            (e.target as HTMLInputElement).value = '';
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById('scanner-manual-input') as HTMLInputElement;
                        const val = input?.value.trim();
                        if (val) {
                          handleScanBarcode(val);
                          input.value = '';
                        }
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition cursor-pointer"
                    >
                      Bipar
                    </button>
                  </div>
                </div>

                {/* Simulated list of items in catalog */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Itens Disponíveis com Código ({produtos.filter(p => p.codigo_barras && p.is_active !== false).length})</label>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50/50 dark:bg-slate-950/20">
                    {produtos.filter(p => p.codigo_barras && p.is_active !== false).map((prod) => (
                      <div
                        key={prod.id}
                        onClick={() => {
                          if (prod.codigo_barras) {
                            handleScanBarcode(prod.codigo_barras);
                          }
                        }}
                        className="flex items-center justify-between text-xs p-2 rounded-lg bg-white hover:bg-blue-50/50 dark:bg-slate-900 dark:hover:bg-slate-850/50 border border-slate-150 dark:border-slate-800 cursor-pointer transition"
                      >
                        <span className="font-semibold truncate pr-2 text-slate-700 dark:text-slate-300">{prod.nome}</span>
                        <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 shrink-0 font-bold">{prod.codigo_barras}</span>
                      </div>
                    ))}
                    {produtos.filter(p => p.codigo_barras && p.is_active !== false).length === 0 && (
                      <div className="text-center p-3 text-slate-400 text-xs">Nenhum produto cadastrado com código de barras.</div>
                    )}
                  </div>
                </div>
              </div>
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