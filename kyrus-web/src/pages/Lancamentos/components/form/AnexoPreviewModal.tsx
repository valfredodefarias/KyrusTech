import React, { useEffect } from 'react';
import { X, Download, ExternalLink, FileText, Image as ImageIcon, FileSpreadsheet, Presentation } from 'lucide-react';

interface AnexoPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  filename: string;
}

export const AnexoPreviewModal: React.FC<AnexoPreviewModalProps> = ({
  isOpen,
  onClose,
  url,
  filename,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !url) return null;

  const ext = filename?.split('.').pop()?.toLowerCase() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext);
  const isPdf = ext === 'pdf';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[85vh] max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-4">
            {isImage ? (
              <ImageIcon className="w-5 h-5 text-emerald-500 shrink-0" />
            ) : isPdf ? (
              <FileText className="w-5 h-5 text-blue-500 shrink-0" />
            ) : (
              <FileSpreadsheet className="w-5 h-5 text-amber-500 shrink-0" />
            )}
            <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate" title={filename}>
              {filename}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60 transition"
              title="Abrir em nova aba"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <a
              href={url}
              download={filename}
              className="p-2 text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60 transition"
              title="Baixar arquivo"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60 transition ml-1"
              title="Fechar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 bg-slate-100 dark:bg-slate-950 flex items-center justify-center overflow-auto p-4">
          {isImage ? (
            <div className="flex items-center justify-center w-full h-full">
              <img
                src={url}
                alt={filename}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={url}
              title={filename}
              className="w-full h-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white"
            />
          ) : (
            <div className="text-center p-8 max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-center mx-auto">
                <Presentation className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-100 text-base">{filename}</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Este formato de arquivo não suporta visualização direta no navegador.
                </p>
              </div>
              <a
                href={url}
                download={filename}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-lg transition"
              >
                <Download className="w-4 h-4" />
                Baixar Arquivo
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
