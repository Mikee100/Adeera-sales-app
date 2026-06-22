import { API_BASE_URL } from './config';
import type { paths } from '../openapi.generated';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';
type PathKey = Extract<keyof paths, string>;
type MethodKey<P extends PathKey> = Extract<keyof paths[P], HttpMethod>;
type Operation<P extends PathKey, M extends MethodKey<P>> = paths[P][M];

type JsonContent<T> = T extends { content: { 'application/json': infer C } } ? C : unknown;
type ResponseMap<T> = T extends { responses: infer R } ? R : never;

type SuccessJson<T> =
  ResponseMap<T> extends infer R
    ? R extends Record<number, unknown>
      ? 200 extends keyof R
        ? JsonContent<R[200]>
        : 201 extends keyof R
          ? JsonContent<R[201]>
          : 202 extends keyof R
            ? JsonContent<R[202]>
            : 204 extends keyof R
              ? void
              : unknown
      : unknown
    : unknown;

type RequestJson<T> = T extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : never;

type ParametersOf<T> = T extends { parameters: infer P } ? P : never;
type PathParams<T> = ParametersOf<T> extends { path: infer P } ? P : never;
type QueryParams<T> = ParametersOf<T> extends { query: infer Q } ? Q : never;

function buildPath(pathTemplate: string, pathParams?: Record<string, unknown>): string {
  if (!pathParams) return pathTemplate;

  return pathTemplate.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const raw = pathParams[key];
    if (raw === undefined || raw === null) {
      throw new Error(`Missing required path parameter: ${key}`);
    }
    return encodeURIComponent(String(raw));
  });
}

function appendQuery(url: URL, query?: Record<string, unknown>): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }

    url.searchParams.append(key, String(value));
  }
}

export async function openApiRequest<P extends PathKey, M extends MethodKey<P>>(
  path: P,
  method: M,
  options?: {
    params?: {
      path?: PathParams<Operation<P, M>>;
      query?: QueryParams<Operation<P, M>>;
    };
    body?: RequestJson<Operation<P, M>>;
    headers?: Record<string, string>;
    authToken?: string;
    signal?: AbortSignal;
    baseUrl?: string;
  },
): Promise<SuccessJson<Operation<P, M>>> {
  const relativePath = buildPath(path, options?.params?.path as Record<string, unknown> | undefined);
  const base = (options?.baseUrl || API_BASE_URL).replace(/\/+$/, '');
  const url = new URL(`${base}${relativePath}`);
  appendQuery(url, options?.params?.query as Record<string, unknown> | undefined);

  const response = await fetch(url.toString(), {
    method: String(method).toUpperCase(),
    headers: {
      'Content-Type': 'application/json',
      ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
      ...(options?.headers || {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAPI request failed (${response.status}): ${text || response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as SuccessJson<Operation<P, M>>;
  }

  return (await response.json()) as SuccessJson<Operation<P, M>>;
}
