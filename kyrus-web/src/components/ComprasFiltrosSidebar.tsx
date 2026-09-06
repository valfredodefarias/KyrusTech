import { Filter, X } from 'lucide-react';
import { MultiSelectDropdown } from './MultiSelectDropdown';

export interface ComprasFiltrosAvancados {
  fornecedores: Set<string>;
  status: Set<string>;
  tipos: Set<string>;
  centroCustoIds: Set<number>;
  dataInicio: string;
  dataFim: string;
}

interface ComprasFiltrosSidebarProps {
  showFiltrosSidebar: boolean;
  setShowFiltrosSidebar: (show: boolean) => void;
  filtrosAvancados: ComprasFiltrosAvancados;
  setFiltrosAvancados: React.Dispatch<React.SetStateAction<ComprasFiltrosAvancados>>;
  resetFiltros: () => void;
  fornecedoresList: string[];
  centrosCusto: any[];
}

export const ComprasFiltrosSidebar = ({
  showFiltrosSidebar,
  setShowFiltrosSidebar,
  filtrosAvancados,
  setFiltrosAvancados,
  resetFiltros,
  fornecedoresList,
  centrosCusto,
}: ComprasFiltrosSidebarProps) => {
  const statusOptions = [
    { id: 'ENTREGUE', nome: 'Entregue' },
    { id: 'AGUARDANDO_ENTREGA', nome: 'Aguardando Entrega' },
    { id: 'CANCELADO', nome: 'Cancelado' }
  ];

  const tipoOptions = [
    { id: 'ENCOMENDA', nome: 'Encomenda' },
    { id: 'ESTOQUE', nome: 'Estoque' },
    { id: 'DEMONSTRACAO', nome: 'Demonstração' }
  ];

  return (
    <>
      <button
        type="button"
        aria-label="Fechar painel de filtros"
        onClick={() => setShowFiltrosSidebar(false)}
        className={`fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-[1px] transition-opacity duration-200 ${
          showFiltrosSidebar ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed inset-y-0 right-0 w-80 xl:w-[min(34vw,560px)] xl:min-w-[380px] xl:max-w-[620px] bg-white dark:bg-slate-800 shadow-2xl z-[51] transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 ${
          showFiltrosSidebar ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
          <h3 className="font-bold flex gap-2 text-slate-800 dark:text-white">
            <Filter className="w-4 h-4 text-blue-500" /> Filtros Avançados
          </h3>
          <button onClick={() => setShowFiltrosSidebar(false)}>
            <X className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white" />
          </button>
        </div>
        <div className="p-4 space-y-6 overflow-y-auto h-[calc(100vh-60px)] custom-scrollbar">
          
          {/* Período */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Período de Vencimento
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white outline-none"
                value={filtrosAvancados.dataInicio}
                onChange={(e) =>
                  setFiltrosAvancados((prev) => ({ ...prev, dataInicio: e.target.value }))
                }
              />
              <input
                type="date"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white outline-none"
                value={filtrosAvancados.dataFim}
                onChange={(e) =>
                  setFiltrosAvancados((prev) => ({ ...prev, dataFim: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Fornecedores */}
          <div>
             <MultiSelectDropdown
                label="Fornecedores"
                placeholder="Selecione fornecedores..."
                options={fornecedoresList.map((f) => ({ id: f, nome: f }))}
                selectedIds={filtrosAvancados.fornecedores as any}
                onChange={(s: any) =>
                  setFiltrosAvancados((prev) => ({ ...prev, fornecedores: s }))
                }
              />
          </div>

          {/* Status */}
          <MultiSelectDropdown
            label="Status do Pedido"
            placeholder="Selecione os status..."
            options={statusOptions}
            selectedIds={filtrosAvancados.status as any}
            onChange={(s: any) =>
              setFiltrosAvancados((prev) => ({ ...prev, status: s }))
            }
          />

          {/* Tipo de Compra */}
          <MultiSelectDropdown
            label="Tipo de Compra"
            placeholder="Selecione os tipos..."
            options={tipoOptions}
            selectedIds={filtrosAvancados.tipos as any}
            onChange={(s: any) =>
              setFiltrosAvancados((prev) => ({ ...prev, tipos: s }))
            }
          />

          {/* Centro de custo */}
          <MultiSelectDropdown
            label="Centro de Custo"
            placeholder="Selecione centros de custo..."
            options={centrosCusto}
            selectedIds={filtrosAvancados.centroCustoIds as any}
            onChange={(s: any) =>
              setFiltrosAvancados((prev) => ({ ...prev, centroCustoIds: s }))
            }
          />

          <button
            onClick={resetFiltros}
            className="w-full py-2 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm mt-4 font-bold"
          >
            Limpar Filtros
          </button>
        </div>
      </div>
    </>
  );
};
