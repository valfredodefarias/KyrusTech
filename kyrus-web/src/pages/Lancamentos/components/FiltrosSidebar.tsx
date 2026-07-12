import { Filter, X, CalendarClock, AlertCircle, CheckCircle2, Layers, LayoutGrid } from 'lucide-react';
import { BankAvatar } from '../../../components/BrandAvatar';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { toPublicAssetUrl } from '../../../services/api';

interface FiltrosSidebarProps {
  showFiltrosSidebar: boolean;
  setShowFiltrosSidebar: (show: boolean) => void;
  filtrosAvancados: {
    tipo: 'TODOS' | 'RECEITA' | 'DESPESA';
    status: string[];
    contaIds: Set<number>;
    categoriaIds: Set<number>;
    centroCustoPresenca: 'TODOS' | 'COM' | 'SEM';
    dataModo: 'VENCIMENTO' | 'PAGAMENTO';
    dataInicio: string;
    dataFim: string;
    ocultarVendasCartaoPendentes: boolean;
  };
  setFiltrosAvancados: React.Dispatch<React.SetStateAction<any>>;
  isQuickFilterActive: (id: string | null) => boolean;
  handleQuickFilterClick: (id: string | null) => void;
  resetFiltros: () => void;
  categorias: any[];
  contas: any[];
  centros: any[];
  centroCustoFiltro: string;
  setCentroCustoFiltro: React.Dispatch<React.SetStateAction<string>>;
  contaExtratoAtivaId: number | null;
  setContaExtratoAtivaId: (id: number | null) => void;
}

export const FiltrosSidebar = ({
  showFiltrosSidebar,
  setShowFiltrosSidebar,
  filtrosAvancados,
  setFiltrosAvancados,
  isQuickFilterActive,
  handleQuickFilterClick,
  resetFiltros,
  categorias,
  contas,
  centros,
  centroCustoFiltro,
  setCentroCustoFiltro,
  contaExtratoAtivaId,
  setContaExtratoAtivaId,
}: FiltrosSidebarProps) => {
  const getFullLogoUrl = (url?: string | null) => toPublicAssetUrl(url);

  const contasAtivas = contas.filter(
    (conta) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO'
  );

  const quickFilterOptions = [
    { id: null, label: 'Todos' },
    { id: 'HOJE', label: 'Vcto Hoje', icon: CalendarClock },
    { id: 'AMANHA', label: 'Vcto Amanhã', icon: CalendarClock },
    { id: 'ATRASADO', label: 'Atrasados', icon: AlertCircle },
    { id: 'PAGO', label: 'Pagos', icon: CheckCircle2 },
    { id: 'NAO_PAGO', label: 'Não pagos', icon: Layers },
    { id: 'IPP', label: 'IPP', icon: LayoutGrid },
    { id: 'EM_ABERTO', label: 'Em Aberto', icon: Layers },
    { id: 'ENTRADAS', label: 'Entradas', icon: CheckCircle2 },
    { id: 'SAIDAS', label: 'Saídas', icon: AlertCircle },
  ];

  return (
    <>
      <button
        type="button"
        aria-label="Fechar painel de filtros"
        onClick={() => setShowFiltrosSidebar(false)}
        className={`fixed inset-0 z-20 bg-slate-900/20 backdrop-blur-[1px] transition-opacity duration-200 ${showFiltrosSidebar ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />
      <div
        className={`fixed inset-y-0 right-0 w-80 xl:w-[min(34vw,560px)] xl:min-w-[380px] xl:max-w-[620px] bg-white dark:bg-slate-800 shadow-2xl z-[22] transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 ${showFiltrosSidebar ? 'translate-x-0' : 'translate-x-full'}`}
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
          {/* Centro de Custo */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Centro de Custo
            </label>
            <select
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              value={centroCustoFiltro}
              onChange={(e) => setCentroCustoFiltro(e.target.value)}
            >
              <option value="">Todos os centros de custo</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Tipo */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Tipo de Lançamento
            </label>
            <div className="flex gap-2">
              {['TODOS', 'RECEITA', 'DESPESA'].map((t) => (
                <button
                  key={t}
                  onClick={() => setFiltrosAvancados((prev: any) => ({ ...prev, tipo: t as any }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${filtrosAvancados.tipo === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Situação rápida
            </label>
            <div className="grid grid-cols-2 gap-2">
              {quickFilterOptions.map((f) => (
                <button
                  key={String(f.id)}
                  onClick={() => handleQuickFilterClick(f.id as string | null)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition ${f.id === null ? 'col-span-2' : ''} ${isQuickFilterActive(f.id as string | null) ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  {f.icon && <f.icon className="w-3 h-3" />}
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Período Personalizado
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white outline-none"
                value={filtrosAvancados.dataInicio}
                onChange={(e) => setFiltrosAvancados((prev: any) => ({ ...prev, dataInicio: e.target.value }))}
              />
              <input
                type="date"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white outline-none"
                value={filtrosAvancados.dataFim}
                onChange={(e) => setFiltrosAvancados((prev: any) => ({ ...prev, dataFim: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Filtrar datas por
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'VENCIMENTO', label: 'Vencimento' },
                { id: 'PAGAMENTO', label: 'Pagamento' },
              ].map((modo) => (
                <button
                  key={modo.id}
                  onClick={() =>
                    setFiltrosAvancados((prev: any) => ({ ...prev, dataModo: modo.id as 'VENCIMENTO' | 'PAGAMENTO' }))
                  }
                  className={`py-2 rounded-lg text-xs font-bold border transition ${filtrosAvancados.dataModo === modo.id ? 'bg-cyan-600 text-white border-cyan-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  {modo.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
              Centro de custo no lançamento
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'TODOS', label: 'Todos' },
                { id: 'COM', label: 'Com CC' },
                { id: 'SEM', label: 'Sem CC' },
              ].map((opcao) => (
                <button
                  key={opcao.id}
                  onClick={() =>
                    setFiltrosAvancados((prev: any) => ({
                      ...prev,
                      centroCustoPresenca: opcao.id as 'TODOS' | 'COM' | 'SEM',
                    }))
                  }
                  className={`py-2 rounded-lg text-xs font-bold border transition ${filtrosAvancados.centroCustoPresenca === opcao.id ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  {opcao.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtro Contas como Botões (Chips) */}
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
                      setFiltrosAvancados((prev: any) => ({ ...prev, contaIds: newSet }));
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 ${active ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border-emerald-600' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
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

          {/* Ocultar vendas de cartão pendentes */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
            <div className="flex flex-col pr-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Ocultar vendas de cartão pendentes
              </span>
              <span className="text-[10px] text-slate-400">
                Remove vendas PDV em aberto do extrato/lançamentos
              </span>
            </div>
            <input
              type="checkbox"
              className="h-4.5 w-4.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              checked={filtrosAvancados.ocultarVendasCartaoPendentes}
              onChange={(e) => setFiltrosAvancados((prev: any) => ({ ...prev, ocultarVendasCartaoPendentes: e.target.checked }))}
            />
          </div>

          <MultiSelectDropdown
            label="Categorias"
            placeholder="Selecione categorias..."
            options={categorias}
            selectedIds={filtrosAvancados.categoriaIds}
            onChange={(s: any) => setFiltrosAvancados((prev: any) => ({ ...prev, categoriaIds: s }))}
          />

          {contaExtratoAtivaId !== null && (
            <button
              onClick={() => setContaExtratoAtivaId(null)}
              className="flex w-full items-center justify-between rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-left text-xs font-bold text-cyan-700 dark:border-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-300"
            >
              <span>
                Extrato filtrado:{' '}
                {contas.find((c) => Number(c.id) === contaExtratoAtivaId)?.nome || `Conta ${contaExtratoAtivaId}`}
              </span>
              <X className="h-3.5 w-3.5" />
            </button>
          )}

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
