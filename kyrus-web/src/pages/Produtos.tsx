import { useEffect, useMemo, useState, useRef } from 'react';
import type { FormEvent } from 'react';
import { Edit2, Plus, Search, Trash2, Tag, Box, PackageOpen, AlertCircle, RefreshCw, X, Link, Check, FileDown, Eye, Upload, Loader2, Info, QrCode, Edit3, Percent, DollarSign, Package } from 'lucide-react';
import { toast } from 'sonner';
import { SearchableSelect } from '../components/SearchableSelect';
import { api, toPublicAssetUrl, normalizeListResponse } from '../services/api';
import { useAuthStore } from '../store/authStore';

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

// Helpers
function formatMonetario(val: any): string {
  if (val === undefined || val === null) return '';
  const clean = String(val).replace(/\D/g, '');
  if (!clean) return '';
  const num = parseInt(clean) / 100;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMonetario(val: string): number {
  if (!val) return 0;
  const clean = val.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}

export default function Produtos() {
  const currency = useMemo(() => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }), []);

  // State
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [errorProdutos, setErrorProdutos] = useState<string | null>(null);
  
  const [filtroProdutoTipo, setFiltroProdutoTipo] = useState<'TODOS' | 'PRODUTO' | 'SERVICO'>('TODOS');
  const [filtroRevisaoPendente, setFiltroRevisaoPendente] = useState<boolean>(false);
  const [filtroProdutoNome, setFiltroProdutoNome] = useState('');

  // Form Drawer State
  const [showProdutoForm, setShowProdutoForm] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [produtoNome, setProdutoNome] = useState('');
  const [produtoPreco, setProdutoPreco] = useState('');
  const [produtoTipo, setProdutoTipo] = useState<string>('PRODUTO');
  const [produtoCodigoBarras, setProdutoCodigoBarras] = useState('');
  const [produtoImagemUrl, setProdutoImagemUrl] = useState('');
  const [produtoPrecoCustoMedio, setProdutoPrecoCustoMedio] = useState('');
  const [produtoNcm, setProdutoNcm] = useState('');
  const [produtoCest, setProdutoCest] = useState('');
  const [produtoCfopPadrao, setProdutoCfopPadrao] = useState('');
  const [produtoRevisaoPendente, setProdutoRevisaoPendente] = useState<boolean>(false);
  const [savingProduto, setSavingProduto] = useState(false);

  // Vincular Modal State
  const [showVincularModal, setShowVincularModal] = useState(false);
  const [selectedExistenteId, setSelectedExistenteId] = useState<string>('');
  const [merging, setMerging] = useState(false);

  // QR Code Preview State
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrModalProduct, setQrModalProduct] = useState<Produto | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Load Catalog
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

  useEffect(() => {
    void loadProdutos();
  }, []);

  // Filter Catalog items
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

  // Submit form
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
      resetForm();
      await loadProdutos();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao salvar produto/serviço.');
    } finally {
      setSavingProduto(false);
    }
  }

  // Delete product
  async function handleDeleteProduto(id: number) {
    if (!confirm('Deseja realmente remover este produto?')) return;
    try {
      await api.delete(`/pdv/produtos/${id}`);
      await loadProdutos();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao remover produto.');
    }
  }

  // Merge / Link to existing product
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

  function resetForm() {
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
  }

  const handleDownloadQrCode = (prod: Produto) => {
    const link = document.createElement('a');
    link.href = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(prod.codigo_barras || `KYRUS-PROD-${prod.id}`)}`;
    link.download = `qrcode-${prod.nome.toLowerCase().replace(/\s+/g, '-')}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Top Title and Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-850 dark:text-white">Produtos e Estoque</h2>
          <p className="text-sm text-slate-500">Gerenciamento completo do catálogo de produtos, serviços e saldo de estoque.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setShowProdutoForm(true);
          }}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition shadow shadow-blue-500/25 duration-200 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Novo</span>
        </button>
      </div>

      {/* Main content grid */}
      <div className="space-y-4">
        {loadingProdutos ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
            <span>Carregando catálogo de produtos...</span>
          </div>
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
            {/* Filters and search */}
            <div className="flex flex-col md:flex-row gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm justify-between items-stretch md:items-center">
              <div className="flex flex-wrap gap-2">
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
                <button
                  type="button"
                  onClick={() => setFiltroRevisaoPendente(!filtroRevisaoPendente)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    filtroRevisaoPendente
                      ? 'bg-amber-500 text-white shadow-md'
                      : 'bg-amber-50/50 hover:bg-amber-100/60 text-amber-700 dark:bg-amber-950/20 dark:hover:bg-amber-900/30 dark:text-amber-400'
                  }`}
                >
                  <Info className="w-3.5 h-3.5" />
                  Pendentes de Revisão ({produtos.filter(p => p.revisao_pendente).length})
                </button>
              </div>
              <div className="relative w-full md:w-80">
                <input
                  id="produto-search-input"
                  type="text"
                  value={filtroProdutoNome}
                  onChange={(e) => setFiltroProdutoNome(e.target.value)}
                  placeholder="Pesquisar por nome ou código..."
                  className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>

            {/* List */}
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
                        <th className="w-48 px-5 py-3 text-center">Estoque</th>
                        <th className="w-36 px-5 py-3 text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filteredProdutos.map((prod) => (
                        <tr key={prod.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-5 py-4 align-middle text-sm font-semibold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-3">
                              {prod.imagem_url ? (
                                <img
                                  src={toPublicAssetUrl(prod.imagem_url) ?? undefined}
                                  alt={prod.nome}
                                  className="w-10 h-10 rounded-lg object-cover border border-slate-250 dark:border-slate-800 shrink-0 bg-white shadow-sm"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg border border-dashed border-slate-250 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-[9px] font-bold text-slate-400 dark:text-slate-550 shrink-0 shadow-inner">
                                  N/A
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="block truncate font-bold text-slate-900 dark:text-white">{prod.nome}</span>
                                  {prod.revisao_pendente && (
                                    <span className="inline-flex rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 shrink-0">
                                      Revisar
                                    </span>
                                  )}
                                </div>
                                {prod.codigo_barras && (
                                  <span className="block font-mono text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{prod.codigo_barras}</span>
                                )}
                              </div>
                            </div>
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
                          <td className="px-5 py-4 align-middle text-center text-sm font-medium text-slate-600 dark:text-slate-450">
                            {prod.tipo === 'SERVICO' ? (
                              <span className="text-slate-400">--</span>
                            ) : (
                              <span className={`font-bold ${
                                (prod.quantidade_estoque ?? 0) <= 0
                                  ? 'text-rose-500'
                                  : (prod.quantidade_estoque ?? 0) < 5
                                    ? 'text-amber-500'
                                    : 'text-slate-700 dark:text-slate-300'
                              }`}>
                                {prod.quantidade_estoque ?? 0} un
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 align-middle text-center">
                            <div className="flex justify-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setQrModalProduct(prod);
                                  setShowQrModal(true);
                                }}
                                className="text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 cursor-pointer"
                                title="Visualizar QR Code"
                              >
                                <QrCode className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProduto(prod);
                                  setProdutoNome(prod.nome);
                                  setProdutoPreco(formatMonetario(prod.preco_unitario));
                                  setProdutoTipo(prod.tipo || 'PRODUTO');
                                  setProdutoCodigoBarras(prod.codigo_barras || '');
                                  setProdutoImagemUrl(prod.imagem_url || '');
                                  setProdutoPrecoCustoMedio(prod.preco_custo_medio ? formatMonetario(prod.preco_custo_medio) : '');
                                  setProdutoNcm(prod.ncm || '');
                                  setProdutoCest(prod.cest || '');
                                  setProdutoCfopPadrao(prod.cfop_padrao || '');
                                  setProdutoRevisaoPendente(prod.revisao_pendente || false);
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
              Clique no botão "Cadastrar Novo" para registrar seus primeiros produtos ou serviços.
            </p>
          </div>
        )}
      </div>

      {/* Modal Cadastro/Edição */}
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
                            : 'text-slate-650 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
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
                            : 'text-slate-655 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
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
                      className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
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
                      className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      placeholder="0,00"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Imagem (opcional)</label>
                    <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                      {produtoImagemUrl ? (
                        <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-250 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 flex items-center justify-center shadow-sm">
                          <img src={toPublicAssetUrl(produtoImagemUrl) ?? undefined} alt="Preview" className="w-full h-full object-cover" />
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
                          className="w-16 h-16 border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-lg flex flex-col items-center justify-center text-slate-400 dark:border-slate-800 dark:text-slate-550 transition hover:bg-slate-100 dark:hover:bg-slate-900/40 shrink-0 cursor-pointer"
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

                {/* Seção: Identificação */}
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
                      className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                      placeholder="Ex: 7891234567890"
                    />

                    {produtoCodigoBarras && (
                      <div className="mt-3 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(produtoCodigoBarras)}`}
                          alt="Preview QR Code"
                          className="w-12 h-12 object-contain"
                        />
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Código de Barras Ativo</span>
                          <span className="font-mono text-xs text-slate-850 dark:text-slate-200 font-bold">{produtoCodigoBarras}</span>
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
                      className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      placeholder="Ex: 2202.10.00"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">CEST (Cód. Especificador da Subst. Tributária)</label>
                    <input
                      type="text"
                      value={produtoCest}
                      onChange={(e) => setProdutoCest(e.target.value)}
                      className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      placeholder="Ex: 03.010.00"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">CFOP Padrão de Venda</label>
                    <input
                      type="text"
                      value={produtoCfopPadrao}
                      onChange={(e) => setProdutoCfopPadrao(e.target.value)}
                      className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
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
                      className="w-full rounded-xl border border-slate-350 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      placeholder="0,00"
                    />
                  </div>

                  {editingProduto && editingProduto.tipo === 'PRODUTO' && (
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Saldo Atual em Estoque</label>
                      <div className="w-full rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-850 dark:bg-slate-900/50 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2">
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
                    className="mr-auto px-4 py-2 rounded-xl text-sm font-bold text-amber-600 border border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-900/50 dark:hover:bg-amber-955/20 transition cursor-pointer"
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
                  type="button"
                  disabled={savingProduto || uploadingImage}
                  onClick={() => {
                    const form = document.querySelector('form') as HTMLFormElement;
                    if (form) {
                      form.requestSubmit();
                    }
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition disabled:opacity-50 cursor-pointer"
                >
                  {savingProduto ? 'Salvando...' : (produtoRevisaoPendente ? 'Salvar e Tirar da Revisão' : 'Salvar')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal QR Code */}
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

      {/* Modal Vincular / Mesclar */}
      {showVincularModal && (
        <>
          <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowVincularModal(false)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between items-center pb-4 border-b border-slate-200 dark:border-slate-800 mb-4">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Vincular a Produto Existente</h3>
                <button onClick={() => setShowVincularModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Selecione um produto do catálogo existente para mesclar com este item temporário. Todo histórico fiscal e movimentações serão consolidados.
                </p>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-500 dark:text-slate-350">Selecione o Produto de Destino</label>
                  <SearchableSelect
                    value={selectedExistenteId}
                    onChange={(val) => setSelectedExistenteId(String(val))}
                    options={[{
                      label: 'Produto',
                      options: [
                        { id: '', label: '-- Selecione o Produto --' },
                        ...produtos.filter(p => !p.revisao_pendente && p.is_active !== false && p.id !== editingProduto?.id).map((p) => ({
                          id: p.id,
                          label: `${p.nome} (${p.tipo === 'SERVICO' ? 'Serviço' : 'Produto'} - ${currency.format(p.preco_unitario)})`
                        }))
                      ]
                    }]}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowVincularModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={merging || !selectedExistenteId}
                  onClick={handleMesclarProdutos}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition disabled:opacity-50 cursor-pointer"
                >
                  {merging ? 'Vinculando...' : 'Vincular e Mesclar'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
