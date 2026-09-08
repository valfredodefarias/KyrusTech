export interface Produto {
  id: number;
  nome: string;
  preco_unitario: number;
  empresa_id: number;
  is_active: boolean;
  tipo?: string;
  codigo_barras?: string | null;
  imagem_url?: string | null;
  preco_custo_medio?: number | null;
  ncm?: string | null;
  cest?: string | null;
  cfop_padrao?: string | null;
  revisao_pendente?: boolean;
  quantidade_estoque?: number;
}

export interface PdvVendaItem {
  id: number;
  venda_id_uuid?: string | null;
  rv: string;
  data: string;
  hora?: string | null;
  vendedor: string;
  status: string;
  descricao: string;
  valor: number;
  origem?: string;
  tipo_venda?: string;
  tipoVenda?: string;
  fonte?: string;
  comprovante_url?: string | null;
  comprovante_urls?: string[] | null;
  vendedor_id?: number | null;
  entidade_id?: number | null;
  centro_custo_id?: number | null;
  observacao_texto?: string | null;
  itens_detalhe?: any[] | null;
  pagamentos_detalhe?: any[] | null;
  campos_extras?: Record<string, any> | null;
  desconto?: number;
  lock_reconciled?: boolean;
  criador_nome?: string | null;
  criador_email?: string | null;
  created_at_str?: string | null;
}

export interface PdvVendaGrupo {
  data: string;
  total: number;
  quantidade: number;
  vendas: PdvVendaItem[];
}

export interface PdvVendasResponse {
  pode_ver_todas: boolean;
  total_vendas: number;
  total_valor: number;
  grupos: PdvVendaGrupo[];
  has_more?: boolean;
}

export interface VendaItemLinha {
  produtoId: string;
  quantidade: number;
  desconto: string;
  precoUnitario?: string;
}

export interface VendaPagamentoLinha {
  tipoPagamento: string;
  valor: string;
  numeroParcelas: number;
  valorParcela: string;
  dataPagamento: string;
  bandeira?: string;
}
