import React, { useState, useMemo, useEffect } from 'react';
import {
  UploadCloud,
  Trash2,
  Download,
  Eye,
  X,
  Image as ImageIcon,
  FileSpreadsheet,
  Presentation,
  FileText,
} from 'lucide-react';
import type { Anexo } from '../../types';
import { resolveAnexoUrl } from '../../utils';
import { AnexoPreviewModal } from './AnexoPreviewModal';

function getFileIcon(filename: string) {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext || '')) {
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

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface LancamentoAnexosSectionProps {
  anexos?: Anexo[];
  filesToUpload: FileList | File[] | null;
  onFilesSelected: (files: File[] | null) => void;
  onRemoverAnexo: (anexo: Anexo) => Promise<void>;
}

export const LancamentoAnexosSection: React.FC<LancamentoAnexosSectionProps> = ({
  anexos,
  filesToUpload,
  onFilesSelected,
  onRemoverAnexo,
}) => {
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    url: string;
    filename: string;
  }>({
    isOpen: false,
    url: '',
    filename: '',
  });

  // Converter filesToUpload para Array estável
  const fileArray = useMemo(() => {
    if (!filesToUpload) return [];
    return Array.from(filesToUpload);
  }, [filesToUpload]);

  // Gerar Object URLs temporárias para preview de imagens novas
  const stagedPreviews = useMemo(() => {
    return fileArray.map((file) => {
      const isImg = file.type.startsWith('image/');
      const objectUrl = URL.createObjectURL(file);
      return {
        file,
        name: file.name,
        size: file.size,
        isImg,
        objectUrl,
      };
    });
  }, [fileArray]);

  // Limpeza de Object URLs ao desmontar ou trocar arquivos
  useEffect(() => {
    return () => {
      stagedPreviews.forEach((item) => {
        if (item.objectUrl) {
          URL.revokeObjectURL(item.objectUrl);
        }
      });
    };
  }, [stagedPreviews]);

  const handleRemoveStagedFile = (indexToRemove: number) => {
    const updated = fileArray.filter((_, idx) => idx !== indexToRemove);
    onFilesSelected(updated.length > 0 ? updated : null);
  };

  const handleOpenPreview = (url: string, filename: string) => {
    setPreviewModal({
      isOpen: true,
      url,
      filename,
    });
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-bold text-slate-400 uppercase">
        Anexos e Documentos
      </label>

      {/* 1. ANEXOS EXISTENTES (JÁ SALVOS) */}
      {anexos && anexos.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Arquivos Salvos ({anexos.length})
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {anexos.map((anexo) => {
              const anexoUrl = resolveAnexoUrl(anexo.url);
              return (
                <div
                  key={anexo.id}
                  className="flex items-center gap-2 p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs group hover:border-blue-500 transition shadow-sm"
                >
                  {getFileIcon(anexo.nome_arquivo)}
                  <span
                    className="flex-1 truncate text-slate-700 dark:text-slate-200 font-medium cursor-pointer hover:text-blue-500"
                    title={anexo.nome_arquivo}
                    onClick={() => handleOpenPreview(anexoUrl, anexo.nome_arquivo)}
                  >
                    {anexo.nome_arquivo}
                  </span>

                  {/* Ações: Preview, Download, Delete */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenPreview(anexoUrl, anexo.nome_arquivo)}
                      className="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition"
                      title="Pré-visualizar anexo"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={anexoUrl}
                      download={anexo.nome_arquivo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                      title="Baixar anexo"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void onRemoverAnexo(anexo)}
                      className="p-1.5 text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 transition"
                      title="Remover anexo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. PRÉ-VISUALIZAÇÃO DE NOVOS ARQUIVOS SELECIONADOS (ANTES DE SALVAR) */}
      {stagedPreviews.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
            Prontos para Envio ({stagedPreviews.length})
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {stagedPreviews.map((staged, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2.5 p-2 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl text-xs relative group"
              >
                {/* Miniatura ou Ícone */}
                {staged.isImg ? (
                  <img
                    src={staged.objectUrl}
                    alt={staged.name}
                    className="w-10 h-10 object-cover rounded-lg shrink-0 border border-blue-200 dark:border-blue-700 cursor-pointer hover:opacity-90 shadow-sm"
                    onClick={() => handleOpenPreview(staged.objectUrl, staged.name)}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0 border border-blue-200 dark:border-blue-700">
                    {getFileIcon(staged.name)}
                  </div>
                )}

                {/* Nome e Tamanho */}
                <div className="flex-1 min-w-0">
                  <p
                    className="font-semibold text-slate-800 dark:text-slate-100 truncate cursor-pointer hover:text-blue-500"
                    title={staged.name}
                    onClick={() => handleOpenPreview(staged.objectUrl, staged.name)}
                  >
                    {staged.name}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatBytes(staged.size)}
                  </p>
                </div>

                {/* Botões de Ação na Fila */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenPreview(staged.objectUrl, staged.name)}
                    className="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition"
                    title="Pré-visualizar antes de salvar"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveStagedFile(idx)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 transition"
                    title="Remover arquivo da seleção"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. ZONA DE DROP / SELEÇÃO DE ARQUIVOS */}
      <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-6 text-center hover:border-blue-500 relative cursor-pointer bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition group shadow-sm">
        <input
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.ppt,.pptx"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              const incoming = Array.from(e.target.files);
              // Concatenar com arquivos já na fila
              onFilesSelected([...fileArray, ...incoming]);
            }
          }}
        />
        <UploadCloud className="w-9 h-9 mx-auto text-slate-400 mb-2 group-hover:text-blue-500 transition-colors" />
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
          Arraste ou clique para anexar arquivos
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          PDF, Imagens (PNG, JPG, WEBP), Excel ou PowerPoint
        </p>
        <div className="inline-flex items-center gap-2 mt-3 px-3.5 py-1.5 rounded-full bg-slate-700 text-slate-100 text-xs font-bold group-hover:bg-blue-600 transition-colors">
          Selecionar arquivos
        </div>
      </div>

      {/* MODAL DE PRÉ-VISUALIZAÇÃO */}
      <AnexoPreviewModal
        isOpen={previewModal.isOpen}
        onClose={() => setPreviewModal((prev) => ({ ...prev, isOpen: false }))}
        url={previewModal.url}
        filename={previewModal.filename}
      />
    </div>
  );
};
