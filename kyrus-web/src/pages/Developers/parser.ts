// kyrus-web/src/pages/Developers/parser.ts
import type {
  OpenApiSpec,
  ParsedEndpoint,
  EndpointGroup,
  HttpMethod,
  OpenApiOperation,
} from './types';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

export function resolveRef(ref: string, spec: OpenApiSpec): any {
  if (!ref || !ref.startsWith('#/')) return null;
  const parts = ref.replace('#/', '').split('/');
  let current: any = spec;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return current;
}

export function resolveSchema(schema: any, spec: OpenApiSpec, depth = 0): any {
  if (!schema || depth > 5) return schema;

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec);
    if (resolved) {
      return resolveSchema(resolved, spec, depth + 1);
    }
  }

  if (schema.type === 'array' && schema.items) {
    return {
      ...schema,
      items: resolveSchema(schema.items, spec, depth + 1),
    };
  }

  if (schema.type === 'object' && schema.properties) {
    const resolvedProps: Record<string, any> = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      resolvedProps[key] = resolveSchema(prop, spec, depth + 1);
    }
    return {
      ...schema,
      properties: resolvedProps,
    };
  }

  return schema;
}

export function extractSchemaExample(schema: any, spec: OpenApiSpec): any {
  if (!schema) return null;
  const resolved = resolveSchema(schema, spec);

  if (resolved.example !== undefined) return resolved.example;
  if (resolved.examples && Object.keys(resolved.examples).length > 0) {
    const firstKey = Object.keys(resolved.examples)[0];
    const exObj = resolved.examples[firstKey];
    return exObj?.value !== undefined ? exObj.value : exObj;
  }

  if (resolved.type === 'object' && resolved.properties) {
    const obj: Record<string, any> = {};
    for (const [key, prop] of Object.entries<any>(resolved.properties)) {
      if (prop.example !== undefined) {
        obj[key] = prop.example;
      } else if (prop.default !== undefined) {
        obj[key] = prop.default;
      } else if (prop.type === 'string') {
        obj[key] = prop.format === 'date' ? '2026-10-15' : 'exemplo';
      } else if (prop.type === 'number' || prop.type === 'integer') {
        obj[key] = 1;
      } else if (prop.type === 'boolean') {
        obj[key] = true;
      } else if (prop.type === 'array') {
        obj[key] = [];
      } else {
        obj[key] = null;
      }
    }
    return obj;
  }

  if (resolved.type === 'array' && resolved.items) {
    const itemEx = extractSchemaExample(resolved.items, spec);
    return itemEx !== null ? [itemEx] : [];
  }

  return null;
}

export function parseOpenApiSpec(spec: OpenApiSpec): EndpointGroup[] {
  const groupsMap = new Map<string, ParsedEndpoint[]>();
  const tagDescriptions = new Map<string, string>();

  if (spec.tags) {
    for (const t of spec.tags) {
      if (t.name) {
        tagDescriptions.set(t.name, t.description || '');
      }
    }
  }

  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const op: OpenApiOperation | undefined = pathItem[method];
      if (!op) continue;

      // Se a rota for explicitamente privada, ignora
      if (op['x-kyrus-public'] === false) continue;

      const tag = op.tags && op.tags.length > 0 ? op.tags[0] : 'Geral';
      const opId =
        op.operationId ||
        `${tag.toLowerCase().replace(/\s+/g, '_')}_${method}_${pathKey.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // Combina parâmetros de pathItem e op
      const rawParams = [...(pathItem.parameters || []), ...(op.parameters || [])];
      const parameters = rawParams.map((p) => {
        if (p.$ref) {
          const res = resolveRef(p.$ref, spec);
          return res || p;
        }
        return p;
      });

      const parsed: ParsedEndpoint = {
        id: opId,
        path: pathKey,
        method,
        summary: op.summary || `${method.toUpperCase()} ${pathKey}`,
        description: op.description || '',
        tag,
        parameters,
        requestBody: op.requestBody,
        responses: op.responses || {},
        rawOperation: op,
      };

      if (!groupsMap.has(tag)) {
        groupsMap.set(tag, []);
      }
      groupsMap.get(tag)!.push(parsed);
    }
  }

  // Ordena grupos e endpoints
  const result: EndpointGroup[] = [];
  for (const [tag, endpoints] of groupsMap.entries()) {
    // Ordena endpoints no grupo por método e path
    endpoints.sort((a, b) => a.path.localeCompare(b.path));
    result.push({
      tag,
      description: tagDescriptions.get(tag) || '',
      endpoints,
    });
  }

  // Ordena grupos com base na ordem de tags do spec, se disponível
  if (spec.tags) {
    const tagOrder = spec.tags.map((t) => t.name);
    result.sort((a, b) => {
      const idxA = tagOrder.indexOf(a.tag);
      const idxB = tagOrder.indexOf(b.tag);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.tag.localeCompare(b.tag);
    });
  }

  return result;
}
