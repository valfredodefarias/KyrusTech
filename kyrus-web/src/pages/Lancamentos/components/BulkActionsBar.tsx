import { CheckCircle2, Trash2, X } from 'lucide-react';

interface BulkActionsBarProps {
  selectedIds: Set<number>;
  setShowBulkPay: (show: boolean) => void;
  openBulkDelete: () => void;
  setSelectedIds: (ids: Set<number>) => void;
}

export const BulkActionsBar = ({
  selectedIds,
  setShowBulkPay,
  openBulkDelete,
  setSelectedIds,
}: BulkActionsBarProps) => {
  if (selectedIds.size === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="px-3 py-1 rounded-full bg-blue-600/20 text-blue-600 dark:text-blue-300 text-xs font-bold border border-blue-500/30">
          {selectedIds.size} selecionado(s)
        </div>
        <button
          onClick={() => setShowBulkPay(true)}
          className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 shadow flex items-center gap-1.5 transition-colors"
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Baixar
        </button>
        <button
          onClick={openBulkDelete}
          className="px-3 py-1.5 rounded-full bg-red-600 text-white text-xs font-bold hover:bg-red-500 shadow flex items-center gap-1.5 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Apagar
        </button>
        <button
          onClick={() => setSelectedIds(new Set())}
          className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors"
        >
          <X className="w-3.5 h-3.5" /> Limpar
        </button>
      </div>
    </div>
  );
};
