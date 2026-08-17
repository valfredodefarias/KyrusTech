import { useState, useMemo } from 'react';
import { api } from '../../../services/api';
import type { RegraCartao, Conta, PlanoContas } from '../types';

export interface ModalityFormState {
  active: boolean;
  id: number | null;
  taxa_porcentagem: number;
  taxa_antecipacao: number;
  dias_payout: number;
  tipo_prazo: 'DIAS_CORRIDOS' | 'DIAS_UTEIS' | 'DIA_FIXO';
  dia_fixo: string | number;
  modo_parcelamento: 'PRO_RATA' | 'ANTECIPADO';
  fds_proximo_dia_util: boolean;
}

export interface GroupedBandeira {
  data_inicio?: string | null;
  bandeira: string;
  debito?: RegraCartao;
  credito_vista?: RegraCartao;
  credito_parcelado?: RegraCartao;
  pix?: RegraCartao;
}

export function useRegrasCartoes(regras: RegraCartao[], contas: Conta[], categoriasDespesa: PlanoContas[], loadData: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [showRegraDrawer, setShowRegraDrawer] = useState(false);
  const [isEditingRegra, setIsEditingRegra] = useState(false);
  const [drawerSubTab, setDrawerSubTab] = useState<'debito' | 'credito_vista' | 'credito_parcelado'>('debito');

  const initialModalityState = (tipo: string): ModalityFormState => ({
    active: false,
    id: null,
    taxa_porcentagem: 0,
    taxa_antecipacao: 0,
    dias_payout: tipo === 'cartao_debito' ? 1 : 30,
    tipo_prazo: 'DIAS_CORRIDOS',
    dia_fixo: '',
    modo_parcelamento: 'PRO_RATA',
    fds_proximo_dia_util: true,
  });

  const [groupedRegraForm, setGroupedRegraForm] = useState({
    bandeira: 'VISA',
    data_inicio: '',
    original_data_inicio: '',
    conta_destino_id: '',
    plano_contas_taxa_id: '',
    debito: initialModalityState('cartao_debito'),
    credito_vista: initialModalityState('cartao_credito_vista'),
    credito_parcelado: initialModalityState('cartao_credito_parcelado'),
  });

  const modalityKeyMap: Record<string, 'debito' | 'credito_vista' | 'credito_parcelado'> = {
    cartao_debito: 'debito',
    cartao_credito_vista: 'credito_vista',
    cartao_credito_parcelado: 'credito_parcelado',
  };

  const activeModalityKey = drawerSubTab;
  const activeModality = groupedRegraForm[activeModalityKey];
  const tipoPagMap: Record<string, string> = {
    debito: 'cartao_debito',
    credito_vista: 'cartao_credito_vista',
    credito_parcelado: 'cartao_credito_parcelado',
  };

  const regraForm = {
    tipo_pagamento: tipoPagMap[activeModalityKey] || 'cartao_credito_vista',
    bandeira: groupedRegraForm.bandeira,
    taxa_porcentagem: activeModality.taxa_porcentagem,
    taxa_antecipacao: activeModality.taxa_antecipacao,
    dias_payout: activeModality.dias_payout,
    tipo_prazo: activeModality.tipo_prazo,
    dia_fixo: activeModality.dia_fixo,
    modo_parcelamento: activeModality.modo_parcelamento,
    fds_proximo_dia_util: activeModality.fds_proximo_dia_util,
    conta_destino_id: groupedRegraForm.conta_destino_id,
    plano_contas_taxa_id: groupedRegraForm.plano_contas_taxa_id,
  };

  const setRegraForm = (updates: Partial<typeof regraForm>) => {
    setGroupedRegraForm(prev => {
      const next = { ...prev };
      if ('bandeira' in updates) next.bandeira = updates.bandeira!;
      if ('conta_destino_id' in updates) next.conta_destino_id = String(updates.conta_destino_id ?? '');
      if ('plano_contas_taxa_id' in updates) next.plano_contas_taxa_id = String(updates.plano_contas_taxa_id ?? '');

      if ('tipo_pagamento' in updates) {
        const newKey = modalityKeyMap[updates.tipo_pagamento!];
        if (newKey) setDrawerSubTab(newKey);
      }

      const modKey = activeModalityKey;
      const mod = { ...next[modKey], active: true };
      if ('taxa_porcentagem' in updates) mod.taxa_porcentagem = Number(updates.taxa_porcentagem);
      if ('taxa_antecipacao' in updates) mod.taxa_antecipacao = Number(updates.taxa_antecipacao);
      if ('dias_payout' in updates) mod.dias_payout = Number(updates.dias_payout);
      if ('tipo_prazo' in updates) mod.tipo_prazo = updates.tipo_prazo as any;
      if ('dia_fixo' in updates) mod.dia_fixo = updates.dia_fixo as any;
      if ('modo_parcelamento' in updates) mod.modo_parcelamento = updates.modo_parcelamento as any;
      if ('fds_proximo_dia_util' in updates) mod.fds_proximo_dia_util = Boolean(updates.fds_proximo_dia_util);
      next[modKey] = mod;

      return next;
    });
  };

  const handleOpenConfigureBrand = (brandName: string) => {
    setGroupedRegraForm({
      bandeira: brandName,
      data_inicio: '',
      original_data_inicio: '',
      conta_destino_id: contas.length > 0 ? String(contas[0].id) : '',
      plano_contas_taxa_id: categoriasDespesa.length > 0 ? String(categoriasDespesa[0].id) : '',
      debito: { ...initialModalityState('cartao_debito'), active: true },
      credito_vista: initialModalityState('cartao_credito_vista'),
      credito_parcelado: initialModalityState('cartao_credito_parcelado'),
    });
    setDrawerSubTab('debito');
    setIsEditingRegra(false);
    setShowRegraDrawer(true);
  };

  const handleOpenCreateRegra = () => handleOpenConfigureBrand('VISA');

  const handleOpenEditGroupedRegra = (g: GroupedBandeira) => {
    const commonRule = g.debito || g.credito_vista || g.credito_parcelado;

    const mapRuleToState = (r?: RegraCartao, defaultTipo?: string): ModalityFormState => {
      if (!r) return { ...initialModalityState(defaultTipo || ''), active: false };
      return {
        active: true,
        id: r.id,
        taxa_porcentagem: Number(r.taxa_porcentagem),
        taxa_antecipacao: Number(r.taxa_antecipacao || 0),
        dias_payout: Number(r.dias_payout || 0),
        tipo_prazo: r.tipo_prazo || 'DIAS_CORRIDOS',
        dia_fixo: r.dia_fixo !== null && r.dia_fixo !== undefined ? String(r.dia_fixo) : '',
        modo_parcelamento: r.modo_parcelamento || 'PRO_RATA',
        fds_proximo_dia_util: r.fds_proximo_dia_util !== false,
      };
    };

    setGroupedRegraForm({
      bandeira: g.bandeira,
      data_inicio: g.data_inicio || '',
      original_data_inicio: g.data_inicio || '',
      conta_destino_id: commonRule ? String(commonRule.conta_destino_id) : (contas.length > 0 ? String(contas[0].id) : ''),
      plano_contas_taxa_id: commonRule ? String(commonRule.plano_contas_taxa_id) : (categoriasDespesa.length > 0 ? String(categoriasDespesa[0].id) : ''),
      debito: mapRuleToState(g.debito, 'cartao_debito'),
      credito_vista: mapRuleToState(g.credito_vista, 'cartao_credito_vista'),
      credito_parcelado: mapRuleToState(g.credito_parcelado, 'cartao_credito_parcelado'),
    });

    if (g.debito) setDrawerSubTab('debito');
    else if (g.credito_vista) setDrawerSubTab('credito_vista');
    else if (g.credito_parcelado) setDrawerSubTab('credito_parcelado');
    else setDrawerSubTab('debito');

    setIsEditingRegra(true);
    setShowRegraDrawer(true);
  };

  const handleSaveRegra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupedRegraForm.debito.active && !groupedRegraForm.credito_vista.active && !groupedRegraForm.credito_parcelado.active) {
      alert('Ative pelo menos uma forma de pagamento (Débito, Crédito à Vista ou Crédito Parcelado) para salvar os parâmetros.');
      return;
    }

    setSaving(true);
    try {
      const promises: Promise<any>[] = [];
      const handleModality = (modality: ModalityFormState, tipo: string) => {
        const isNewVersion = Boolean(groupedRegraForm.original_data_inicio && groupedRegraForm.data_inicio && groupedRegraForm.data_inicio !== groupedRegraForm.original_data_inicio);
        const targetId = isNewVersion ? null : modality.id;
        
        const payload = {
          tipo_pagamento: tipo,
          bandeira: groupedRegraForm.bandeira.toUpperCase(),
          data_inicio: groupedRegraForm.data_inicio || null,
          taxa_porcentagem: Number(modality.taxa_porcentagem),
          taxa_antecipacao: Number(modality.taxa_antecipacao),
          dias_payout: Number(modality.dias_payout),
          tipo_prazo: modality.tipo_prazo,
          dia_fixo: modality.tipo_prazo === 'DIA_FIXO' && modality.dia_fixo !== '' ? Number(modality.dia_fixo) : null,
          modo_parcelamento: modality.modo_parcelamento,
          fds_proximo_dia_util: modality.fds_proximo_dia_util,
          conta_destino_id: Number(groupedRegraForm.conta_destino_id),
          plano_contas_taxa_id: Number(groupedRegraForm.plano_contas_taxa_id)
        };

        if (modality.active) {
          if (targetId) promises.push(api.put(`/pdv/regras-cartao/${targetId}`, payload));
          else promises.push(api.post('/pdv/regras-cartao', payload));
        } else {
          if (targetId) promises.push(api.delete(`/pdv/regras-cartao/${targetId}`));
        }
      };

      handleModality(groupedRegraForm.debito, 'cartao_debito');
      handleModality(groupedRegraForm.credito_vista, 'cartao_credito_vista');
      handleModality(groupedRegraForm.credito_parcelado, 'cartao_credito_parcelado');

      await Promise.all(promises);
      setShowRegraDrawer(false);
      await loadData();
      alert('Parâmetros da bandeira salvos com sucesso!');
    } catch (err) {
      console.error('Erro ao salvar regras:', err);
      alert('Erro ao salvar parâmetros da bandeira. Verifique as informações.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroupedRegra = async (g: GroupedBandeira) => {
    if (!confirm(`Deseja realmente excluir todos os parâmetros da bandeira ${g.bandeira}?`)) return;
    setSaving(true);
    try {
      const promises: Promise<any>[] = [];
      if (g.debito?.id) promises.push(api.delete(`/pdv/regras-cartao/${g.debito.id}`));
      if (g.credito_vista?.id) promises.push(api.delete(`/pdv/regras-cartao/${g.credito_vista.id}`));
      if (g.credito_parcelado?.id) promises.push(api.delete(`/pdv/regras-cartao/${g.credito_parcelado.id}`));

      await Promise.all(promises);
      await loadData();
      alert('Parâmetros da bandeira excluídos com sucesso!');
    } catch (e) {
      console.error('Erro ao deletar regras:', e);
      alert('Erro ao excluir parâmetros da bandeira.');
    } finally {
      setSaving(false);
    }
  };

  const groupedRegras = useMemo(() => {
    const defaultBrands = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'PIX'];
    const groups: Record<string, GroupedBandeira> = {};
    
    defaultBrands.forEach(b => groups[b] = { bandeira: b, data_inicio: null });

    const sortedRegras = [...regras].sort((a, b) => {
      const aTime = a.data_inicio ? new Date(a.data_inicio).getTime() : 0;
      const bTime = b.data_inicio ? new Date(b.data_inicio).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return b.id - a.id;
    });

    sortedRegras.forEach(r => {
      const brand = r.bandeira.toUpperCase();
      if (!groups[brand]) groups[brand] = { bandeira: brand, data_inicio: r.data_inicio };
      else if (!groups[brand].data_inicio && r.data_inicio) groups[brand].data_inicio = r.data_inicio;
      
      if (r.tipo_pagamento === 'cartao_debito' && !groups[brand].debito) groups[brand].debito = r;
      else if (r.tipo_pagamento === 'cartao_credito_vista' && !groups[brand].credito_vista) groups[brand].credito_vista = r;
      else if (r.tipo_pagamento === 'cartao_credito_parcelado' && !groups[brand].credito_parcelado) groups[brand].credito_parcelado = r;
      else if (r.tipo_pagamento === 'pix' && !groups[brand].pix) groups[brand].pix = r;
    });

    return Object.values(groups).sort((a, b) => {
      const aIdx = defaultBrands.indexOf(a.bandeira);
      const bIdx = defaultBrands.indexOf(b.bandeira);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.bandeira.localeCompare(b.bandeira);
    });
  }, [regras]);

  return {
    saving, showRegraDrawer, setShowRegraDrawer, isEditingRegra, drawerSubTab, setDrawerSubTab,
    groupedRegraForm, setGroupedRegraForm, regraForm, setRegraForm, handleOpenConfigureBrand,
    handleOpenCreateRegra, handleOpenEditGroupedRegra, handleSaveRegra, handleDeleteGroupedRegra, groupedRegras
  };
}
