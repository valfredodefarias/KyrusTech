import React from 'react';
import { X, Camera, Package, Download } from 'lucide-react';
import { SearchableProductSelect } from '../../../../components/SearchableProductSelect';

export function QrCodeModal(props: any) {
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
    </>
  );
}
