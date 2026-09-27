export interface AsaasConta {
  id: number;
  nome: string;
  ambiente: string;
  ativo: boolean;
  conta_id?: number | null;
  conta_nome?: string | null;
  conta_saldo?: number;
  ultima_sincronizacao?: string | null;
  data_inicio_sincronizacao?: string | null;
  token_configurado?: boolean;
}

export interface AsaasKpis {
  total_faturado: number;
  total_recebido: number;
  total_a_receber: number;
  total_vencido: number;
  total_gastos: number;
  taxa_media_efetiva: number;
  qtd_recebidas: number;
  qtd_pendentes: number;
  qtd_vencidas: number;
  qtd_total: number;
}

export interface AsaasSaldo {
  saldo: number;
  saldo_disponivel: number;
  saldo_bloqueado: number;
}

export interface AsaasPrevisaoItem {
  id: string;
  cliente: string;
  cliente_cpf_cnpj?: string | null;
  descricao: string;
  valor_bruto: number;
  taxa_estimada: number;
  valor_liquido: number;
  meio: string;
  status: string;
  invoice_url?: string | null;
  due_date: string;
}

export interface AsaasPrevisaoTimeline {
  data: string;
  valor_bruto: number;
  taxa_estimada: number;
  valor_liquido: number;
  qtd: number;
  itens?: AsaasPrevisaoItem[];
}

export interface AsaasGastoCategoria {
  codigo: string;
  categoria: string;
  valor: number;
  qtd: number;
  percentual: number;
}

export interface AsaasMeioItem {
  valor: number;
  qtd: number;
  pct: number;
}

export interface AsaasDistribuicaoMeios {
  PIX: AsaasMeioItem;
  BOLETO: AsaasMeioItem;
  CREDIT_CARD: AsaasMeioItem;
  OUTROS: AsaasMeioItem;
}

export interface AsaasEvolucaoMensal {
  mes: string;
  mes_label: string;
  pago: number;
  atrasado: number;
  aguardando: number;
  total: number;
  qtd_pago: number;
  qtd_atrasado: number;
  qtd_aguardando: number;
}

export interface AsaasExtratoItem {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  valor: number;
  data?: string | null;
  categoria_id?: number | null;
  categoria_nome?: string | null;
  entidade_nome?: string | null;
  observacao?: string | null;
  conciliado: boolean;
  origem: string;
}

export interface AsaasLancamentoContexto {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  valor: number;
  valor_previsto?: number;
  valor_pago?: number;
  data?: string | null;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  categoria_id?: number | null;
  categoria_nome?: string | null;
  entidade_id?: number | null;
  entidade_nome?: string | null;
  observacao?: string | null;
  conciliado: boolean;
  origem: string;
}

export interface AsaasDashboardData {
  saldo: AsaasSaldo;
  kpis: AsaasKpis;
  distribuicao_meios: AsaasDistribuicaoMeios;
  previsoes_timeline: AsaasPrevisaoTimeline[];
  gastos_por_categoria: AsaasGastoCategoria[];
  evolucao_mensal?: AsaasEvolucaoMensal[];
  extrato_recente?: AsaasExtratoItem[];
}

export interface AsaasCobranca {
  id: string;
  customer?: string | null;
  customerName?: string | null;
  customerCpfCnpj?: string | null;
  customerEmail?: string | null;
  value: number;
  netValue: number;
  fee: number;
  dueDate: string;
  paymentDate?: string | null;
  status: string;
  billingType: string;
  description?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  externalReference?: string | null;
}

export interface AsaasCliente {
  id: string;
  name: string;
  cpfCnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  total_faturado?: number;
  total_pendente?: number;
  qtd_cobrancas?: number;
}
