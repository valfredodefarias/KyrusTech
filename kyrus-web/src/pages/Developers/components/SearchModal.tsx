// kyrus-web/src/pages/Developers/components/SearchModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Search, BookOpen, Layers, X, ArrowRight } from 'lucide-react';
import type { GuideItem, ParsedEndpoint } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  guides: GuideItem[];
  endpoints: ParsedEndpoint[];
  onSelectGuide: (guideId: string) => void;
  onSelectEndpoint: (endpoint: ParsedEndpoint) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  guides,
  endpoints,
  onSelectGuide,
  onSelectEndpoint,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Captura tecla ESC para fechar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const cleanQuery = query.trim().toLowerCase();

  const matchedGuides = cleanQuery
    ? guides.filter(
        (g) =>
          g.title.toLowerCase().includes(cleanQuery) ||
          g.summary.toLowerCase().includes(cleanQuery)
      )
    : guides.slice(0, 4);

  const matchedEndpoints = cleanQuery
    ? endpoints.filter(
        (ep) =>
          ep.path.toLowerCase().includes(cleanQuery) ||
          ep.summary.toLowerCase().includes(cleanQuery) ||
          ep.tag.toLowerCase().includes(cleanQuery) ||
          ep.method.toLowerCase().includes(cleanQuery)
      )
    : endpoints.slice(0, 6);

  const getMethodBadgeClass = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
      case 'POST':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300';
      case 'PUT':
      case 'PATCH':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300';
      case 'DELETE':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        {/* Input Bar */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-slate-400 shrink-0 ml-1" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar endpoints, parâmetros, guias ou conceitos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs custom-scrollbar">
          {/* Guias */}
          {matchedGuides.length > 0 ? (
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                <span>Guias & Tutoriais</span>
              </span>
              {matchedGuides.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onSelectGuide(g.id);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition group"
                >
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{g.title}</p>
                    <p className="text-[11px] text-slate-500 line-clamp-1">{g.summary}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500 group-hover:translate-x-1 transition" />
                </button>
              ))}
            </div>
          ) : null}

          {/* Endpoints */}
          {matchedEndpoints.length > 0 ? (
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3" />
                <span>Endpoints da API</span>
              </span>
              {matchedEndpoints.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => {
                    onSelectEndpoint(ep);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition group"
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0 pr-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-tight shrink-0 ${getMethodBadgeClass(
                        ep.method
                      )}`}
                    >
                      {ep.method}
                    </span>
                    <div className="truncate">
                      <p className="font-bold text-slate-900 dark:text-white truncate">
                        {ep.summary}
                      </p>
                      <p className="text-[10px] font-mono text-slate-400 truncate">{ep.path}</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                    {ep.tag}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {matchedGuides.length === 0 && matchedEndpoints.length === 0 ? (
            <div className="py-12 text-center text-slate-400 italic">
              Nenhum resultado encontrado para "{query}".
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
