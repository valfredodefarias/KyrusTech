import { useEffect, useState, useRef } from 'react';
import { ChevronDown, CheckSquare, Square } from 'lucide-react';

export interface MultiSelectDropdownOption {
  id: number | string;
  nome?: string;
  label?: string;
  disabled?: boolean;
  eh_cabecalho?: boolean;
  permite_lancamentos?: boolean;
  tipo?: string;
  grupo?: string;
}

export interface MultiSelectDropdownProps {
  options: MultiSelectDropdownOption[];
  selectedIds: Set<any>;
  onChange: (selected: Set<any>) => void;
  label?: string;
  placeholder?: string;
}

export function MultiSelectDropdown({
  options,
  selectedIds,
  onChange,
  label,
  placeholder
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

  const handleToggle = (id: number | string) => {
    const next = new Set<number | string>(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(next);
  };

  const selectedLabel = selectedIds.size > 0 ? `${selectedIds.size} selecionados` : placeholder;
  const term = search.trim().toLowerCase();
  const filteredOptions = term
    ? options.filter((opt) =>
      String(opt.nome || opt.label || '').toLowerCase().includes(term)
    )
    : options;

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {label && (
        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
          {label}
        </label>
      )}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 cursor-pointer flex justify-between items-center text-sm hover:border-blue-500 transition shadow-sm"
      >
        <span className={selectedIds.size > 0 ? 'text-blue-400 font-bold' : 'text-slate-500'}>
          {selectedLabel}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </div>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 shadow-xl dark:border-slate-600 dark:bg-slate-800 animate-in fade-in zoom-in-95">
          <div className="mb-2">
            <input
              autoFocus
              type="text"
              placeholder="Digite para pesquisar..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
            {filteredOptions.map((opt) => {
              const isDisabled =
                opt.disabled || opt.eh_cabecalho || opt.permite_lancamentos === false;
              const tipo = String(opt.tipo || opt.grupo || opt.label || opt.nome || '').toUpperCase();
              const colorClass = tipo.startsWith('D')
                ? 'text-red-400'
                : tipo.startsWith('R')
                  ? 'text-emerald-400'
                  : '';
              const isSelected = selectedIds.has(opt.id);
              return (
                <div
                  key={opt.id}
                  onClick={() => {
                    if (!isDisabled) handleToggle(opt.id);
                  }}
                  className={`px-3 py-2 text-sm rounded transition flex items-center justify-between ${isSelected
                      ? 'bg-blue-600/20 text-blue-600 dark:text-blue-300'
                      : `text-slate-600 dark:text-slate-300 ${colorClass}`
                    } ${isDisabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                >
                  <span>{opt.nome || opt.label}</span>
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-blue-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-600" />
                  )}
                </div>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500">Nenhuma opção encontrada.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
