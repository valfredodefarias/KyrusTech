import React from 'react';
import { X, Camera, Package, Download } from 'lucide-react';
import { SearchableProductSelect } from '../../../../components/SearchableProductSelect';

export function ClienteFormModal(props: any) {
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
                    onClick={() => setClienteForm((prev: any) => ({ ...prev, tipo_pessoa: 'PF' }))}
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
                    onClick={() => setClienteForm((prev: any) => ({ ...prev, tipo_pessoa: 'PJ' }))}
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
                    onChange={(e) => setClienteForm((prev: any) => ({ ...prev, nome: e.target.value }))}
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
                    onChange={(e) => setClienteForm((prev: any) => ({ ...prev, cpf_cnpj: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder={clienteForm.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">E-mail</label>
                  <input
                    type="email"
                    value={clienteForm.email}
                    onChange={(e) => setClienteForm((prev: any) => ({ ...prev, email: e.target.value }))}
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
                      onChange={(e) => setClienteForm((prev: any) => ({ ...prev, telefone: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      placeholder="(00) 0000-0000"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">Celular</label>
                    <input
                      type="text"
                      value={clienteForm.celular}
                      onChange={(e) => setClienteForm((prev: any) => ({ ...prev, celular: e.target.value }))}
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
