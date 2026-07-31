import React from 'react';
import { AlertTriangle, ArrowDown, X } from 'lucide-react';

interface OfxToastErrorProps {
  message: string;
  errorLineIndex?: number | null;
  onClose: () => void;
  onScrollToLine?: (lineIndex: number) => void;
}

export const OfxToastError: React.FC<OfxToastErrorProps> = ({
  message,
  errorLineIndex,
  onClose,
  onScrollToLine,
}) => {
  return (
    <div className="fixed bottom-20 right-6 z-50 max-w-md w-full bg-rose-900/95 text-white p-4 rounded-2xl shadow-2xl border border-rose-700 backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-rose-200 font-bold text-sm">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          Atenção Necessária
        </div>
        <button
          onClick={onClose}
          className="text-rose-300 hover:text-white transition-colors p-1 rounded-lg hover:bg-rose-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-rose-100 mt-2 leading-relaxed font-medium">{message}</p>

      {errorLineIndex != null && onScrollToLine && (
        <button
          onClick={() => onScrollToLine(errorLineIndex)}
          className="mt-3 w-full py-2 px-3 bg-rose-800 hover:bg-rose-700 text-rose-100 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          Ir Direto para o Item com Erro (Linha #{errorLineIndex})
        </button>
      )}
    </div>
  );
};
