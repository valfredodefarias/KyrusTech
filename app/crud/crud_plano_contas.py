# app/crud/crud_plano_contas.py

from typing import List, Optional
from sqlmodel import Session, select
from app.models.plano_contas import PlanoContas
from app.schemas.plano_contas import PlanoContasCreate, PlanoContasUpdate

# --- FUNÇÕES BÁSICAS DE CRUD (Faltavam estas) ---

def get(db: Session, *, id: int, empresa_id: int) -> Optional[PlanoContas]:
    """Busca uma categoria específica pelo ID e Empresa."""
    statement = select(PlanoContas).where(PlanoContas.id == id, PlanoContas.empresa_id == empresa_id)
    return db.exec(statement).first()

def get_by_empresa(db: Session, *, empresa_id: int) -> List[PlanoContas]:
    """Busca todas as categorias da empresa."""
    statement = select(PlanoContas).where(PlanoContas.empresa_id == empresa_id).order_by(PlanoContas.nome)
    return list(db.exec(statement).all())

def create(db: Session, *, obj_in: PlanoContasCreate, empresa_id: int) -> PlanoContas:
    """Cria uma nova categoria manualmente."""
    data = obj_in.model_dump()
    data["empresa_id"] = empresa_id
    db_obj = PlanoContas.model_validate(data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update(db: Session, *, db_obj: PlanoContas, obj_in: PlanoContasUpdate) -> PlanoContas:
    """Atualiza uma categoria existente."""
    update_data = obj_in.model_dump(exclude_unset=True)
    db_obj.sqlmodel_update(update_data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete(db: Session, *, id: int, empresa_id: int) -> Optional[PlanoContas]:
    """Remove uma categoria."""
    db_obj = get(db=db, id=id, empresa_id=empresa_id)
    if db_obj:
        db.delete(db_obj)
        db.commit()
    return db_obj

# --- SUA FUNÇÃO DE SEED (Mantida intacta) ---

def seed_plano_contas_padrao(db: Session, *, empresa_id: int, tipo_pessoa: str = "PJ"):
    """
    Cria plano de contas padrão completo e profissional.
    Baseado em melhores práticas de gestão financeira empresarial.
    Estrutura hierárquica que permite personalização por empresa.
    """
    if tipo_pessoa.upper() == "PF":
        plano_estrutura = {
            "1. RECEITAS": {
                "tipo": "R",
                "codigo": "1",
                "permite_lancamentos": False,
                "filhas": {
                    "1.1 Renda Principal": {
                        "tipo": "R",
                        "codigo": "1.1",
                        "permite_lancamentos": False,
                        "filhas": [
                            {"nome": "1.1.1 Salário", "tipo": "R", "codigo": "1.1.1"},
                            {"nome": "1.1.2 Pró-labore", "tipo": "R", "codigo": "1.1.2"},
                        ]
                    },
                    "1.2 Rendas Extras": {
                        "tipo": "R",
                        "codigo": "1.2",
                        "permite_lancamentos": False,
                        "filhas": [
                            {"nome": "1.2.1 Freelance", "tipo": "R", "codigo": "1.2.1"},
                            {"nome": "1.2.2 Rendimentos", "tipo": "R", "codigo": "1.2.2"},
                        ]
                    }
                }
            },
            "2. DESPESAS": {
                "tipo": "D",
                "codigo": "2",
                "permite_lancamentos": False,
                "filhas": {
                    "2.1 Moradia": {
                        "tipo": "D",
                        "codigo": "2.1",
                        "permite_lancamentos": False,
                        "filhas": [
                            {"nome": "2.1.1 Aluguel", "tipo": "D", "codigo": "2.1.1"},
                            {"nome": "2.1.2 Condomínio", "tipo": "D", "codigo": "2.1.2"},
                            {"nome": "2.1.3 Água e Luz", "tipo": "D", "codigo": "2.1.3"},
                        ]
                    },
                    "2.2 Alimentação": {
                        "tipo": "D",
                        "codigo": "2.2",
                        "permite_lancamentos": False,
                        "filhas": [
                            {"nome": "2.2.1 Mercado", "tipo": "D", "codigo": "2.2.1"},
                            {"nome": "2.2.2 Restaurantes", "tipo": "D", "codigo": "2.2.2"},
                        ]
                    },
                    "2.3 Transporte": {
                        "tipo": "D",
                        "codigo": "2.3",
                        "permite_lancamentos": False,
                        "filhas": [
                            {"nome": "2.3.1 Combustível", "tipo": "D", "codigo": "2.3.1"},
                            {"nome": "2.3.2 Uber/Taxi", "tipo": "D", "codigo": "2.3.2"},
                        ]
                    }
                }
            }
        }
    else:
        plano_estrutura = {
        "1. RECEITAS": {
            "tipo": "R",
            "codigo": "1",
            "permite_lancamentos": False,
            "filhas": {
                "1.1 Receitas Operacionais": {
                    "tipo": "R",
                    "codigo": "1.1",
                    "permite_lancamentos": False,
                    "filhas": {
                        "1.1.1 Vendas de Produtos": {
                            "tipo": "R",
                            "codigo": "1.1.1",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "1.1.1.1 Vendas de Produtos - Mercado Interno", "tipo": "R", "codigo": "1.1.1.1"},
                                {"nome": "1.1.1.2 Vendas de Produtos - Exportação", "tipo": "R", "codigo": "1.1.1.2"},
                                {"nome": "1.1.1.3 Vendas de Produtos - E-commerce", "tipo": "R", "codigo": "1.1.1.3"},
                            ]
                        },
                        "1.1.2 Vendas de Serviços": {
                            "tipo": "R",
                            "codigo": "1.1.2",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "1.1.2.1 Prestação de Serviços", "tipo": "R", "codigo": "1.1.2.1"},
                                {"nome": "1.1.2.2 Consultoria", "tipo": "R", "codigo": "1.1.2.2"},
                                {"nome": "1.1.2.3 Serviços de Manutenção", "tipo": "R", "codigo": "1.1.2.3"},
                                {"nome": "1.1.2.4 Serviços de Suporte Técnico", "tipo": "R", "codigo": "1.1.2.4"},
                            ]
                        },
                        "1.1.3 Receitas de Aluguel": {
                            "tipo": "R",
                            "codigo": "1.1.3",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "1.1.3.1 Aluguel de Imóveis", "tipo": "R", "codigo": "1.1.3.1"},
                                {"nome": "1.1.3.2 Aluguel de Equipamentos", "tipo": "R", "codigo": "1.1.3.2"},
                            ]
                        },
                        "1.1.4 Outras Receitas Operacionais": {
                            "tipo": "R",
                            "codigo": "1.1.4",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "1.1.4.1 Juros sobre Aplicações Financeiras", "tipo": "R", "codigo": "1.1.4.1"},
                                {"nome": "1.1.4.2 Descontos Obtidos", "tipo": "R", "codigo": "1.1.4.2"},
                                {"nome": "1.1.4.3 Multas e Juros Recebidos", "tipo": "R", "codigo": "1.1.4.3"},
                            ]
                        }
                    }
                },
                "1.2 Deduções de Receitas": {
                    "tipo": "R",
                    "codigo": "1.2",
                    "permite_lancamentos": False,
                    "filhas": [
                        {"nome": "1.2.1 Devoluções de Vendas", "tipo": "R", "codigo": "1.2.1"},
                        {"nome": "1.2.2 Cancelamentos de Vendas", "tipo": "R", "codigo": "1.2.2"},
                        {"nome": "1.2.3 Descontos Incondicionais Concedidos", "tipo": "R", "codigo": "1.2.3"},
                        {"nome": "1.2.4 Impostos sobre Vendas (ICMS, ISS, PIS, COFINS)", "tipo": "R", "codigo": "1.2.4"},
                    ]
                },
                "1.3 Receitas Não Operacionais": {
                    "tipo": "R",
                    "codigo": "1.3",
                    "permite_lancamentos": False,
                    "filhas": [
                        {"nome": "1.3.1 Ganhos com Venda de Ativos", "tipo": "R", "codigo": "1.3.1"},
                        {"nome": "1.3.2 Receitas de Equivalência Patrimonial", "tipo": "R", "codigo": "1.3.2"},
                        {"nome": "1.3.3 Outras Receitas Não Operacionais", "tipo": "R", "codigo": "1.3.3"},
                    ]
                }
            }
        },
        "2. DESPESAS": {
            "tipo": "D",
            "codigo": "2",
            "permite_lancamentos": False,
            "filhas": {
                "2.1 Custos de Produção/Serviços": {
                    "tipo": "D",
                    "codigo": "2.1",
                    "permite_lancamentos": False,
                    "filhas": {
                        "2.1.1 Custo de Mercadorias Vendidas (CMV)": {
                            "tipo": "D",
                            "codigo": "2.1.1",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.1.1.1 Compras de Mercadorias", "tipo": "D", "codigo": "2.1.1.1"},
                                {"nome": "2.1.1.2 Fretes sobre Compras", "tipo": "D", "codigo": "2.1.1.2"},
                                {"nome": "2.1.1.3 Estoque Inicial", "tipo": "D", "codigo": "2.1.1.3"},
                                {"nome": "2.1.1.4 Estoque Final", "tipo": "D", "codigo": "2.1.1.4"},
                            ]
                        },
                        "2.1.2 Custo de Serviços Prestados": {
                            "tipo": "D",
                            "codigo": "2.1.2",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.1.2.1 Materiais Consumidos", "tipo": "D", "codigo": "2.1.2.1"},
                                {"nome": "2.1.2.2 Subcontratações", "tipo": "D", "codigo": "2.1.2.2"},
                                {"nome": "2.1.2.3 Outros Custos Diretos", "tipo": "D", "codigo": "2.1.2.3"},
                            ]
                        }
                    }
                },
                "2.2 Despesas Operacionais": {
                    "tipo": "D",
                    "codigo": "2.2",
                    "permite_lancamentos": False,
                    "filhas": {
                        "2.2.1 Despesas com Pessoal": {
                            "tipo": "D",
                            "codigo": "2.2.1",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.1.1 Salários e Ordenados", "tipo": "D", "codigo": "2.2.1.1"},
                                {"nome": "2.2.1.2 Encargos Sociais (INSS, FGTS, etc)", "tipo": "D", "codigo": "2.2.1.2"},
                                {"nome": "2.2.1.3 13º Salário e Férias", "tipo": "D", "codigo": "2.2.1.3"},
                                {"nome": "2.2.1.4 Comissões e Bonificações", "tipo": "D", "codigo": "2.2.1.4"},
                                {"nome": "2.2.1.5 Vale Transporte", "tipo": "D", "codigo": "2.2.1.5"},
                                {"nome": "2.2.1.6 Vale Refeição/Alimentação", "tipo": "D", "codigo": "2.2.1.6"},
                                {"nome": "2.2.1.7 Plano de Saúde", "tipo": "D", "codigo": "2.2.1.7"},
                                {"nome": "2.2.1.8 Treinamentos e Desenvolvimento", "tipo": "D", "codigo": "2.2.1.8"},
                            ]
                        },
                        "2.2.2 Despesas Administrativas": {
                            "tipo": "D",
                            "codigo": "2.2.2",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.2.1 Aluguel e Condomínio", "tipo": "D", "codigo": "2.2.2.1"},
                                {"nome": "2.2.2.2 Energia Elétrica", "tipo": "D", "codigo": "2.2.2.2"},
                                {"nome": "2.2.2.3 Água e Esgoto", "tipo": "D", "codigo": "2.2.2.3"},
                                {"nome": "2.2.2.4 Telefonia e Internet", "tipo": "D", "codigo": "2.2.2.4"},
                                {"nome": "2.2.2.5 Material de Escritório", "tipo": "D", "codigo": "2.2.2.5"},
                                {"nome": "2.2.2.6 Serviços de Limpeza", "tipo": "D", "codigo": "2.2.2.6"},
                                {"nome": "2.2.2.7 Segurança e Vigilância", "tipo": "D", "codigo": "2.2.2.7"},
                                {"nome": "2.2.2.8 Manutenção Predial", "tipo": "D", "codigo": "2.2.2.8"},
                            ]
                        },
                        "2.2.3 Despesas Comerciais": {
                            "tipo": "D",
                            "codigo": "2.2.3",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.3.1 Propaganda e Publicidade", "tipo": "D", "codigo": "2.2.3.1"},
                                {"nome": "2.2.3.2 Marketing Digital", "tipo": "D", "codigo": "2.2.3.2"},
                                {"nome": "2.2.3.3 Feiras e Eventos", "tipo": "D", "codigo": "2.2.3.3"},
                                {"nome": "2.2.3.4 Material Promocional", "tipo": "D", "codigo": "2.2.3.4"},
                                {"nome": "2.2.3.5 Comissões de Vendas", "tipo": "D", "codigo": "2.2.3.5"},
                            ]
                        },
                        "2.2.4 Despesas Financeiras": {
                            "tipo": "D",
                            "codigo": "2.2.4",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.4.1 Juros sobre Empréstimos", "tipo": "D", "codigo": "2.2.4.1"},
                                {"nome": "2.2.4.2 Juros sobre Financiamentos", "tipo": "D", "codigo": "2.2.4.2"},
                                {"nome": "2.2.4.3 Juros sobre Cartão de Crédito", "tipo": "D", "codigo": "2.2.4.3"},
                                {"nome": "2.2.4.4 IOF e Tarifas Bancárias", "tipo": "D", "codigo": "2.2.4.4"},
                                {"nome": "2.2.4.5 Descontos Concedidos", "tipo": "D", "codigo": "2.2.4.5"},
                                {"nome": "2.2.4.6 Multas e Juros Pagos", "tipo": "D", "codigo": "2.2.4.6"},
                            ]
                        },
                        "2.2.5 Despesas com Tecnologia": {
                            "tipo": "D",
                            "codigo": "2.2.5",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.5.1 Software e Licenças", "tipo": "D", "codigo": "2.2.5.1"},
                                {"nome": "2.2.5.2 Serviços de Cloud/Hosting", "tipo": "D", "codigo": "2.2.5.2"},
                                {"nome": "2.2.5.3 Manutenção de Equipamentos", "tipo": "D", "codigo": "2.2.5.3"},
                                {"nome": "2.2.5.4 Consultoria em TI", "tipo": "D", "codigo": "2.2.5.4"},
                            ]
                        },
                        "2.2.6 Despesas com Impostos e Taxas": {
                            "tipo": "D",
                            "codigo": "2.2.6",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.6.1 Impostos Municipais (ISS)", "tipo": "D", "codigo": "2.2.6.1"},
                                {"nome": "2.2.6.2 Impostos Estaduais (ICMS)", "tipo": "D", "codigo": "2.2.6.2"},
                                {"nome": "2.2.6.3 Impostos Federais (IRPJ, CSLL)", "tipo": "D", "codigo": "2.2.6.3"},
                                {"nome": "2.2.6.4 Contribuições (PIS, COFINS)", "tipo": "D", "codigo": "2.2.6.4"},
                                {"nome": "2.2.6.5 Taxas e Contribuições", "tipo": "D", "codigo": "2.2.6.5"},
                            ]
                        },
                        "2.2.7 Despesas com Veículos": {
                            "tipo": "D",
                            "codigo": "2.2.7",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.7.1 Combustível", "tipo": "D", "codigo": "2.2.7.1"},
                                {"nome": "2.2.7.2 Manutenção de Veículos", "tipo": "D", "codigo": "2.2.7.2"},
                                {"nome": "2.2.7.3 Seguro de Veículos", "tipo": "D", "codigo": "2.2.7.3"},
                                {"nome": "2.2.7.4 IPVA e Licenciamento", "tipo": "D", "codigo": "2.2.7.4"},
                                {"nome": "2.2.7.5 Estacionamento e Pedágios", "tipo": "D", "codigo": "2.2.7.5"},
                            ]
                        },
                        "2.2.8 Despesas Diversas": {
                            "tipo": "D",
                            "codigo": "2.2.8",
                            "permite_lancamentos": False,
                            "filhas": [
                                {"nome": "2.2.8.1 Honorários Contábeis", "tipo": "D", "codigo": "2.2.8.1"},
                                {"nome": "2.2.8.2 Honorários Advocatícios", "tipo": "D", "codigo": "2.2.8.2"},
                                {"nome": "2.2.8.3 Consultorias Diversas", "tipo": "D", "codigo": "2.2.8.3"},
                                {"nome": "2.2.8.4 Despesas com Viagens", "tipo": "D", "codigo": "2.2.8.4"},
                                {"nome": "2.2.8.5 Despesas com Representação", "tipo": "D", "codigo": "2.2.8.5"},
                                {"nome": "2.2.8.6 Depreciação e Amortização", "tipo": "D", "codigo": "2.2.8.6"},
                            ]
                        }
                    }
                },
                "2.3 Despesas Não Operacionais": {
                    "tipo": "D",
                    "codigo": "2.3",
                    "permite_lancamentos": False,
                    "filhas": [
                        {"nome": "2.3.1 Perdas com Venda de Ativos", "tipo": "D", "codigo": "2.3.1"},
                        {"nome": "2.3.2 Despesas de Equivalência Patrimonial", "tipo": "D", "codigo": "2.3.2"},
                        {"nome": "2.3.3 Outras Despesas Não Operacionais", "tipo": "D", "codigo": "2.3.3"},
                    ]
                }
            }
        }
    }

    def criar_recursivo(estrutura, conta_pai_id=None):
        """
        Função recursiva para criar a estrutura hierárquica do plano de contas.
        Suporta dicionários (com filhas) e listas (folhas finais).
        """
        if isinstance(estrutura, list):
            # Lista de contas folha (sem subcontas)
            for item in estrutura:
                nc = PlanoContas(
                    nome=item["nome"],
                    tipo=item["tipo"],
                    codigo=item.get("codigo"),
                    empresa_id=empresa_id,
                    conta_pai_id=conta_pai_id,
                    permite_lancamentos=True
                )
                db.add(nc)
            return

        if isinstance(estrutura, dict):
            # Dicionário de contas (podem ter subcontas)
            for nome, dados in estrutura.items():
                # Determina se permite lançamentos (False se tiver filhas, True caso contrário)
                tem_filhas = 'filhas' in dados
                permite_lanc = dados.get("permite_lancamentos", not tem_filhas)
                
                nc = PlanoContas(
                    nome=nome,
                    tipo=dados["tipo"],
                    codigo=dados.get("codigo"),
                    empresa_id=empresa_id,
                    conta_pai_id=conta_pai_id,
                    permite_lancamentos=permite_lanc
                )
                db.add(nc)
                db.flush()  # Flush para obter o ID antes de criar as filhas
                
                # Cria recursivamente as contas filhas
                if tem_filhas:
                    criar_recursivo(dados['filhas'], nc.id)

    criar_recursivo(plano_estrutura)
    # Commit feito pelo caller (quem chamou a função)