import { useEffect, useState, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SearchableSelectOption {
  id: number | string;
  label: string;
  disabled?: boolean;
  eh_cabecalho?: boolean;
  permite_lancamentos?: boolean;
  tipo?: string;
  grupo?: string;
}

export interface SearchableSelectGroup {
  label: string;
  options: SearchableSelectOption[];
}

export interface SearchableSelectProps {
  options: SearchableSelectGroup[];
  value: number | string | null;
  onChange: (value: number | string) => void;
  placeholder?: string;
  label?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecione...',
  label
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options
    .flatMap((g) => g.options)
    .find((o) => String(o.id) === String(value));
  
  const selectedTipo = String(selectedOption?.tipo || selectedOption?.grupo || '').toUpperCase();
  const selectedColorClass = !selectedOption
    ? 'text-slate-500'
    : selectedTipo.startsWith('D')
    ? 'text-red-600 dark:text-red-400 font-medium'
    : selectedTipo.startsWith('R')
    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
    : 'text-slate-800 dark:text-white font-medium';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredGroups = options
    .map((group) => ({
      ...group,
      options: group.options.filter((opt) =>
        opt.label.toLowerCase().includes(search.toLowerCase())
      )
    }))
    .filter((group) => group.options.length > 0);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {label && (
        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
          {label}
        </label>
      )}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 cursor-pointer flex justify-between items-center text-sm min-h-11.5 hover:border-blue-500 transition shadow-sm"
      >
        <span className={selectedColorClass}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl shadow-2xl max-h-96 flex flex-col animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 rounded-t-xl">
            <input
              autoFocus
              type="text"
              placeholder="Pesquisar..."
              className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none text-slate-700 dark:text-white focus:border-blue-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-y-auto custom-scrollbar p-1">
            {filteredGroups.map((group, idx) => (
              <div key={idx} className="mb-2">
                <div className="px-3 py-1.5 text-[10px] font-bold text-blue-300 uppercase tracking-wider bg-slate-700/30 rounded mb-1 pointer-events-none select-none">
                  {group.label}
                </div>
                {group.options.map((opt) => {
                  const isDisabled =
                    opt.disabled || opt.eh_cabecalho || opt.permite_lancamentos === false;
                  const tipo = String(opt.tipo || opt.grupo || opt.label || '').toUpperCase();
                  const colorClass = tipo.startsWith('D')
                    ? 'text-red-400'
                    : tipo.startsWith('R')
                    ? 'text-emerald-400'
                    : '';
                  return (
                    <div
                      key={opt.id}
                      onClick={() => {
                        if (!isDisabled) {
                          onChange(opt.id);
                          setIsOpen(false);
                          setSearch('');
                        }
                      }}
                      className={`px-3 py-2 text-sm rounded transition flex items-center justify-between ${
                        String(value) === String(opt.id)
                          ? 'bg-blue-600 text-white'
                          : `text-slate-600 dark:text-slate-300 ${colorClass}`
                      } ${
                        isDisabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {opt.label}
                      {String(value) === String(opt.id) && <Check className="w-3 h-3" />}
                    </div>
                  );
                })}
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <div className="p-4 text-center text-xs text-slate-500">Nada encontrado.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default SearchableSelect;
