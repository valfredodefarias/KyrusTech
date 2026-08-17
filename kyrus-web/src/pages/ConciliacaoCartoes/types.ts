export const parseSafeDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null;
  if (dateStr.includes("T") || dateStr.includes(" ")) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dateObj = new Date(y, m, d);
    if (!isNaN(dateObj.getTime())) return dateObj;
  }
  const fallback = new Date(dateStr);
  return isNaN(fallback.getTime()) ? null : fallback;
};

export const formatSafeDate = (dateStr: string | null | undefined, options?: Intl.DateTimeFormatOptions): string => {
  const dObj = parseSafeDate(dateStr);
  if (!dObj) return "--/--/----";
  try {
    return dObj.toLocaleDateString("pt-BR", options);
  } catch (e) {
    return "--/--/----";
  }
};

export interface RegraCartao {
  data_inicio?: string | null;
  id: number;
  tipo_pagamento: string;
  bandeira: string;
  taxa_porcentagem: number;
  taxa_antecipacao: number;
  dias_payout: number;
  tipo_prazo: 'DIAS_CORRIDOS' | 'DIAS_UTEIS' | 'DIA_FIXO';
  dia_fixo?: number | null;
  modo_parcelamento: 'PRO_RATA' | 'ANTECIPADO';
  fds_proximo_dia_util: boolean;
  conta_destino_id: number;
  plano_contas_taxa_id: number;
  empresa_id: number;
}

export interface Recebivel {
  id: number;
  venda_id_uuid: string;
  rv: string;
  data_venda: string;
  data_vencimento: string;
  descricao: string;
  tipo_pagamento: string;
  bandeira: string;
  numero_parcela?: number | null;
  total_parcelas?: number | null;
  valor_bruto: number;
  valor_taxa: number;
  valor_liquido: number;
  status: 'PAGO' | 'A RECEBER' | 'ANTECIPADO';
  vendedor?: string;
  cliente?: string;
  itens?: any[];
}

export interface DepositoExtrato {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  origem: string;
  valor_previsto: number;
  valor_pago: number;
  data_vencimento: string;
  data_pagamento?: string | null;
  data_competencia: string;
  conta_id: number;
  plano_contas_id: number;
  conciliado: boolean;
}

export interface SugestaoConciliacao {
  tipo: 'GRUPO_DIA_BANDEIRA' | 'AVULSO' | 'COMBINACAO';
  label: string;
  score: number;
  valor_bruto: number;
  valor_taxa: number;
  valor_liquido: number;
  lancamentos: number[];
  detalhes: string;
}

export interface Conta {
  id: number;
  nome: string;
  tipo: string;
  banco?: string | null;
}

export interface PlanoContas {
  id: number;
  codigo: string;
  nome: string;
  tipo: string;
  eh_cabecalho: boolean;
  permite_lancamentos?: boolean | null;
}

