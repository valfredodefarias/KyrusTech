import React, { useRef, useState } from 'react';
import { X, Camera, Package, Download, AlertCircle, Info, Loader2, Plus, QrCode, Percent, DollarSign } from 'lucide-react';
import { SearchableProductSelect } from '../../../../components/SearchableProductSelect';
import { api, toPublicAssetUrl } from '../../../../services/api';

const formatMonetario = (val: string | number): string => {
  if (!val && val !== 0) return '';
  const n = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;
  if (isNaN(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function ProdutoFormModal(props: any) {
  const {
    // Destructure all possible props here to satisfy the extracted JSX
    showProdutoForm, setShowProdutoForm, handleProdutoSubmit, editingProduto,
    produtoTipo, setProdutoTipo, produtoImagemUrl, setProdutoImagemUrl,
    produtoNome, setProdutoNome, produtoPreco, setProdutoPreco,
    produtoPrecoCustoMedio, setProdutoPrecoCustoMedio, produtoCodigoBarras, setProdutoCodigoBarras,
    produtoNcm, setProdutoNcm, produtoCest, setProdutoCest, produtoCfopPadrao, setProdutoCfopPadrao,
    produtoRevisaoPendente, setProdutoRevisaoPendente, savingProduto,
    showClienteModal, setShowClienteModal, handleClienteSubmit, clienteForm, setClienteForm, savingCliente,
    showVincularModal, setShowVincularModal, produtoNome: pNome, selectedExistenteId, setSelectedExistenteId, merging, handleMesclarProdutos,
    showQrModal, setShowQrModal, qrModalProduct, handleDownloadQrCode,
    showScannerModal, setShowScannerModal, handleScanBarcode,
    showModalNovoVendedorExterno, setShowModalNovoVendedorExterno, nomeNovoVendedorExterno, setNomeNovoVendedorExterno,
    telefoneNovoVendedorExterno, setTelefoneNovoVendedorExterno, comissaoPctNovoVendedorExterno, setComissaoPctNovoVendedorExterno,
    savingVendedorExterno, handleSaveNovoVendedorExterno,
    produtos
  } = props;
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  return (
    <>
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

              <form id="produtoForm" onSubmit={handleProdutoSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
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
                  form="produtoForm"
                  disabled={savingProduto}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-blue-500 hover:bg-blue-600 text-white transition disabled:opacity-50 cursor-pointer"
                >
                  {savingProduto ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
