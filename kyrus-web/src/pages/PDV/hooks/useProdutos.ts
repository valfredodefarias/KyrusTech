import { useState, useCallback } from 'react';
import type { Produto } from '../types';
import { api } from '../../../services/api';

export function useProdutos() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [errorProdutos, setErrorProdutos] = useState<string | null>(null);
  
  // Filtros
  const [filtroProdutoTipo, setFiltroProdutoTipo] = useState<'TODOS' | 'PRODUTO' | 'SERVICO'>('TODOS');
  const [filtroRevisaoPendente, setFiltroRevisaoPendente] = useState<boolean>(false);
  const [filtroProdutoNome, setFiltroProdutoNome] = useState('');

  // Formulário de Produto
  const [showProdutoForm, setShowProdutoForm] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [produtoNome, setProdutoNome] = useState('');
  const [produtoPreco, setProdutoPreco] = useState('');
  const [produtoTipo, setProdutoTipo] = useState<string>('PRODUTO');
  const [produtoRevisaoPendente, setProdutoRevisaoPendente] = useState<boolean>(false);
  const [savingProduto, setSavingProduto] = useState(false);
  const [produtoCodigoBarras, setProdutoCodigoBarras] = useState('');
  const [produtoImagemUrl, setProdutoImagemUrl] = useState('');
  const [produtoPrecoCustoMedio, setProdutoPrecoCustoMedio] = useState('');
  const [produtoNcm, setProdutoNcm] = useState('');
  const [produtoCest, setProdutoCest] = useState('');
  const [produtoCfopPadrao, setProdutoCfopPadrao] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  // Vincular Modal
  const [showVincularModal, setShowVincularModal] = useState(false);
  const [selectedExistenteId, setSelectedExistenteId] = useState<string>('');
  const [merging, setMerging] = useState(false);

  // QR Code & Scanner
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrModalProduct, setQrModalProduct] = useState<Produto | null>(null);
  const [showScannerModal, setShowScannerModal] = useState(false);

  const loadProdutos = useCallback(async () => {
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
  }, []);

  const activeProdutos = produtos.filter(p => p.is_active !== false);

  return {
    produtos, setProdutos,
    loadingProdutos, setLoadingProdutos,
    errorProdutos, setErrorProdutos,
    filtroProdutoTipo, setFiltroProdutoTipo,
    filtroRevisaoPendente, setFiltroRevisaoPendente,
    filtroProdutoNome, setFiltroProdutoNome,
    showProdutoForm, setShowProdutoForm,
    editingProduto, setEditingProduto,
    produtoNome, setProdutoNome,
    produtoPreco, setProdutoPreco,
    produtoTipo, setProdutoTipo,
    produtoRevisaoPendente, setProdutoRevisaoPendente,
    savingProduto, setSavingProduto,
    produtoCodigoBarras, setProdutoCodigoBarras,
    produtoImagemUrl, setProdutoImagemUrl,
    produtoPrecoCustoMedio, setProdutoPrecoCustoMedio,
    produtoNcm, setProdutoNcm,
    produtoCest, setProdutoCest,
    produtoCfopPadrao, setProdutoCfopPadrao,
    uploadingImage, setUploadingImage,
    showVincularModal, setShowVincularModal,
    selectedExistenteId, setSelectedExistenteId,
    merging, setMerging,
    showQrModal, setShowQrModal,
    qrModalProduct, setQrModalProduct,
    showScannerModal, setShowScannerModal,
    loadProdutos,
    activeProdutos
  };
}
