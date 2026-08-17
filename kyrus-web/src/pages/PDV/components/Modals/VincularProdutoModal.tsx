import React from 'react';
import { X, Camera, Package, Download } from 'lucide-react';
import { SearchableProductSelect } from '../../../../components/SearchableProductSelect';

export function VincularProdutoModal(props: any) {
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
                    products={produtos.filter((p: any) => !p.revisao_pendente && p.is_active !== false && p.id !== editingProduto?.id)}
                    selectedValue={selectedExistenteId}
                    onChange={(val: any) => setSelectedExistenteId(val)}
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
    </>
  );
}
