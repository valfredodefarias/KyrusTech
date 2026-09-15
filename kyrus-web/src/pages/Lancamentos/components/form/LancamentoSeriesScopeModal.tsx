import React from 'react';

export type SeriesScopeOption = 'ESTA' | 'PROXIMAS' | 'TODAS' | null;

interface GenericConfirmModalProps {
  show: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const GenericConfirmModal: React.FC<GenericConfirmModalProps> = ({
  show,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  onConfirm,
  onCancel,
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
        <h3 className="font-extrabold text-xl text-slate-800 dark:text-white mb-2 tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition cursor-pointer border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition duration-150 cursor-pointer border-0 shadow-lg shadow-blue-500/10"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

interface EditSeriesScopeModalProps {
  show: boolean;
  onSelect: (scope: SeriesScopeOption) => void;
}

export const EditSeriesScopeModal: React.FC<EditSeriesScopeModalProps> = ({ show, onSelect }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => onSelect(null)} />
      <div className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
        <h3 className="font-extrabold text-xl text-slate-800 dark:text-white mb-2 tracking-tight">
          Aplicar alterações
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
          Você alterou campos que afetam a recorrência das parcelas. Escolha em qual escopo deseja aplicar estas alterações:
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onSelect('ESTA')}
            className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 transition duration-150 text-left flex justify-between items-center group cursor-pointer border-0"
          >
            <span>Só esta parcela</span>
            <span className="text-[10px] text-slate-400 group-hover:text-slate-300">Apenas a parcela atual</span>
          </button>
          <button
            type="button"
            onClick={() => onSelect('PROXIMAS')}
            className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 transition duration-150 text-left flex justify-between items-center group cursor-pointer border-0"
          >
            <span>Esta e as próximas</span>
            <span className="text-[10px] text-slate-400 group-hover:text-slate-300">Da atual em diante</span>
          </button>
          <button
            type="button"
            onClick={() => onSelect('TODAS')}
            className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition duration-150 text-left flex justify-between items-center group shadow-lg shadow-blue-500/10 cursor-pointer border-0"
          >
            <span>Todas as parcelas</span>
            <span className="text-[10px] text-blue-200 group-hover:text-white">A série completa</span>
          </button>
        </div>
        <div className="flex justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition cursor-pointer border-0"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeleteSeriesScopeModalProps {
  show: boolean;
  currentParcelaNumber: number;
  currentParcelaTotal: number;
  onSelect: (scope: SeriesScopeOption) => void;
}

export const DeleteSeriesScopeModal: React.FC<DeleteSeriesScopeModalProps> = ({
  show,
  currentParcelaNumber,
  currentParcelaTotal,
  onSelect,
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => onSelect(null)} />
      <div className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
        <h3 className="font-extrabold text-xl text-slate-800 dark:text-white mb-2 tracking-tight">
          Excluir Parcelas
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
          Este lançamento faz parte de uma série de <strong>{currentParcelaTotal} parcelas</strong> (você está na parcela {currentParcelaNumber}). Escolha o escopo da exclusão:
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onSelect('ESTA')}
            className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 transition duration-150 text-left flex justify-between items-center group cursor-pointer border-0"
          >
            <span>Só esta parcela ({currentParcelaNumber}/{currentParcelaTotal})</span>
            <span className="text-[10px] text-slate-400 group-hover:text-slate-300">Mantém as demais</span>
          </button>
          {currentParcelaNumber < currentParcelaTotal && (
            <button
              type="button"
              onClick={() => onSelect('PROXIMAS')}
              className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700/50 transition duration-150 text-left flex justify-between items-center group cursor-pointer"
            >
              <span>Esta e as próximas ({currentParcelaNumber} até {currentParcelaTotal})</span>
              <span className="text-[10px] text-amber-500">Mantém as anteriores</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelect('TODAS')}
            className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white transition duration-150 text-left flex justify-between items-center group shadow-lg shadow-rose-500/10 cursor-pointer border-0"
          >
            <span>Todas as parcelas da série</span>
            <span className="text-[10px] text-rose-200 group-hover:text-white">Exclui todas ({currentParcelaTotal}x)</span>
          </button>
        </div>
        <div className="flex justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition cursor-pointer border-0"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
