import React from 'react';
import { X, Camera, Package, Download, UserPlus, Percent, Phone, Loader2 } from 'lucide-react';
import { SearchableProductSelect } from '../../../../components/SearchableProductSelect';

export function VendedorExternoModal(props: any) {
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
  
  return (
    <>
      {/* Modal de Cadastro Rápido de Vendedor Externo / Indicador */}
      {showModalNovoVendedorExterno && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                Cadastrar Vendedor Externo
              </h3>
              <button
                onClick={() => setShowModalNovoVendedorExterno(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Nome Completo / Parceiro *
                </label>
                <input
                  type="text"
                  value={nomeNovoVendedorExterno}
                  onChange={(e) => setNomeNovoVendedorExterno(e.target.value)}
                  placeholder="Ex: Carlos Indicador / Parceria Bragança"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-800 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Telefone / WhatsApp (Opcional)
                </label>
                <input
                  type="text"
                  value={telefoneNovoVendedorExterno}
                  onChange={(e) => setTelefoneNovoVendedorExterno(e.target.value)}
                  placeholder="Ex: (91) 98888-7777"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-800 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Comissão Padrão de Indicações (%) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={comissaoPctNovoVendedorExterno}
                  onChange={(e) => setComissaoPctNovoVendedorExterno(e.target.value)}
                  placeholder="Ex: 5.0"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-800 dark:text-white font-bold outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowModalNovoVendedorExterno(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingVendedorExterno}
                onClick={handleSaveNovoVendedorExterno}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 cursor-pointer shadow-md"
              >
                {savingVendedorExterno ? 'Salvando...' : 'Salvar Vendedor Externo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
