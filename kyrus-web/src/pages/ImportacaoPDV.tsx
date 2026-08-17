import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ExcelJS from 'exceljs';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  UploadCloud,
  Users,
  Settings,
  HelpCircle,
  Plus,
  Trash2,
  RefreshCw,
  Info
} from 'lucide-react';

import { api, normalizeListResponse } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { useAuthStore } from '../store/authStore';
import { SearchableSelect } from '../components/SearchableSelect';

// --- INTERFACES ---
interface CustomFieldConfig {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  regex?: string;
  depends_on?: { field: string; value: any };
}

interface ColumnMapping {
  rv: string;
  data_pagamento: string;
  cliente: string;
  vendedor: string;
  centro_custo: string;
  produto: string;
  quantidade: string;
  preco_unitario: string;
  desconto_item: string;
  tipo_pagamento: string;
  campos_extras: Record<string, string>; // Maps customFieldId -> spreadsheetColumnName
}

interface RowValidationResult {
  rowNumber: number;
  rv?: string;
  data_pagamento?: string;
  clienteNomeRaw?: string;
  vendedorNomeRaw?: string;
  produtoNomeRaw?: string;
  quantidade: number;
  preco_unitario: number;
  desconto_item: number;
  tipo_pagamento: string;
  
  // Resolved entities
  entidade_id?: number | null;
  vendedor_id?: number | null;
  centro_custo_id?: number | null;
  produto_id?: number | null;

  campos_extras: Record<string, any>;
  errors: string[];
  warnings: string[];
}

const DEFAULT_MAPPING: ColumnMapping = {
  rv: '',
  data_pagamento: '',
  cliente: '',
  vendedor: '',
  centro_custo: '',
  produto: '',
  quantidade: '',
  preco_unitario: '',
  desconto_item: '',
  tipo_pagamento: '',
  campos_extras: {}
};

export default function ImportacaoPDV() {
  const storeEmpresa = useAuthStore((state) => state.empresa);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  // States
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowsData, setRowsData] = useState<any[]>([]); // List of parsed rows from Excel
  const [mapping, setMapping] = useState<ColumnMapping>(DEFAULT_MAPPING);
  const [validationResults, setValidationResults] = useState<RowValidationResult[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Lookups loaded from Kyrus
  const [produtos, setProdutos] = useState<any[]>([]);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<any[]>([]);
  const [entidades, setEntidades] = useState<any[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Import outcome
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported: number;
    duplicados: number;
    erros: number;
    detalhes_erros: string[];
  } | null>(null);

  // Load configuration for custom fields dynamically
  const customFields = useMemo<CustomFieldConfig[]>(() => {
    if (!storeEmpresa || !storeEmpresa.pdv_config) return [];
    try {
      const parsed = JSON.parse(storeEmpresa.pdv_config);
      return parsed.campos_personalizados || [];
    } catch (e) {
      return [];
    }
  }, [storeEmpresa]);

  // Load mappings from memory
  useEffect(() => {
    const saved = localStorage.getItem('kyrus_pdv_import_mapping');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMapping((prev) => ({
          ...prev,
          ...parsed,
          campos_extras: { ...prev.campos_extras, ...(parsed.campos_extras || {}) }
        }));
      } catch (e) {}
    }
  }, []);

  // Fetch Lookups
  useEffect(() => {
    async function loadData() {
      try {
        setLoadingLookups(true);
        const [
          { data: prodsData },
          { data: vendsData },
          { data: centrosData },
          { data: entsData }
        ] = await Promise.all([
          api.get('/pdv/produtos/'),
          api.get('/usuarios/'),
          api.get('/centro-custo/'),
          api.get('/entidades/')
        ]);

        setProdutos(normalizeListResponse(prodsData));
        setVendedores(normalizeListResponse(vendsData));
        setCentrosCusto(normalizeListResponse(centrosData));
        setEntidades(normalizeListResponse(entsData));
      } catch (e) {
        console.error('Erro ao buscar dados auxiliares', e);
      } finally {
        setLoadingLookups(false);
      }
    }
    void loadData();
  }, []);

  // 1. Process Excel File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setIsProcessingFile(true);
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await uploadedFile.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        alert('A planilha fornecida está vazia.');
        return;
      }

      // Read Header Row
      const headerRow = worksheet.getRow(1);
      const parsedHeaders: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (cell) => {
        parsedHeaders.push(String(cell.value || '').trim());
      });

      // Filter empty headers
      const validHeaders = parsedHeaders.filter(Boolean);
      setHeaders(validHeaders);

      // Read Row Data
      const parsedRows: any[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        const rowObj: Record<string, any> = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const headerName = parsedHeaders[colNumber - 1];
          if (headerName) {
            rowObj[headerName] = cell.value;
          }
        });
        parsedRows.push({ rowNumber, values: rowObj });
      });

      setRowsData(parsedRows);

      // Auto-mapping heuristics
      const newMapping = { ...mapping };
      validHeaders.forEach((h) => {
        const norm = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (norm === 'rv' || norm === 'identificador' || norm.includes('codigo venda')) newMapping.rv = h;
        else if (norm.includes('data') || norm.includes('competencia')) newMapping.data_pagamento = h;
        else if (norm.includes('cliente') || norm.includes('comprador') || norm.includes('nome cliente')) newMapping.cliente = h;
        else if (norm.includes('vendedor') || norm.includes('consultor') || norm.includes('quem vendeu')) newMapping.vendedor = h;
        else if (norm.includes('centro') || norm.includes('filial') || norm.includes('loja')) newMapping.centro_custo = h;
        else if (norm.includes('produto') || norm.includes('servico') || norm.includes('item')) newMapping.produto = h;
        else if (norm.includes('quantidade') || norm === 'qtd' || norm === 'qnt') newMapping.quantidade = h;
        else if (norm.includes('preco') || norm.includes('valor unitario') || norm.includes('unitario')) newMapping.preco_unitario = h;
        else if (norm.includes('desconto')) newMapping.desconto_item = h;
        else if (norm.includes('pagamento') || norm.includes('forma') || norm.includes('meio')) newMapping.tipo_pagamento = h;
        
        // Custom fields auto-mapping
        customFields.forEach((cf) => {
          const cfNorm = cf.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (cfNorm === norm || norm.includes(cfNorm)) {
            newMapping.campos_extras[cf.id] = h;
          }
        });
      });

      setMapping(newMapping);
      setStep(2);
    } catch (err: any) {
      alert('Erro ao analisar arquivo Excel: ' + (err.message || err));
    } finally {
      setIsProcessingFile(false);
    }
  };

  // 2. Validate Rows according to mappings
  const handleValidateMapping = () => {
    // Save to mapping memory
    localStorage.setItem('kyrus_pdv_import_mapping', JSON.stringify(mapping));

    const results: RowValidationResult[] = rowsData.map((row) => {
      const vals = row.values;
      const rv = mapping.rv ? String(vals[mapping.rv] || '').trim() : undefined;
      const data_pagamento = mapping.data_pagamento ? String(vals[mapping.data_pagamento] || '').trim() : undefined;
      const clienteNomeRaw = mapping.cliente ? String(vals[mapping.cliente] || '').trim() : undefined;
      const vendedorNomeRaw = mapping.vendedor ? String(vals[mapping.vendedor] || '').trim() : undefined;
      const centroCustoRaw = mapping.centro_custo ? String(vals[mapping.centro_custo] || '').trim() : undefined;
      const produtoNomeRaw = mapping.produto ? String(vals[mapping.produto] || '').trim() : undefined;
      
      const quantidade = mapping.quantidade ? Number(vals[mapping.quantidade]) || 1 : 1;
      const preco_unitario = mapping.preco_unitario ? Number(vals[mapping.preco_unitario]) || 0 : 0;
      const desconto_item = mapping.desconto_item ? Number(vals[mapping.desconto_item]) || 0 : 0;
      const tipo_pagamento = mapping.tipo_pagamento ? String(vals[mapping.tipo_pagamento] || '').trim() : 'dinheiro';

      const errors: string[] = [];
      const warnings: string[] = [];

      // Resolve Entity: Customer (Cliente)
      let entidade_id: number | null = null;
      if (clienteNomeRaw) {
        const match = entidades.find((e) =>
          e.nome.toLowerCase().includes(clienteNomeRaw.toLowerCase()) ||
          (e.cpf_cnpj && e.cpf_cnpj.replace(/\D/g, '') === clienteNomeRaw.replace(/\D/g, ''))
        );
        if (match) {
          entidade_id = match.id;
        } else {
          // Default to first entity matching type CLIENTE or first general
          const generalClient = entidades.find((e) => e.tipo === 'CLIENTE' || e.tipo === 'AMBOS');
          if (generalClient) {
            entidade_id = generalClient.id;
            warnings.push(`Cliente "${clienteNomeRaw}" não localizado. Vinculado automaticamente ao Consumidor Padrão ("${generalClient.nome}").`);
          } else {
            errors.push(`Cliente "${clienteNomeRaw}" não localizado e nenhum consumidor padrão foi cadastrado.`);
          }
        }
      } else {
        const generalClient = entidades.find((e) => e.tipo === 'CLIENTE' || e.tipo === 'AMBOS');
        if (generalClient) {
          entidade_id = generalClient.id;
        } else {
          errors.push('Coluna do Cliente vazia e nenhum consumidor padrão configurado.');
        }
      }

      // Resolve Entity: Vendedor
      let vendedor_id: number | null = null;
      if (vendedorNomeRaw) {
        const match = vendedores.find((v) =>
          v.nome?.toLowerCase().includes(vendedorNomeRaw.toLowerCase()) ||
          v.email.toLowerCase().includes(vendedorNomeRaw.toLowerCase())
        );
        if (match) {
          vendedor_id = match.id;
        } else {
          vendedor_id = currentUserId;
          warnings.push(`Vendedor "${vendedorNomeRaw}" não localizado. Vinculado ao usuário atual.`);
        }
      } else {
        vendedor_id = currentUserId;
      }

      // Resolve Entity: Centro de Custo
      let centro_custo_id: number | null = null;
      if (centroCustoRaw) {
        const match = centrosCusto.find((cc) => cc.nome.toLowerCase().includes(centroCustoRaw.toLowerCase()));
        if (match) {
          centro_custo_id = match.id;
        }
      }
      if (!centro_custo_id && centrosCusto.length > 0) {
        centro_custo_id = centrosCusto[0].id; // Fallback
      }

      // Resolve Entity: Produto
      let produto_id: number | null = null;
      if (produtoNomeRaw) {
        const match = produtos.find((p) =>
          p.nome.toLowerCase().includes(produtoNomeRaw.toLowerCase()) ||
          (p.codigo_barras && p.codigo_barras === produtoNomeRaw)
        );
        if (match) {
          produto_id = match.id;
        } else {
          errors.push(`Produto "${produtoNomeRaw}" não encontrado no catálogo.`);
        }
      } else {
        errors.push('Coluna do Produto vazia.');
      }

      // Parse Custom Fields
      const campos_extras: Record<string, any> = {};
      customFields.forEach((cf) => {
        const colName = mapping.campos_extras[cf.id];
        if (colName) {
          const val = vals[colName];
          if (cf.type === 'currency') {
            campos_extras[cf.id] = val !== undefined && val !== null ? Number(val) || 0 : 0;
          } else if (cf.type === 'number') {
            campos_extras[cf.id] = val !== undefined && val !== null ? Number(val) || 0 : 0;
          } else if (cf.type === 'boolean') {
            campos_extras[cf.id] = val === true || String(val).toLowerCase() === 'sim' || String(val) === '1';
          } else {
            campos_extras[cf.id] = val !== undefined && val !== null ? String(val).trim() : '';
          }

          // Validation of required
          if (cf.required && (campos_extras[cf.id] === undefined || campos_extras[cf.id] === '')) {
            errors.push(`O campo personalizado "${cf.label}" é obrigatório.`);
          }
          // Regex validation
          if (cf.regex && campos_extras[cf.id] !== '') {
            try {
              const r = new RegExp(cf.regex);
              if (!r.test(String(campos_extras[cf.id]))) {
                errors.push(`O campo personalizado "${cf.label}" não atende a validação de formato.`);
              }
            } catch (e) {}
          }
        } else if (cf.required) {
          // If required but not mapped
          errors.push(`O campo obrigatório "${cf.label}" não foi mapeado a nenhuma coluna.`);
        }
      });

      return {
        rowNumber: row.rowNumber,
        rv,
        data_pagamento,
        clienteNomeRaw,
        vendedorNomeRaw,
        produtoNomeRaw,
        quantidade,
        preco_unitario,
        desconto_item,
        tipo_pagamento,
        entidade_id,
        vendedor_id,
        centro_custo_id,
        produto_id,
        campos_extras,
        errors,
        warnings
      };
    });

    setValidationResults(results);
    setStep(3);
  };

  // 3. Execute Import to Backend
  const handleExecuteImport = async () => {
    const validRows = validationResults.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      alert('Não há nenhuma linha válida para ser importada.');
      return;
    }

    setIsImporting(true);
    try {
      // Group rows by RV to create combined sales (sales with multiple items)
      // If a row doesn't have an RV, generate a random temporary RV to isolate it
      const saleGroups: Record<string, RowValidationResult[]> = {};
      validRows.forEach((row) => {
        const groupKey = row.rv || `AUTO-IMPORT-${row.rowNumber}-${Date.now()}`;
        if (!saleGroups[groupKey]) {
          saleGroups[groupKey] = [];
        }
        saleGroups[groupKey].push(row);
      });

      // Construct PdvVendaCreate payload list
      const salesPayloadList: any[] = Object.entries(saleGroups).map(([rvKey, rows]) => {
        const primary = rows[0];

        // Sum items
        const itens = rows.map((r) => ({
          produto_id: r.produto_id!,
          quantidade: r.quantidade,
          desconto: r.desconto_item,
          preco_unitario: r.preco_unitario || null // Fallback to database price if null
        }));

        // Calculate total sale value (sum of unit price * qty - discount)
        const totalLiquido = rows.reduce((acc, r) => {
          const price = r.preco_unitario || (produtos.find(p => p.id === r.produto_id)?.preco_unitario || 0);
          return acc + (price * r.quantidade) - r.desconto_item;
        }, 0);

        // Map Payment: Create payment allocation for the total value
        const pagamentos = [
          {
            tipo_pagamento: primary.tipo_pagamento.toLowerCase().replace(/\s+/g, '_') || 'dinheiro',
            valor: totalLiquido,
            numero_parcelas: 1,
            valor_parcela: null,
            data_pagamento: primary.data_pagamento || new Date().toISOString().split('T')[0],
            bandeira: 'OUTROS'
          }
        ];

        return {
          entidade_id: primary.entidade_id!,
          centro_custo_id: primary.centro_custo_id!,
          vendedor_id: primary.vendedor_id!,
          desconto: rows.reduce((acc, r) => acc + r.desconto_item, 0),
          status: 'REALIZADO',
          itens,
          pagamentos,
          rv: rvKey.startsWith('AUTO-IMPORT') ? null : rvKey,
          data_pagamento: primary.data_pagamento || new Date().toISOString().split('T')[0],
          observacao: `Importação em lote de planilha. Linhas: ${rows.map(r => r.rowNumber).join(',')}`,
          import_hash: `import_row_${primary.rowNumber}_${rvKey}`,
          campos_extras: primary.campos_extras
        };
      });

      // Split payloads into chunks of 100 to avoid database timeouts
      const CHUNK_SIZE = 100;
      let totalImported = 0;
      let totalDuplicated = 0;
      let totalErrors = 0;
      const errorLog: string[] = [];

      for (let i = 0; i < salesPayloadList.length; i += CHUNK_SIZE) {
        const chunk = salesPayloadList.slice(i, i + CHUNK_SIZE);
        const res = await api.post('/pdv/vendas/importar', chunk);
        totalImported += res.data.importados || 0;
        totalDuplicated += res.data.duplicados || 0;
        totalErrors += res.data.erros || 0;
        if (res.data.detalhes_erros) {
          errorLog.push(...res.data.detalhes_erros);
        }
      }

      setImportResult({
        success: totalErrors === 0,
        imported: totalImported,
        duplicados: totalDuplicated,
        erros: totalErrors,
        detalhes_erros: errorLog
      });
      setStep(4);
    } catch (e: any) {
      alert('Erro catastrófico ao realizar importação: ' + (e.response?.data?.detail || e.message || e));
    } finally {
      setIsImporting(false);
    }
  };

  const currentMappingKeys = Object.keys(DEFAULT_MAPPING).filter(k => k !== 'campos_extras');

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300">
      {/* Header */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link to="/pdv" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-white transition">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">Ferramentas de Carga</p>
              <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
                Importação Assistida de Vendas
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-450 uppercase">
            <span>Passo {step} de 4</span>
          </div>
        </div>
      </section>

      {loadingLookups ? (
        <div className="p-16 flex flex-col items-center justify-center gap-3 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
          <span className="text-sm font-semibold text-slate-500">Sincronizando tabelas locais com o servidor...</span>
        </div>
      ) : (
        <>
          {/* STEP 1: UPLOAD */}
          {step === 1 && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm text-center space-y-6">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">Carregue sua planilha de vendas</h2>
                  <p className="text-sm text-slate-550 dark:text-slate-400">
                    O importador lê arquivos XLS, XLSX ou CSV e permite que você mapeie as colunas de produtos, quantidades, datas e campos personalizados facilmente.
                  </p>
                </div>

                <div className="relative border-2 border-dashed border-slate-350 hover:border-blue-500 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/20 rounded-2xl p-8 transition cursor-pointer flex flex-col items-center justify-center">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    disabled={isProcessingFile}
                  />
                  {isProcessingFile ? (
                    <div className="space-y-2">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
                      <span className="text-xs font-bold text-slate-500">Processando e interpretando colunas...</span>
                    </div>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-10 h-10 text-slate-400 mb-2" />
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Selecionar arquivo Excel</span>
                      <span className="text-xs text-slate-450 mt-1">Clique ou arraste o arquivo aqui</span>
                    </>
                  )}
                </div>

                <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/20 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 text-left text-xs text-blue-800 dark:text-blue-300">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <span className="font-bold">Dica de Layout:</span> Para otimizar o auto-mapeamento, nomeie suas colunas com cabeçalhos comuns, como <em>Data da Venda, Código do Produto, Quantidade</em> e <em>Valor Unitário</em>.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPING */}
          {step === 2 && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 space-y-6">
              <div className="space-y-1">
                <h2 className="text-lg font-black text-slate-900 dark:text-white">Mapeamento de Colunas</h2>
                <p className="text-sm text-slate-550 dark:text-slate-400">Associe as colunas detectadas no arquivo Excel com os campos correspondentes no KyrusERP.</p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Standard Fields mapping */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 pb-2">Campos Principais</h3>
                  
                  {currentMappingKeys.map((key) => {
                    const labelMap: Record<string, string> = {
                      rv: 'Identificador / Código de Venda (RV)',
                      data_pagamento: 'Data da Venda (Competência) *',
                      cliente: 'Cliente (Nome ou Documento) *',
                      vendedor: 'Vendedor Responsável (Nome ou Email)',
                      centro_custo: 'Centro de Custo',
                      produto: 'Produto Vendido (Nome ou EAN) *',
                      quantidade: 'Quantidade Vendida *',
                      preco_unitario: 'Preço Unitário (R$)',
                      desconto_item: 'Desconto Individual do Item (R$)',
                      tipo_pagamento: 'Forma de Pagamento'
                    };

                    return (
                      <label key={key} className="block">
                        <span className="text-xs font-bold text-slate-650 dark:text-slate-350 block mb-1">{labelMap[key] || key}</span>
                        <SearchableSelect
                          value={(mapping as any)[key] || ''}
                          onChange={(val) => setMapping({ ...mapping, [key]: String(val) })}
                          options={[{
                            label: 'Campo',
                            options: [
                              { id: '', label: '-- Não Mapear (Apenas usar valor padrão/nulo) --' },
                              ...headers.map((h) => ({ id: h, label: h }))
                            ]
                          }]}
                        />
                      </label>
                    );
                  })}
                </div>

                {/* Custom Fields mapping */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 pb-2">Campos Personalizados (Empresa)</h3>
                  
                  {customFields.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-550 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      Nenhum campo personalizado configurado na empresa.
                    </div>
                  ) : (
                    customFields.map((cf) => (
                      <label key={cf.id} className="block">
                        <span className="text-xs font-bold text-slate-650 dark:text-slate-350 block mb-1">
                          {cf.label} {cf.required && <span className="text-rose-500">*</span>}
                        </span>
                        <SearchableSelect
                          value={mapping.campos_extras[cf.id] || ''}
                          onChange={(val) =>
                            setMapping({
                              ...mapping,
                              campos_extras: { ...mapping.campos_extras, [cf.id]: String(val) }
                            })
                          }
                          options={[{
                            label: 'Campo Personalizado',
                            options: [
                              { id: '', label: '-- Não Mapear (Nulo ou Sem valor) --' },
                              ...headers.map((h) => ({ id: h, label: h }))
                            ]
                          }]}
                        />
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-slate-150 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 font-bold text-sm text-slate-700 dark:text-white transition cursor-pointer"
                >
                  Voltar Upload
                </button>
                <button
                  type="button"
                  onClick={handleValidateMapping}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-md transition cursor-pointer"
                >
                  Validar e Prosseguir
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & VALIDATION */}
          {step === 3 && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">Pré-visualização e Validação</h2>
                  <p className="text-sm text-slate-550 dark:text-slate-400 font-medium">
                    Encontramos {validationResults.length} linhas. {validationResults.filter(r => r.errors.length > 0).length} possuem inconsistências e não serão importadas.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 rounded px-2 py-1 font-bold">
                    Válidas: {validationResults.filter(r => r.errors.length === 0).length}
                  </span>
                  <span className="text-xs bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-455 rounded px-2 py-1 font-bold">
                    Erros: {validationResults.filter(r => r.errors.length > 0).length}
                  </span>
                </div>
              </div>

              {/* Data Table Preview */}
              <div className="overflow-x-auto rounded-2xl border border-slate-250 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950/30">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="w-16 px-4 py-3 text-center">Linha</th>
                      <th className="w-24 px-4 py-3">RV</th>
                      <th className="w-24 px-4 py-3">Data</th>
                      <th className="px-4 py-3">Produto</th>
                      <th className="w-20 px-4 py-3 text-center">Qtd</th>
                      <th className="w-24 px-4 py-3 text-right">Unitário</th>
                      <th className="w-24 px-4 py-3 text-right">Desconto</th>
                      <th className="px-4 py-3">Inconsistências / Alertas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {validationResults.map((res) => (
                      <tr key={res.rowNumber} className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/30 ${res.errors.length > 0 ? 'bg-rose-50/30 dark:bg-rose-950/5' : ''}`}>
                        <td className="px-4 py-3 text-center font-mono font-bold text-slate-400">{res.rowNumber}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{res.rv || <span className="text-slate-400 italic">Autogerado</span>}</td>
                        <td className="px-4 py-3 font-mono">{res.data_pagamento || '--'}</td>
                        <td className="px-4 py-3 font-bold text-slate-850 dark:text-slate-200">
                          {res.produtoNomeRaw || <span className="text-rose-500 font-normal">Não Mapeado</span>}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold">{res.quantidade}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">R$ {res.preco_unitario.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600 font-bold">R$ {res.desconto_item.toFixed(2)}</td>
                        <td className="px-4 py-3 space-y-1">
                          {res.errors.map((err, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-rose-600 dark:text-rose-455 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>{err}</span>
                            </div>
                          ))}
                          {res.warnings.map((warn, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-amber-600 dark:text-amber-450 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>{warn}</span>
                            </div>
                          ))}
                          {res.errors.length === 0 && res.warnings.length === 0 && (
                            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-450 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Pronto</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-slate-150 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 font-bold text-sm text-slate-700 dark:text-white transition cursor-pointer"
                >
                  Voltar Mapeamento
                </button>
                <button
                  type="button"
                  disabled={isImporting || validationResults.filter(r => r.errors.length === 0).length === 0}
                  onClick={handleExecuteImport}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md transition disabled:opacity-50 cursor-pointer flex items-center gap-2"
                >
                  {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isImporting ? 'Importando Vendas...' : 'Confirmar e Importar'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: OUTCOME */}
          {step === 4 && importResult && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 text-center">
                <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center ${importResult.erros === 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-xl font-black text-slate-900 dark:text-white">Carga Finalizada com Sucesso!</h2>
                  <p className="text-sm text-slate-500">
                    O processamento das linhas de venda foi concluído no servidor com os seguintes resultados:
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="text-center">
                    <span className="block text-2xl font-black text-emerald-600 dark:text-emerald-450">{importResult.imported}</span>
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-450">Importadas</span>
                  </div>
                  <div className="text-center border-x border-slate-250 dark:border-slate-800">
                    <span className="block text-2xl font-black text-blue-600 dark:text-blue-400">{importResult.duplicados}</span>
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-450">Duplicadas</span>
                  </div>
                  <div className="text-center">
                    <span className="block text-2xl font-black text-rose-600 dark:text-rose-455">{importResult.erros}</span>
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-450">Erros</span>
                  </div>
                </div>

                {importResult.detalhes_erros.length > 0 && (
                  <div className="text-left space-y-2.5">
                    <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">Registros de Falhas:</span>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 border border-rose-100 dark:border-rose-950/20 bg-rose-50/20 dark:bg-rose-950/5 p-3 rounded-xl text-xs font-mono text-rose-700 dark:text-rose-400 leading-relaxed">
                      {importResult.detalhes_erros.map((err, idx) => (
                        <div key={idx} className="flex gap-2">
                          <span className="shrink-0">•</span>
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 justify-center pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setStep(1);
                      setFile(null);
                      setRowsData([]);
                      setValidationResults([]);
                      setImportResult(null);
                    }}
                    className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white rounded-xl text-sm font-bold transition cursor-pointer"
                  >
                    Importar Outro Arquivo
                  </button>
                  <Link
                    to="/pdv"
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-md transition"
                  >
                    Voltar ao PDV
                  </Link>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
