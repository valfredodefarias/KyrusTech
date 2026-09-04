import re

with open(r'c:\Users\Ciro\Documents\ERP\KyrusERP\kyrus-web\src\pages\PDV.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_customer_select = """function SearchableCustomerSelect({
  customers,
  selectedValue,
  onChange,
  onCreateClick,
  placeholder = 'Selecione um cliente'
}: {
  customers: any[];
  selectedValue: string | number;
  onChange: (customerId: number) => void;
  onCreateClick: () => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedCustomer = customers.find((c) => String(c.id) === String(selectedValue));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = customers.filter((c) => {
    const s = search.toLowerCase();
    const nameMatch = decodeHtmlSimple(c.nome).toLowerCase().includes(s);
    const cpfMatch = (c.cpf_cnpj || '').replace(/\\D/g, '').includes(s.replace(/\\D/g, ''));
    return nameMatch || cpfMatch;
  });

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        id="customer-search-select-trigger"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(true); }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      >
        <span className={selectedCustomer ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-400'}>
          {selectedCustomer
            ? `${decodeHtmlSimple(selectedCustomer.nome)} ${selectedCustomer.cpf_cnpj ? `(${selectedCustomer.cpf_cnpj})` : ''}`
            : placeholder}
        </span>
        <span className="text-slate-400 text-xs">▼</span>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-950">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome ou CPF..."
            className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            onClick={(e) => e.stopPropagation()}
          />
          <div
            onClick={(e) => {
              e.stopPropagation();
              onCreateClick();
              setIsOpen(false);
            }}
            className="cursor-pointer rounded-lg px-3 py-2 text-xs transition bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 mb-2 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            + Criar Novo Cliente
          </div>
          
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado</div>
          ) : (
            filtered.map((cust) => (
              <div
                key={cust.id}
                onClick={() => {
                  onChange(cust.id);
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`cursor-pointer rounded-lg px-3 py-2 text-xs transition hover:bg-slate-100 dark:hover:bg-slate-900 ${
                  String(cust.id) === String(selectedValue)
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {decodeHtmlSimple(cust.nome)} {cust.cpf_cnpj ? `- ${cust.cpf_cnpj}` : ''}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}"""

new_customer_select = """function SearchableCustomerSelect({
  customers,
  selectedValue,
  onChange,
  onCreateClick,
  placeholder = 'Selecione um cliente'
}: {
  customers: any[];
  selectedValue: string | number;
  onChange: (customerId: number | null) => void;
  onCreateClick: () => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedCustomer = customers.find((c) => String(c.id) === String(selectedValue));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = customers.filter((c) => {
    const s = search.toLowerCase();
    const nameMatch = c.nome ? decodeHtmlSimple(c.nome).toLowerCase().includes(s) : false;
    const searchCpf = s.replace(/\\D/g, '');
    const cpfMatch = searchCpf ? (c.cpf_cnpj || '').replace(/\\D/g, '').includes(searchCpf) : false;
    return nameMatch || cpfMatch;
  });

  const displayValue = isOpen 
    ? search 
    : (selectedCustomer 
        ? `${decodeHtmlSimple(selectedCustomer.nome)} ${selectedCustomer.cpf_cnpj ? `(${selectedCustomer.cpf_cnpj})` : ''}` 
        : '');

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        className={`flex w-full cursor-text items-center justify-between rounded-xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 focus:border-blue-500 dark:bg-slate-950 dark:text-white ${isOpen ? 'border-blue-500 ring-1 ring-blue-500/20 dark:border-blue-500' : 'border-slate-300 dark:border-slate-700'}`}
        onClick={() => {
          if (!isOpen) {
            setIsOpen(true);
            setSearch('');
          }
        }}
      >
        <input
          id="customer-search-select-trigger"
          type="text"
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
             if (!isOpen) {
               setIsOpen(true);
               setSearch('');
             }
          }}
          className="w-full bg-transparent outline-none placeholder:text-slate-400"
        />
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {selectedCustomer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                setSearch('');
                setIsOpen(false);
              }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-slate-400 text-xs cursor-pointer" onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}>▼</span>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-950">
          <div
            onClick={(e) => {
              e.stopPropagation();
              onCreateClick();
              setIsOpen(false);
              setSearch('');
            }}
            className="cursor-pointer rounded-lg px-3 py-2 text-xs transition bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 mb-2 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            + Criar Novo Cliente
          </div>
          
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado</div>
          ) : (
            filtered.map((cust) => (
              <div
                key={cust.id}
                onClick={() => {
                  onChange(cust.id);
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`cursor-pointer rounded-lg px-3 py-2 text-xs transition hover:bg-slate-100 dark:hover:bg-slate-900 ${
                  String(cust.id) === String(selectedValue)
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {decodeHtmlSimple(cust.nome)} {cust.cpf_cnpj ? `- ${cust.cpf_cnpj}` : ''}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}"""

old_normalized = re.sub(r'\r\n?', '\n', old_customer_select)
content_normalized = re.sub(r'\r\n?', '\n', content)

if old_normalized in content_normalized:
    content_normalized = content_normalized.replace(old_normalized, new_customer_select)
    with open(r'c:\Users\Ciro\Documents\ERP\KyrusERP\kyrus-web\src\pages\PDV.tsx', 'w', encoding='utf-8', newline='\n') as f:
        f.write(content_normalized)
    print("Replaced successfully")
else:
    print("Pattern not found. Checking if partial match exists...")
    idx = content_normalized.find('function SearchableCustomerSelect')
    print("Index found:", idx)
