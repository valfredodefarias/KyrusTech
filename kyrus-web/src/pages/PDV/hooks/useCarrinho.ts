import { useState } from 'react';
import type { VendaItemLinha } from '../types';

export function useCarrinho() {
  const [showVendaForm, setShowVendaForm] = useState(false);
  const [isEditingSale, setIsEditingSale] = useState(false);
  const [saleLocked, setSaleLocked] = useState(false);
  const [errorVenda, setErrorVenda] = useState<string | null>(null);

  const [vendaRv, setVendaRv] = useState('');
  const [vendaStatus, setVendaStatus] = useState('REALIZADO');
  const [vendaObservacao, setVendaObservacao] = useState('');
  const [camposExtrasForm, setCamposExtrasForm] = useState<Record<string, any>>({});
  
  const [selectedEntidadeId, setSelectedEntidadeId] = useState<number | null>(null);
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | null>(null);
  const [selectedVendedorId, setSelectedVendedorId] = useState<number | null>(null);
  
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<any[]>([]);

  const [vendaItens, setVendaItens] = useState<VendaItemLinha[]>([{ produtoId: '', quantidade: 1, desconto: '0', precoUnitario: '' }]);
  
  const [isDirectSale, setIsDirectSale] = useState(false);
  const [directSaleValue, setDirectSaleValue] = useState('');
  const [directSaleDiscount, setDirectSaleDiscount] = useState('');
  const [directSaleDescription, setDirectSaleDescription] = useState('');

  const [vendaPagamentos, setVendaPagamentos] = useState<any[]>([]);
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [troco, setTroco] = useState(0);
  const [savingVenda, setSavingVenda] = useState(false);

  const [comprovanteFiles, setComprovanteFiles] = useState<File[]>([]);
  const [existingComprovantes, setExistingComprovantes] = useState<string[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);

  return {
    showVendaForm, setShowVendaForm,
    isEditingSale, setIsEditingSale,
    saleLocked, setSaleLocked,
    errorVenda, setErrorVenda,
    vendaRv, setVendaRv,
    vendaStatus, setVendaStatus,
    vendaObservacao, setVendaObservacao,
    camposExtrasForm, setCamposExtrasForm,
    selectedEntidadeId, setSelectedEntidadeId,
    selectedCentroCustoId, setSelectedCentroCustoId,
    selectedVendedorId, setSelectedVendedorId,
    vendedores, setVendedores,
    centrosCusto, setCentrosCusto,
    vendaItens, setVendaItens,
    isDirectSale, setIsDirectSale,
    directSaleValue, setDirectSaleValue,
    directSaleDiscount, setDirectSaleDiscount,
    directSaleDescription, setDirectSaleDescription,
    vendaPagamentos, setVendaPagamentos,
    paymentTotal, setPaymentTotal,
    troco, setTroco,
    savingVenda, setSavingVenda,
    comprovanteFiles, setComprovanteFiles,
    existingComprovantes, setExistingComprovantes,
    isDragActive, setIsDragActive,
  };
}
