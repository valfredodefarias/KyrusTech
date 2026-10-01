// kyrus-web/src/pages/Developers/components/TryItPanel.tsx
import React, { useState, useEffect } from 'react';
import {
  Play,
  Copy,
  Check,
  Key,
  Eye,
  EyeOff,
  Server,
  Loader2,
  Clock,
  Sparkles,
} from 'lucide-react';
import type {
  CodeSnippetLang,
  ParsedEndpoint,
  OpenApiSpec,
  TryItExecutionResult,
} from '../types';
import { generateCodeSnippet } from '../CodeSnippetGenerator';
import { extractSchemaExample, resolveSchema } from '../parser';
import axios from 'axios';

interface TryItPanelProps {
  endpoint: ParsedEndpoint;
  spec: OpenApiSpec;
  apiKey: string;
  onChangeApiKey: (key: string) => void;
  baseUrl: string;
  onChangeBaseUrl: (url: string) => void;
}

const LANGUAGES: Array<{ id: CodeSnippetLang; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'node', label: 'Node.js' },
  { id: 'python', label: 'Python' },
  { id: 'php', label: 'PHP' },
  { id: 'n8n', label: 'n8n' },
];

export const TryItPanel: React.FC<TryItPanelProps> = ({
  endpoint,
  spec,
  apiKey,
  onChangeApiKey,
  baseUrl,
  onChangeBaseUrl,
}) => {
  const [selectedLang, setSelectedLang] = useState<CodeSnippetLang>('curl');
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Parâmetros de teste
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [bodyJson, setBodyJson] = useState<string>('{}');

  // Estado de execução do Try It!
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<TryItExecutionResult | null>(null);

  // Quando o endpoint mudar, inicializa parâmetros e corpo de exemplo
  useEffect(() => {
    // Path params
    const initialPaths: Record<string, string> = {};
    for (const p of endpoint.parameters.filter((x) => x.in === 'path')) {
      initialPaths[p.name] = p.example ? String(p.example) : '1';
    }
    setPathParams(initialPaths);

    // Query params
    const initialQueries: Record<string, string> = {};
    for (const p of endpoint.parameters.filter((x) => x.in === 'query')) {
      if (p.example !== undefined) {
        initialQueries[p.name] = String(p.example);
      } else if (p.schema?.default !== undefined) {
        initialQueries[p.name] = String(p.schema.default);
      }
    }
    setQueryParams(initialQueries);

    // Request body
    if (endpoint.requestBody?.content?.['application/json']) {
      const content = endpoint.requestBody.content['application/json'];
      let ex = content.example;
      if (!ex && content.examples && Object.keys(content.examples).length > 0) {
        const firstKey = Object.keys(content.examples)[0];
        ex = content.examples[firstKey]?.value;
      }
      if (!ex && content.schema) {
        ex = extractSchemaExample(content.schema, spec);
      }
      setBodyJson(ex ? JSON.stringify(ex, null, 2) : '{}');
    } else {
      setBodyJson('{}');
    }

    setResult(null);
  }, [endpoint.id, spec]);

  const snippetCode = generateCodeSnippet(selectedLang, {
    endpoint,
    baseUrl,
    apiKey,
    queryParams,
    pathParams,
    bodyJson,
  });

  const handleCopySnippet = () => {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(snippetCode);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    }
  };

  const handleExecuteTryIt = async () => {
    let finalPath = endpoint.path;
    for (const [k, v] of Object.entries(pathParams)) {
      finalPath = finalPath.replace(`{${k}}`, encodeURIComponent(v));
    }

    const queryEntries = Object.entries(queryParams).filter(([_, v]) => v !== undefined && v !== '');
    const queryString = queryEntries.length > 0
      ? '?' + new URLSearchParams(queryEntries).toString()
      : '';

    // Se estiver rodando contra o mesmo servidor ou localhost, usamos a rota direta
    const targetUrl = `${baseUrl.replace(/\/$/, '')}${finalPath}${queryString}`;

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    }

    let parsedBody: any = undefined;
    if (['post', 'put', 'patch'].includes(endpoint.method)) {
      try {
        parsedBody = JSON.parse(bodyJson);
        headers['Content-Type'] = 'application/json';
        headers['X-Idempotency-Key'] = `tryit_${Date.now()}`;
      } catch {
        parsedBody = bodyJson;
      }
    }

    const startTime = performance.now();
    setExecuting(true);
    setResult(null);

    try {
      const res = await axios({
        url: targetUrl,
        method: endpoint.method,
        headers,
        data: parsedBody,
        validateStatus: () => true, // Captura qualquer status (200, 401, 403, etc.)
      });

      const endTime = performance.now();
      setResult({
        status: res.status,
        statusText: res.statusText || String(res.status),
        durationMs: Math.round(endTime - startTime),
        headers: res.headers as any,
        data: res.data,
      });
    } catch (err: any) {
      const endTime = performance.now();
      setResult({
        status: 0,
        statusText: 'Network / CORS Error',
        durationMs: Math.round(endTime - startTime),
        headers: {},
        data: null,
        error: err.message || 'Falha ao conectar com o servidor.',
      });
    } finally {
      setExecuting(false);
    }
  };

  // Carrega exemplo de response no painel
  const handleLoadResponseExample = (statusCode: string) => {
    const resp = endpoint.responses[statusCode];
    if (!resp?.content?.['application/json']) return;
    const c = resp.content['application/json'];
    const ex = c.example || (c.examples ? Object.values(c.examples)[0] : null);
    if (ex) {
      setResult({
        status: parseInt(statusCode, 10) || 200,
        statusText: resp.description || 'Exemplo',
        durationMs: 0,
        headers: {},
        data: ex?.value !== undefined ? ex.value : ex,
      });
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden flex flex-col">
      {/* SELETOR DE LINGUAGEM NO TOPO */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2">
        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              type="button"
              onClick={() => setSelectedLang(lang.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 ${
                selectedLang === lang.id
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleCopySnippet}
          title="Copiar código"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 text-xs font-semibold transition"
        >
          {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copiedSnippet ? 'Copiado!' : 'Copiar'}</span>
        </button>
      </div>

      {/* BLOCO DE CÓDIGO GERADO */}
      <div className="p-3 bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-56 border-b border-slate-800 custom-scrollbar select-all">
        <pre className="m-0 leading-relaxed">{snippetCode}</pre>
      </div>

      {/* BLOCO CREDENCIAIS & AMBIENTE (EM MEMÓRIA) */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-blue-500" />
            <span>Credencial (X-Api-Key)</span>
          </label>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-bold uppercase">
            Apenas em memória
          </span>
        </div>

        <div className="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            placeholder="kyr_live_cole_sua_chave_aqui"
            value={apiKey}
            onChange={(e) => onChangeApiKey(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-3 pr-9 py-2 text-xs font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 shadow-2xs"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Servidor Alvo */}
        <div className="flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={baseUrl}
            onChange={(e) => onChangeBaseUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs text-slate-700 dark:text-slate-300 outline-none"
          >
            <option value="https://api.kyrustech.com.br">Produção (api.kyrustech.com.br)</option>
            <option value="http://localhost:8000">Local (http://localhost:8000)</option>
          </select>
        </div>
      </div>

      {/* PARÂMETROS EDITÁVEIS PARA TESTE */}
      <div className="p-4 space-y-4 max-h-72 overflow-y-auto custom-scrollbar flex-1">
        {/* Path params inputs */}
        {Object.keys(pathParams).length > 0 ? (
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Path Variables
            </span>
            {Object.entries(pathParams).map(([name, val]) => (
              <label key={name} className="block">
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">{name}</span>
                <input
                  type="text"
                  value={val}
                  onChange={(e) =>
                    setPathParams((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none"
                />
              </label>
            ))}
          </div>
        ) : null}

        {/* Query params inputs */}
        {Object.keys(queryParams).length > 0 ? (
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Query Parameters
            </span>
            {Object.entries(queryParams).map(([name, val]) => (
              <label key={name} className="block">
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">{name}</span>
                <input
                  type="text"
                  value={val}
                  onChange={(e) =>
                    setQueryParams((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none"
                />
              </label>
            ))}
          </div>
        ) : null}

        {/* Request body JSON editor */}
        {['post', 'put', 'patch'].includes(endpoint.method) ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Corpo da Requisição (JSON)
              </span>
            </div>
            <textarea
              rows={6}
              value={bodyJson}
              onChange={(e) => setBodyJson(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 font-mono text-xs text-slate-900 dark:text-white outline-none focus:border-blue-500 resize-y"
            />
          </div>
        ) : null}
      </div>

      {/* BOTÃO TRY IT! */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleExecuteTryIt}
          disabled={executing}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-4 py-2.5 text-xs font-black uppercase tracking-wider transition shadow-sm cursor-pointer"
        >
          {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
          <span>{executing ? 'Executando...' : 'Try It!'}</span>
        </button>
      </div>

      {/* PAINEL DE RESPOSTA (RESPONSE) */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/40 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Resposta da API</span>

          {/* Chips com exemplos do OpenAPI */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400">Exemplos:</span>
            {Object.keys(endpoint.responses).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => handleLoadResponseExample(status)}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-200 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-600 dark:text-slate-300 transition"
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {result ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span
                className={`px-2 py-0.5 rounded font-mono font-black text-[11px] ${
                  result.status >= 200 && result.status < 300
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                }`}
              >
                {result.status} {result.statusText}
              </span>

              <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                <Clock className="w-3.5 h-3.5" />
                <span>{result.durationMs} ms</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 text-slate-100 font-mono text-[11px] max-h-56 overflow-y-auto custom-scrollbar border border-slate-800">
              {result.error ? (
                <span className="text-rose-400 font-bold">{result.error}</span>
              ) : (
                <pre className="m-0 select-all">{JSON.stringify(result.data, null, 2)}</pre>
              )}
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-400 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            Clique em "Try It!" ou em um exemplo para ver a resposta.
          </div>
        )}
      </div>
    </div>
  );
};
