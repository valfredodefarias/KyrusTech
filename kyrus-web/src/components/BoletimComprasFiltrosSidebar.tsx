import { Filter, X } from 'lucide-react';
import { MultiSelectDropdown } from './MultiSelectDropdown';

export interface BoletimComprasFiltrosAvancados {
  status: Set<string>;
  fornecedores: Set<string>;
  centroCustos: Set<number>;
  dataInicio: string;
  dataFim: string;
}

interface FiltrosSidebarBoletimComprasProps {
  showSidebar: boolean;
  setShowSidebar: (show: boolean) => void;
  filtros: BoletimComprasFiltrosAvancados;
  setFiltros: React.Dispatch<React.SetStateAction<BoletimComprasFiltrosAvancados>>;
  resetFiltros: () => void;
  fornecedoresList: string[];
  centroCustosList: { id: number; nome: string }[];
}

const STATUS_OPTIONS = [
  { id: 'ENTREGUE', nome: 'Entregue' },
  { id: 'AGUARDANDO_PAGAMENTO', nome: 'Aguardando Pagamento' },
];

export const BoletimComprasFiltrosSidebar = ({
  showSidebar,
  setShowSidebar,
  filtros,
  setFiltros,
  resetFiltros,
  fornecedoresList,
  centroCustosList,
}: FiltrosSidebarBoletimComprasProps) => {
  return (
    <>
      <button
        type="button"
        aria-label="Fechar painel de filtros"
        onClick={() => setShowSidebar(false)}
        className={`fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-[1px] transition-opacity duration-200 ${
          showSidebar ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed inset-y-0 right-0 w-80 xl:w-[min(34vw,560px)] xl:min-w-[380px] xl:max-w-[620px] bg-white dark:bg-slate-800 shadow-2xl z-[51] transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 ${
          showSidebar ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
          <h3 className="font-bold flex gap-2 text-slate-800 dark:text-white">
            <Filter className="w-4 h-4 text-emerald-500" /> Filtros Avançados (Compras)
          </h3>
          <button onClick={() => setShowSidebar(false)}>
            <X className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white" />
          </button>
        </div>
        <div className="p-4 space-y-6 overflow-y-auto h-[calc(100vh-60px)] custom-scrollbar">
          
          {/* Período Personalizado */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Período de Vencimento
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white outline-none"
                value={filtros.dataInicio}
                onChange={(e) =>
                  setFiltros((prev) => ({ ...prev, dataInicio: e.target.value }))
                }
              />
              <input
                type="date"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white outline-none"
                value={filtros.dataFim}
                onChange={(e) =>
                  setFiltros((prev) => ({ ...prev, dataFim: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Status */}
          <MultiSelectDropdown
            label="Status"
            placeholder="Selecione o status..."
            options={STATUS_OPTIONS}
            selectedIds={filtros.status as any}
            onChange={(s: any) =>
              setFiltros((prev) => ({ ...prev, status: s }))
            }
          />

          {/* Fornecedores */}
          <div>
             <MultiSelectDropdown
                label="Fornecedores (Emitentes)"
                placeholder="Selecione fornecedores..."
                options={fornecedoresList.map((interessado) => ({ id: interessado, nome: interessado }))}
                selectedIds={filtros.fornecedores as any}
                onChange={(s: any) =>
                  setFiltros((prev) => ({ ...prev, fornecedores: s }))
                }
              />
          </div>

          {/* Centros de Custo */}
          <div>
            <MultiSelectDropdown
              label="Centros de Custo"
              placeholder="Selecione centros de custo..."
              options={centroCustosList.map((cc) => ({ id: cc.id, nome: cc.nome }))}
              selectedIds={filtros.centroCustos as any}
              onChange={(s: any) => setFiltros((prev) => ({ ...prev, centroCustos: s }))}
            />
          </div>

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
