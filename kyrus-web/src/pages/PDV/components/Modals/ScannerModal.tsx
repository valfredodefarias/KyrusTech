import React from 'react';
import { X, Camera, Package, Download } from 'lucide-react';
import { SearchableProductSelect } from '../../../../components/SearchableProductSelect';

export function ScannerModal(props: any) {
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
                  <label className="mb-1.5 block text-xs font-bold text-slate-400 uppercase tracking-wider">Itens Disponíveis com Código ({produtos.filter((p: any) => p.codigo_barras && p.is_active !== false).length})</label>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50/50 dark:bg-slate-950/20">
                    {produtos.filter((p: any) => p.codigo_barras && p.is_active !== false).map((prod: any) => (
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
                    {produtos.filter((p: any) => p.codigo_barras && p.is_active !== false).length === 0 && (
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
