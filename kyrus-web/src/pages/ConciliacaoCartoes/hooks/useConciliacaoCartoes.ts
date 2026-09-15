import { useState, useEffect, useMemo } from 'react';
import { api, normalizeListResponse } from '../../../services/api';
import { inferCardBrand } from '../../../components/BrandAvatar';
import type { Recebivel, DepositoExtrato, SugestaoConciliacao } from '../types';

export function useConciliacaoCartoes(recebiveis: Recebivel[], fetchAgenda: () => Promise<void>) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [depositos, setDepositos] = useState<DepositoExtrato[]>([]);
  const [selectedDeposito, setSelectedDeposito] = useState<DepositoExtrato | null>(null);
  
  const [sugestoes, setSugestoes] = useState<SugestaoConciliacao[]>([]);
  const [loadingSugestoes, setLoadingSugestoes] = useState(false);

  const [rightPanelTab, setRightPanelTab] = useState<'sugestoes' | 'manual'>('sugestoes');
  const [manualFilterBrand, setManualFilterBrand] = useState('');
  const [manualSearch, setManualSearch] = useState('');
  const [selectedManualIds, setSelectedManualIds] = useState<number[]>([]);
  const [anticipationRate, setAnticipationRate] = useState<number>(0);
  const [manualReconcileDate, setManualReconcileDate] = useState('');
  const [manualReconcileContaId, setManualReconcileContaId] = useState('');

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedSugestao, setSelectedSugestao] = useState<SugestaoConciliacao | null>(null);
  const [confirmData, setConfirmData] = useState({
    data_pagamento: '',
    conta_destino_id: ''
  });

  const fetchDepositos = async () => {
    if (depositos.length === 0) setLoading(true);
    else setSyncing(true);

    try {
      const res = await api.get('/lancamentos/', {
        params: {
          tipo: 'RECEITA',
          origem: 'EXTRATO,OFX_EXTRATO',
          conciliado: false,
          sem_paginacao: true
        }
      });
      setDepositos(normalizeListResponse<DepositoExtrato>(res.data));
    } catch (e) {
      console.error('Erro ao carregar depósitos:', e);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (selectedDeposito) {
      setManualReconcileDate(selectedDeposito.data_pagamento || selectedDeposito.data_vencimento || new Date().toISOString().split('T')[0]);
      setManualReconcileContaId(String(selectedDeposito.conta_id));

      const brand = inferCardBrand(selectedDeposito.descricao);
      const knownBrands = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'PIX'];
      const inferred = brand.key.toUpperCase();
      if (knownBrands.includes(inferred)) setManualFilterBrand(inferred);
      else setManualFilterBrand('');
    } else {
      setManualReconcileDate('');
      setManualReconcileContaId('');
      setManualFilterBrand('');
    }
    setSelectedManualIds([]);
    setAnticipationRate(0);
  }, [selectedDeposito]);

  useEffect(() => {
    if (!selectedDeposito) {
      setSugestoes([]);
      return;
    }
    const loadSuggestions = async () => {
      setLoadingSugestoes(true);
      try {
        const res = await api.post(`/pdv/conciliacao/auto-match?lancamento_deposito_id=${selectedDeposito.id}`);
        setSugestoes(normalizeListResponse<SugestaoConciliacao>(res.data));
      } catch (e) {
        console.error('Erro ao carregar sugestões:', e);
        setSugestoes([]);
      } finally {
        setLoadingSugestoes(false);
      }
    };
    void loadSuggestions();
  }, [selectedDeposito]);

  const handleOpenConfirmConciliacao = (sug: SugestaoConciliacao) => {
    if (!selectedDeposito) return;
    setSelectedSugestao(sug);
    setConfirmData({
      data_pagamento: selectedDeposito.data_pagamento || selectedDeposito.data_vencimento || new Date().toISOString().split('T')[0],
      conta_destino_id: String(selectedDeposito.conta_id)
    });
    setShowConfirmModal(true);
  };

  const handleConfirmConciliacao = async () => {
    if (!selectedDeposito || !selectedSugestao) return;
    setSaving(true);
    try {
      const payload = {
        data_pagamento: confirmData.data_pagamento,
        conta_destino_id: Number(confirmData.conta_destino_id),
        lancamento_deposito_id: selectedDeposito.id,
        lancamento_ids: selectedSugestao.lancamentos
      };

      await api.post('/pdv/conciliacao/lotes', payload);
      setShowConfirmModal(false);
      setSelectedDeposito(null);
      setSelectedSugestao(null);
      await fetchDepositos();
      alert('Lote de cartões conciliado e liquidado com sucesso!');
    } catch (e) {
      console.error('Erro ao conciliar lote:', e);
      alert('Erro ao conciliar lote. Verifique se os dados são válidos.');
    } finally {
      setSaving(false);
    }
  };

  const handleBatchManualReconcile = async (BRL: Intl.NumberFormat) => {
    if (!selectedDeposito || selectedManualIds.length === 0) return;
    if (!manualReconcileContaId) {
      alert('Selecione a conta bancária destino para o lote.');
      return;
    }
    if (!manualReconcileDate) {
      alert('Informe a data real do depósito.');
      return;
    }

    if (!confirm(`Deseja conciliar as ${selectedManualIds.length} parcelas selecionadas contra o depósito de ${BRL.format(selectedDeposito.valor_pago || selectedDeposito.valor_previsto)}?`)) return;

    setSaving(true);
    try {
      const putPromises = selectedManualIds.map(async (id) => {
        const resGet = await api.get(`/lancamentos/${id}`);
        const lancamentoAtual = resGet.data;

        let meta: Record<string, any> = {};
        if (lancamentoAtual.observacao) {
          try {
            meta = JSON.parse(lancamentoAtual.observacao);
          } catch (err) {
            meta = {};
          }
        }

        const valorBruto = Number(lancamentoAtual.valor_previsto || 0);
        const originalTaxaValor = Number(lancamentoAtual.valor_taxa ?? meta.cartao_taxa_valor ?? 0);
        const originalTaxa = Number(meta.cartao_taxa || (valorBruto > 0 ? (originalTaxaValor / valorBruto) * 100 : 0));

        const anticipationFeeVal = valorBruto * (anticipationRate / 100);
        const newTaxaValor = Number((originalTaxaValor + anticipationFeeVal).toFixed(2));
        const newLiquido = Number((valorBruto - newTaxaValor).toFixed(2));

        const updatedMeta = {
          ...meta,
          cartao_taxa: Number((originalTaxa + anticipationRate).toFixed(2)),
          cartao_taxa_valor: newTaxaValor,
          cartao_liquido_previsto: newLiquido,
          taxa_antecipacao_aplicada: anticipationRate,
          valor_antecipacao_aplicada: anticipationFeeVal
        };

        const payload = {
          descricao: lancamentoAtual.descricao,
          valor_previsto: valorBruto,
          valor_pago: lancamentoAtual.valor_pago,
          valor_taxa: newTaxaValor,
          valor_liquido: newLiquido,
          data_pagamento: lancamentoAtual.data_pagamento,
          data_vencimento: manualReconcileDate,
          data_competencia: lancamentoAtual.data_competencia,
          conta_id: lancamentoAtual.conta_id,
          plano_contas_id: lancamentoAtual.plano_contas_id,
          entidade_id: lancamentoAtual.entidade_id,
          status: lancamentoAtual.status,
          observacao: lancamentoAtual.observacao && !lancamentoAtual.observacao.trim().startsWith('{') ? lancamentoAtual.observacao : null
        };

        await api.put(`/lancamentos/${id}`, payload);
      });

      await Promise.all(putPromises);

      const payloadLote = {
        data_pagamento: manualReconcileDate,
        conta_destino_id: Number(manualReconcileContaId),
        lancamento_deposito_id: selectedDeposito.id,
        lancamento_ids: selectedManualIds
      };

      await api.post('/pdv/conciliacao/lotes', payloadLote);

      setSelectedDeposito(null);
      setSelectedManualIds([]);
      setAnticipationRate(0);
      setRightPanelTab('sugestoes');
      await Promise.all([
        fetchDepositos(),
        fetchAgenda()
      ]);

      alert('Lote manual de cartões conciliado e liquidado com sucesso!');
    } catch (err) {
      console.error('Erro ao realizar conciliação manual:', err);
      alert('Erro ao realizar conciliação manual de recebíveis.');
    } finally {
      setSaving(false);
    }
  };

  const pendingReceivables = useMemo(() => {
    return recebiveis.filter(r => r.status === 'A RECEBER');
  }, [recebiveis]);

  const filteredManualReceivables = useMemo(() => {
    return pendingReceivables.filter(r => {
      const matchBrand = !manualFilterBrand || r.bandeira === manualFilterBrand;
      const matchSearch = !manualSearch ||
        (r.descricao || '').toLowerCase().includes(manualSearch.toLowerCase()) ||
        (r.rv || '').toLowerCase().includes(manualSearch.toLowerCase());
      return matchBrand && matchSearch;
    });
  }, [pendingReceivables, manualFilterBrand, manualSearch]);

  const manualSummary = useMemo(() => {
    let bruto = 0, taxaAdm = 0;
    selectedManualIds.forEach(id => {
      const item = recebiveis.find(r => r.id === id);
      if (item) {
        bruto += Number(item.valor_bruto || 0);
        taxaAdm += Number(item.valor_taxa || 0);
      }
    });

    const antecipacao = bruto * (anticipationRate / 100);
    const liquido = bruto - taxaAdm - antecipacao;
    const target = selectedDeposito ? (selectedDeposito.valor_pago || selectedDeposito.valor_previsto || 0) : 0;
    const diferenca = target - liquido;

    return { bruto, taxaAdm, antecipacao, liquido, diferenca };
  }, [selectedManualIds, recebiveis, anticipationRate, selectedDeposito]);

  return {
    loading, syncing, saving, depositos, setDepositos, selectedDeposito, setSelectedDeposito,
    sugestoes, loadingSugestoes, rightPanelTab, setRightPanelTab, manualFilterBrand, setManualFilterBrand,
    manualSearch, setManualSearch, selectedManualIds, setSelectedManualIds, anticipationRate, setAnticipationRate,
    manualReconcileDate, setManualReconcileDate, manualReconcileContaId, setManualReconcileContaId,
    showConfirmModal, setShowConfirmModal, selectedSugestao, setSelectedSugestao, confirmData, setConfirmData,
    fetchDepositos, handleOpenConfirmConciliacao, handleConfirmConciliacao, handleBatchManualReconcile,
    pendingReceivables, filteredManualReceivables, manualSummary
  };
}
