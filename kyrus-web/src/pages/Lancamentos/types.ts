export interface Anexo {
  id: number;
  nome_arquivo: string;
  url: string;
  tipo: string;
}

export interface Lancamento {
  id: number;
  descricao: string;
  valor_previsto: number;
  valor_pago: number;
  data_vencimento: string;
  data_pagamento?: string;
  tipo: 'RECEITA' | 'DESPESA';
  data_competencia?: string;
  competencia?: string;
  previsto?: boolean;
  status: 'PAGO' | 'PENDENTE' | 'EM ABERTO' | 'PARCIALMENTE_PAGO';
  ipp: boolean;
  observacao?: string;
  conciliado?: boolean;
  origem?: string;
  plano_contas_id: number;
  entidade_id?: number;
  conta_id?: number;
  cartao_id?: number;
  centro_custo_id?: number;
  anexos: Anexo[];
  numero_parcela?: number;
  id_parcelamento?: string;
  tipo_origem?: string | null;
  origem_uuid?: string | null;
  lote_cartao_id?: number | null;
  referencia_externa?: string | null;
  codigo_barras?: string | null;
  tipo_pagamento?: string | null;
  valor_taxa?: number | null;
  valor_liquido?: number | null;
}

export interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type ListaSortKey = 'descricao' | 'interessado' | 'valor' | 'status';
export type ListaSortDirection = 'asc' | 'desc';

export interface QuickEntityFormState {
  nome: string;
  tipo: 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
  tipo_pessoa: 'PF' | 'PJ';
  nome_fantasia: string;
  cpf_cnpj: string;
  email: string;
  telefone: string;
  celular: string;
  contato_nome: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  observacoes: string;
}

export interface LancamentosProps {
  forcedSearchParams?: URLSearchParams | null;
  onRequestCloseEmbed?: () => void;
  drawerPanelClassName?: string;
}
