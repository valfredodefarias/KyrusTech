import React from 'react';
import { UploadCloud, Trash2, Download, Image as ImageIcon, FileSpreadsheet, Presentation, FileText } from 'lucide-react';
import type { Anexo } from '../../types';
import { resolveAnexoUrl } from '../../utils';

function getFileIcon(filename: string) {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '')) {
    return <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />;
  }
  if (['xls', 'xlsx', 'csv'].includes(ext || '')) {
    return <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />;
  }
  if (['ppt', 'pptx'].includes(ext || '')) {
    return <Presentation className="w-4 h-4 text-amber-500 shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-blue-500 shrink-0" />;
}

interface LancamentoAnexosSectionProps {
  anexos?: Anexo[];
  filesToUpload: FileList | null;
  onFilesSelected: (files: FileList | null) => void;
  onRemoverAnexo: (anexo: Anexo) => Promise<void>;
}

export const LancamentoAnexosSection: React.FC<LancamentoAnexosSectionProps> = ({
  anexos,
  filesToUpload,
  onFilesSelected,
  onRemoverAnexo,
}) => {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Anexos</label>

      {anexos && anexos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {anexos.map((anexo) => {
            const anexoUrl = resolveAnexoUrl(anexo.url);
            return (
              <div
                key={anexo.id}
                className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-xs group hover:border-blue-500 transition"
              >
                {getFileIcon(anexo.nome_arquivo)}
                <a
                  href={anexoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-slate-700 dark:text-slate-200 hover:text-blue-400 font-medium"
                >
                  {anexo.nome_arquivo}
                </a>
                <a
                  href={anexoUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-white rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                  title="Baixar anexo"
                >
                  <Download className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => void onRemoverAnexo(anexo)}
                  className="p-1 text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30"
                  title="Remover anexo"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-8 text-center hover:border-blue-500 relative cursor-pointer bg-slate-100 dark:bg-slate-800/40 hover:bg-slate-200 dark:hover:bg-slate-800 transition group shadow-sm">
        <input
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.ppt,.pptx"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={(e) => onFilesSelected(e.target.files)}
        />
        <UploadCloud className="w-10 h-10 mx-auto text-slate-500 mb-3 group-hover:text-blue-500 transition-colors" />
        <p className="text-base font-semibold text-slate-600 dark:text-slate-300">Arraste ou clique para anexar</p>
        <p className="text-xs text-slate-500 mt-1">PDF, Imagens, Excel, PowerPoint</p>
        <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-slate-600 dark:bg-slate-700 text-slate-100 text-sm font-bold group-hover:bg-blue-600 transition-colors">
          Selecionar arquivos
        </div>
        {filesToUpload && <p className="text-xs text-blue-400 font-bold mt-2">{filesToUpload.length} novos arquivos</p>}
      </div>
    </div>
  );
};
