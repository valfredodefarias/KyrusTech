import { Filter, X } from 'lucide-react';
import { BankAvatar } from './BrandAvatar';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { toPublicAssetUrl } from '../services/api';

export interface BoletimFiltrosAvancados {
  categoriaIds: Set<number>;
  contaIds: Set<number>;
  interessados: Set<string>;
  dataInicio: string;
  dataFim: string;
}

interface FiltrosSidebarBoletimProps {
  showFiltrosSidebar: boolean;
  setShowFiltrosSidebar: (show: boolean) => void;
  filtrosAvancados: BoletimFiltrosAvancados;
  setFiltrosAvancados: React.Dispatch<React.SetStateAction<BoletimFiltrosAvancados>>;
  resetFiltros: () => void;
  categorias: any[];
  contas: any[];
  interessadosList: string[];
}

export const BoletimFiltrosSidebar = ({
  showFiltrosSidebar,
  setShowFiltrosSidebar,
  filtrosAvancados,
  setFiltrosAvancados,
  resetFiltros,
  categorias,
  contas,
  interessadosList,
}: FiltrosSidebarBoletimProps) => {
  const getFullLogoUrl = (url?: string | null) => toPublicAssetUrl(url);

  const contasAtivas = contas.filter(
    (conta) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO'
  );

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
          
          {/* Período Personalizado */}
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

          {/* Categorias */}
          <MultiSelectDropdown
            label="Categorias"
            placeholder="Selecione categorias..."
            options={categorias}
            selectedIds={filtrosAvancados.categoriaIds}
            onChange={(s: any) =>
              setFiltrosAvancados((prev) => ({ ...prev, categoriaIds: s }))
            }
          />

          {/* Interessados */}
          <div>
             <MultiSelectDropdown
                label="Interessados"
                placeholder="Selecione interessados..."
                options={interessadosList.map((interessado) => ({ id: interessado, nome: interessado }))}
                selectedIds={filtrosAvancados.interessados as any}
                onChange={(s: any) =>
                  setFiltrosAvancados((prev) => ({ ...prev, interessados: s }))
                }
              />
          </div>

          {/* Contas / Bancos */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Contas / Bancos
            </label>
            <div className="flex flex-wrap gap-2">
              {contasAtivas.map((c) => {
                const active = filtrosAvancados.contaIds.has(c.id);
                const logo = getFullLogoUrl(c.logo_url);
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      const newSet = new Set(filtrosAvancados.contaIds);
                      if (active) newSet.delete(c.id);
                      else newSet.add(c.id);
                      setFiltrosAvancados((prev) => ({ ...prev, contaIds: newSet }));
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 ${
                      active
                        ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border-emerald-600'
                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <BankAvatar
                      logoUrl={logo}
                      bankName={c.banco}
                      accountName={c.nome}
                      integrationType={c.tipo_integracao}
                      size="sm"
                      className="h-4 w-4"
                      imageClassName="rounded-full"
                      fallbackClassName="rounded-full border-0 shadow-none"
                    />
                    {c.nome}
                  </button>
                );
              })}
            </div>
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
