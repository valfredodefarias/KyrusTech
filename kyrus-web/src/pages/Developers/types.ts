// kyrus-web/src/pages/Developers/types.ts

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpenApiParameter {
  $ref?: string;
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: any;
  example?: any;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: {
    [mediaType: string]: {
      schema?: any;
      example?: any;
      examples?: Record<string, any>;
    };
  };
}

export interface OpenApiResponse {
  description: string;
  content?: {
    [mediaType: string]: {
      schema?: any;
      example?: any;
      examples?: Record<string, any>;
    };
  };
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
  'x-kyrus-public'?: boolean;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  parameters?: OpenApiParameter[];
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
}

export interface ParsedEndpoint {
  id: string; // unique identifier (e.g. "lancamentos-get-lancamentos")
  path: string; // e.g. "/api/v1/lancamentos"
  method: HttpMethod;
  summary: string;
  description: string;
  tag: string;
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  rawOperation: OpenApiOperation;
}

export interface EndpointGroup {
  tag: string;
  description?: string;
  endpoints: ParsedEndpoint[];
}

export interface GuideItem {
  id: string;
  title: string;
  summary: string;
  iconName: string;
  content: string;
}

export type CodeSnippetLang = 'curl' | 'node' | 'python' | 'php' | 'n8n';

export interface TryItExecutionResult {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  data: any;
  error?: string;
}
