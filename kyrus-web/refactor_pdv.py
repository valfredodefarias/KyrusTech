import re

file_path = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/PDV_old.tsx"
out_path = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/PDV.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add imports for Hooks and Components
imports_to_add = """
import { useProdutos } from './PDV/hooks/useProdutos';
import { useVendasPDV } from './PDV/hooks/useVendasPDV';
import { useCarrinho } from './PDV/hooks/useCarrinho';
import { CartSidebar } from './PDV/components/CartSidebar';
import { ProdutoFormModal } from './PDV/components/Modals/ProdutoFormModal';
import { ClienteFormModal } from './PDV/components/Modals/ClienteFormModal';
import { VincularProdutoModal } from './PDV/components/Modals/VincularProdutoModal';
import { QrCodeModal } from './PDV/components/Modals/QrCodeModal';
import { ScannerModal } from './PDV/components/Modals/ScannerModal';
import { VendedorExternoModal } from './PDV/components/Modals/VendedorExternoModal';
"""

last_import_idx = content.rfind("import ")
end_of_last_import = content.find(";", last_import_idx) + 1
if end_of_last_import > 0:
    content = content[:end_of_last_import] + "\n" + imports_to_add + content[end_of_last_import:]

hook_calls = """
  const produtosHook = useProdutos();
  const vendasHook = useVendasPDV();
  const carrinhoHook = useCarrinho();
  
  const { produtos, setProdutos, loadingProdutos, setLoadingProdutos, errorProdutos, setErrorProdutos, filtroProdutoTipo, setFiltroProdutoTipo, filtroRevisaoPendente, setFiltroRevisaoPendente, filtroProdutoNome, setFiltroProdutoNome, showProdutoForm, setShowProdutoForm, editingProduto, setEditingProduto, produtoNome, setProdutoNome, produtoPreco, setProdutoPreco, produtoTipo, setProdutoTipo, produtoRevisaoPendente, setProdutoRevisaoPendente, savingProduto, setSavingProduto, produtoCodigoBarras, setProdutoCodigoBarras, produtoImagemUrl, setProdutoImagemUrl, produtoPrecoCustoMedio, setProdutoPrecoCustoMedio, produtoNcm, setProdutoNcm, produtoCest, setProdutoCest, produtoCfopPadrao, setProdutoCfopPadrao, uploadingImage, setUploadingImage, showVincularModal, setShowVincularModal, selectedExistenteId, setSelectedExistenteId, merging, setMerging, showQrModal, setShowQrModal, qrModalProduct, setQrModalProduct, showScannerModal, setShowScannerModal, loadProdutos, activeProdutos } = produtosHook;
  
  const { data, setData, loading, setLoading, error, setError, limit, setLimit, filtroRv, setFiltroRv, filtroCliente, setFiltroCliente, filtroStatus, setFiltroStatus, filtroVendedor, setFiltroVendedor, loadVendas } = vendasHook;
  
  const { showVendaForm, setShowVendaForm, isEditingSale, setIsEditingSale, saleLocked, setSaleLocked, errorVenda, setErrorVenda, vendaRv, setVendaRv, vendaStatus, setVendaStatus, vendaObservacao, setVendaObservacao, camposExtrasForm, setCamposExtrasForm, selectedEntidadeId, setSelectedEntidadeId, selectedCentroCustoId, setSelectedCentroCustoId, selectedVendedorId, setSelectedVendedorId, vendedores, setVendedores, centrosCusto, setCentrosCusto, vendaItens, setVendaItens, isDirectSale, setIsDirectSale, directSaleValue, setDirectSaleValue, directSaleDiscount, setDirectSaleDiscount, directSaleDescription, setDirectSaleDescription, vendaPagamentos, setVendaPagamentos, paymentTotal, setPaymentTotal, troco, setTroco, savingVenda, setSavingVenda, comprovanteFiles, setComprovanteFiles, existingComprovantes, setExistingComprovantes, isDragActive, setIsDragActive } = carrinhoHook;
"""

states_to_remove = [
    "const [data, setData] = useState<PdvVendasResponse | null>(null);",
    "const [loading, setLoading] = useState(true);",
    "const [error, setError] = useState<string | null>(null);",
    "const [produtos, setProdutos] = useState<Produto[]>([]);",
    "const [loadingProdutos, setLoadingProdutos] = useState(false);",
    "const [errorProdutos, setErrorProdutos] = useState<string | null>(null);",
    "const [filtroProdutoTipo, setFiltroProdutoTipo] = useState<'TODOS' | 'PRODUTO' | 'SERVICO'>('TODOS');",
    "const [filtroRevisaoPendente, setFiltroRevisaoPendente] = useState<boolean>(false);",
    "const [showProdutoForm, setShowProdutoForm] = useState(false);",
    "const [editingProduto, setEditingProduto] = useState<Produto | null>(null);",
    "const [produtoNome, setProdutoNome] = useState('');",
    "const [produtoPreco, setProdutoPreco] = useState('');",
    "const [produtoTipo, setProdutoTipo] = useState<string>('PRODUTO');",
    "const [produtoRevisaoPendente, setProdutoRevisaoPendente] = useState<boolean>(false);",
    "const [savingProduto, setSavingProduto] = useState(false);",
    "const [showVincularModal, setShowVincularModal] = useState(false);",
    "const [selectedExistenteId, setSelectedExistenteId] = useState<string>('');",
    "const [merging, setMerging] = useState(false);",
    "const [showQrModal, setShowQrModal] = useState(false);",
    "const [qrModalProduct, setQrModalProduct] = useState<Produto | null>(null);",
    "const [showScannerModal, setShowScannerModal] = useState(false);",
    "const [produtoCodigoBarras, setProdutoCodigoBarras] = useState('');",
    "const [produtoImagemUrl, setProdutoImagemUrl] = useState('');",
    "const [produtoPrecoCustoMedio, setProdutoPrecoCustoMedio] = useState('');",
    "const [produtoNcm, setProdutoNcm] = useState('');",
    "const [produtoCest, setProdutoCest] = useState('');",
    "const [produtoCfopPadrao, setProdutoCfopPadrao] = useState('');",
    "const [filtroProdutoNome, setFiltroProdutoNome] = useState('');",
    "const [uploadingImage, setUploadingImage] = useState(false);",
    "const [showVendaForm, setShowVendaForm] = useState(false);",
    "const [vendedores, setVendedores] = useState<any[]>([]);",
    "const [selectedVendedorId, setSelectedVendedorId] = useState<number | null>(null);",
    "const [vendaItens, setVendaItens] = useState<VendaItemLinha[]>([{ produtoId: '', quantidade: 1, desconto: '0' }]);",
    "const [vendaObservacao, setVendaObservacao] = useState('');",
    "const [camposExtrasForm, setCamposExtrasForm] = useState<Record<string, any>>({});",
    "const [limit, setLimit] = useState(200);",
    "const [isDirectSale, setIsDirectSale] = useState(false);",
    "const [directSaleValue, setDirectSaleValue] = useState('');",
    "const [directSaleDiscount, setDirectSaleDiscount] = useState('');",
    "const [directSaleDescription, setDirectSaleDescription] = useState('');",
    "const [vendaPagamentos, setVendaPagamentos] = useState<any[]>([]);",
    "const [paymentTotal, setPaymentTotal] = useState(0);",
    "const [troco, setTroco] = useState(0);",
    "const [vendaStatus, setVendaStatus] = useState('REALIZADO');",
    "const [savingVenda, setSavingVenda] = useState(false);",
    "const [vendaRv, setVendaRv] = useState('');",
    "const [isEditingSale, setIsEditingSale] = useState(false);",
    "const [saleLocked, setSaleLocked] = useState(false);",
    "const [errorVenda, setErrorVenda] = useState<string | null>(null);",
    "const [selectedEntidadeId, setSelectedEntidadeId] = useState<number | null>(null);",
    "const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | null>(null);",
    "const [centrosCusto, setCentrosCusto] = useState<any[]>([]);",
    "const [comprovanteFiles, setComprovanteFiles] = useState<File[]>([]);",
    "const [existingComprovantes, setExistingComprovantes] = useState<string[]>([]);",
    "const [isDragActive, setIsDragActive] = useState(false);",
    "const [filtroRv, setFiltroRv] = useState('');",
    "const [filtroCliente, setFiltroCliente] = useState('');",
    "const [filtroStatus, setFiltroStatus] = useState('TODOS');",
    "const [filtroVendedor, setFiltroVendedor] = useState('TODOS');"
]

for s in states_to_remove:
    content = content.replace(s, f"// removed: {s}")

pdv_start_idx = content.find("export function PDV() {")
if pdv_start_idx > 0:
    insert_idx = content.find("{", pdv_start_idx) + 1
    content = content[:insert_idx] + "\n" + hook_calls + content[insert_idx:]

content = content.replace("loadProdutos, activeProdutos } = produtosHook;", "loadProdutos: _loadProdutos, activeProdutos } = produtosHook;")
content = content.replace("loadVendas } = vendasHook;", "loadVendas: _loadVendas } = vendasHook;")

# Replaces
replacements = [
    ("{/* Drawer da Nova Venda (PDV Completo) */}", "{/* Modal Rápido de Cadastro de Cliente */}",
     "<CartSidebar {...produtosHook} {...vendasHook} {...carrinhoHook} clientesOnly={clientesOnly} pdvConfig={pdvConfig} podeEscolherVendedor={podeEscolherVendedor} customFields={customFields} paymentMethods={paymentMethods} isPaymentValid={isPaymentValid} vendaValores={vendaValores} currency={currency} handleUpdateStatusInDrawer={handleUpdateStatusInDrawer} setShowClienteModal={setShowClienteModal} setShowModalNovoVendedorExterno={setShowModalNovoVendedorExterno} handlePaymentChange={handlePaymentChange} handleRemovePaymentLine={handleRemovePaymentLine} fillRemainingPayment={fillRemainingPayment} isMethodParcelado={isMethodParcelado} handleAddPaymentLine={handleAddPaymentLine} handleDrag={handleDrag} handleDrop={handleDrop} handleComprovanteChange={handleComprovanteChange} removeSelectedFile={removeSelectedFile} handleNovaVendaSubmit={handleNovaVendaSubmit} parseMonetario={parseMonetario} formatMonetario={formatMonetario} imprimirCupom={imprimirCupom} getStatusLabel={getStatusLabel} statusBadgeClass={statusBadgeClass} />"),
    
    ("{/* Modal de Produto */}", "{/* Modal Rápido de Cadastro de Cliente */}",
     "<ProdutoFormModal {...produtosHook} handleProdutoSubmit={handleProdutoSubmit} />"),
    
    ("{/* Modal Rápido de Cadastro de Cliente */}", "{/* Modal de Vinculação Retroativa (De/Para) */}",
     "<ClienteFormModal showClienteModal={showClienteModal} setShowClienteModal={setShowClienteModal} clienteForm={clienteForm} setClienteForm={setClienteForm} savingCliente={savingCliente} handleClienteSubmit={handleClienteSubmit} />"),
    
    ("{/* Modal de Vinculação Retroativa (De/Para) */}", "{/* Modal de QR Code */}",
     "<VincularProdutoModal {...produtosHook} handleMesclarProdutos={handleMesclarProdutos} />"),
    
    ("{/* Modal de QR Code */}", "{/* Modal de Simulação de Escaner de Código de Barras */}",
     "<QrCodeModal {...produtosHook} handleDownloadQrCode={handleDownloadQrCode} />"),
    
    ("{/* Modal de Simulação de Escaner de Código de Barras */}", "{/* Modal de Cadastro Rápido de Vendedor Externo / Indicador */}",
     "<ScannerModal {...produtosHook} handleScanBarcode={handleScanBarcode} />"),
    
    ("{/* Modal de Cadastro Rápido de Vendedor Externo / Indicador */}", "      {/* Overlay de loading global (opcional, se quiser) */}",
     "<VendedorExternoModal showModalNovoVendedorExterno={showModalNovoVendedorExterno} setShowModalNovoVendedorExterno={setShowModalNovoVendedorExterno} nomeNovoVendedorExterno={nomeNovoVendedorExterno} setNomeNovoVendedorExterno={setNomeNovoVendedorExterno} telefoneNovoVendedorExterno={telefoneNovoVendedorExterno} setTelefoneNovoVendedorExterno={setTelefoneNovoVendedorExterno} comissaoPctNovoVendedorExterno={comissaoPctNovoVendedorExterno} setComissaoPctNovoVendedorExterno={setComissaoPctNovoVendedorExterno} savingVendedorExterno={savingVendedorExterno} handleSaveNovoVendedorExterno={handleSaveNovoVendedorExterno} />")
]

for start_tag, end_tag, comp_jsx in replacements:
    start = content.find(start_tag)
    if start > 0:
        end = content.find(end_tag, start)
        if end > 0:
            content = content[:start] + start_tag + "\n      " + comp_jsx + "\n      " + content[end:]

with open(out_path, "w", encoding="utf-8") as f:
    f.write(content)

print("PDV.tsx rewritten with Modals.")
