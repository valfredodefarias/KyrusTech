// kyrus-web/src/pages/Developers/CodeSnippetGenerator.ts
import type { CodeSnippetLang, ParsedEndpoint } from './types';

interface SnippetOptions {
  endpoint: ParsedEndpoint;
  baseUrl: string;
  apiKey: string;
  queryParams: Record<string, string>;
  pathParams: Record<string, string>;
  bodyJson: string;
}

export function generateCodeSnippet(lang: CodeSnippetLang, options: SnippetOptions): string {
  const { endpoint, baseUrl, apiKey, queryParams, pathParams, bodyJson } = options;

  // Monta path interpolado
  let finalPath = endpoint.path;
  for (const [key, val] of Object.entries(pathParams)) {
    finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(val || `{${key}}`));
  }

  // Monta query string
  const queryEntries = Object.entries(queryParams).filter(([_, v]) => v !== undefined && v !== '');
  const queryString = queryEntries.length > 0
    ? '?' + new URLSearchParams(queryEntries).toString()
    : '';

  const fullUrl = `${baseUrl.replace(/\/$/, '')}${finalPath}${queryString}`;
  const method = endpoint.method.toUpperCase();
  const token = apiKey || 'kyr_live_sua_chave_aqui';
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method) && bodyJson && bodyJson.trim() !== '{}';

  let parsedBody: any = null;
  try {
    parsedBody = hasBody ? JSON.parse(bodyJson) : null;
  } catch {
    parsedBody = bodyJson;
  }

  switch (lang) {
    case 'curl': {
      let cmd = `curl -X ${method} "${fullUrl}" \\\n  -H "X-Api-Key: ${token}"`;
      if (hasBody) {
        cmd += ` \\\n  -H "Content-Type: application/json"`;
        cmd += ` \\\n  -H "X-Idempotency-Key: ${Date.now()}"`;
        cmd += ` \\\n  -d '${bodyJson.replace(/'/g, "'\\''")}'`;
      }
      return cmd;
    }

    case 'node': {
      let code = `const url = "${fullUrl}";\n\n`;
      code += `const headers = {\n`;
      code += `  "X-Api-Key": "${token}",\n`;
      if (hasBody) {
        code += `  "Content-Type": "application/json",\n`;
        code += `  "X-Idempotency-Key": "${Date.now()}",\n`;
      }
      code += `};\n\n`;

      if (hasBody) {
        code += `const body = JSON.stringify(${JSON.stringify(parsedBody, null, 2)});\n\n`;
      }

      code += `try {\n`;
      code += `  const response = await fetch(url, {\n`;
      code += `    method: "${method}",\n`;
      code += `    headers,\n`;
      if (hasBody) {
        code += `    body,\n`;
      }
      code += `  });\n\n`;
      code += `  const data = await response.json();\n`;
      code += `  console.log("Status:", response.status);\n`;
      code += `  console.log("Response:", data);\n`;
      code += `} catch (err) {\n`;
      code += `  console.error("Erro na requisição:", err);\n`;
      code += `}\n`;
      return code;
    }

    case 'python': {
      let code = `import requests\nimport json\n\n`;
      code += `url = "${fullUrl}"\n\n`;
      code += `headers = {\n`;
      code += `    "X-Api-Key": "${token}",\n`;
      if (hasBody) {
        code += `    "Content-Type": "application/json",\n`;
        code += `    "X-Idempotency-Key": "${Date.now()}",\n`;
      }
      code += `}\n\n`;

      if (hasBody) {
        code += `payload = ${JSON.stringify(parsedBody, null, 4)}\n\n`;
        code += `response = requests.${endpoint.method}(url, headers=headers, json=payload)\n`;
      } else {
        code += `response = requests.${endpoint.method}(url, headers=headers)\n`;
      }

      code += `print("Status:", response.status_code)\n`;
      code += `print(json.dumps(response.json(), indent=2, ensure_ascii=False))\n`;
      return code;
    }

    case 'php': {
      let code = `<?php\n\n`;
      code += `$curl = curl_init();\n\n`;
      code += `curl_setopt_array($curl, array(\n`;
      code += `  CURLOPT_URL => '${fullUrl}',\n`;
      code += `  CURLOPT_RETURNTRANSFER => true,\n`;
      code += `  CURLOPT_CUSTOMREQUEST => '${method}',\n`;

      const headersList = [`'X-Api-Key: ${token}'`];
      if (hasBody) {
        headersList.push(`'Content-Type: application/json'`);
        headersList.push(`'X-Idempotency-Key: ${Date.now()}'`);
        code += `  CURLOPT_POSTFIELDS => '${bodyJson.replace(/'/g, "\\'")}',\n`;
      }

      code += `  CURLOPT_HTTPHEADER => array(\n    ${headersList.join(',\n    ')}\n  ),\n`;
      code += `));\n\n`;
      code += `$response = curl_exec($curl);\n`;
      code += `$httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);\n`;
      code += `curl_close($curl);\n\n`;
      code += `echo "Status: $httpCode\\n";\n`;
      code += `echo $response;\n`;
      return code;
    }

    case 'n8n': {
      const n8nNodeConfig = {
        name: `Kyrus - ${endpoint.summary}`,
        type: 'n8n-nodes-base.httpRequest',
        parameters: {
          method,
          url: fullUrl,
          authentication: 'none',
          sendHeaders: true,
          headerParameters: {
            parameters: [
              {
                name: 'X-Api-Key',
                value: token,
              },
              ...(hasBody
                ? [
                    {
                      name: 'Content-Type',
                      value: 'application/json',
                    },
                    {
                      name: 'X-Idempotency-Key',
                      value: '={{ $execution.id }}',
                    },
                  ]
                : []),
            ],
          },
          sendBody: hasBody,
          specifyBody: 'json',
          jsonBody: hasBody ? (parsedBody ? JSON.stringify(parsedBody) : bodyJson) : undefined,
          options: {
            retryOnFail: true,
            maxTries: 3,
            waitBetweenTries: 2000,
          },
        },
      };

      return `// Configuração do nó "HTTP Request" no n8n:\n// Você pode colar isto diretamente no n8n ou configurar manualmente:\n\n${JSON.stringify(
        n8nNodeConfig,
        null,
        2
      )}`;
    }

    default:
      return '';
  }
}
