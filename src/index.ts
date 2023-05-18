type RPCId = string | number | null;

export interface RPCRequest {
  jsonrpc: string;
  method: string;
  params?: any;
  id?: RPCId;
}

export interface RPCResponse<TResult = any, TError = any> {
  jsonrpc: string;
  result?: TResult;
  error?: RPCError<TError>;
  id: RPCId;
}

export interface RPCError<T = any> extends Error {
  code: number;
  message: string;
  data?: T;
  new <T>(code: number, message?: string, data?: T): RPCError<T>;
}

export class RPCError<T> implements RPCError<T> {
  constructor(code: number, message?: string, data?: T) {
    this.name = 'RPCError'
    this.code = code;
    this.message =
      (((code <= -32600 && code >= -32603) || code === -32700) && !message)
      ? RPCErrorCode[code].replace(/([A-Z])/g, ' $1').trim().toLowerCase()
      : (message ?? 'Unknown error');
    this.data = data;
  }
}

export enum RPCErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
}

export interface HttpError extends Error {
  status: number;
  statusText: string;
  new (status: number, statusText: string): HttpError;
}

export class HttpError implements HttpError {
  constructor(status: number, statusText: string) {
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.message = `${status} ${statusText}`;
  }
}

export interface RequestContext {
  url: URL | string;
  request: RequestInit;
}

export interface ResponseContext<TResult> {
  rpcResponse: RPCResponse<TResult>;
  response: Response;
  data?: TResult;
}

export interface RPCFetchOptions {
  url: string | URL;
  options?: {
    beforeFetch?: (request: RequestContext) => RequestContext,
    onResponse?: <TResult>(response: ResponseContext<TResult>) => ResponseContext<TResult>,
    onError?: (error: Error) => Error,
    idGenerator?: false | (() => RPCId),
  };
  fetchOptions?: RequestInit;
}

export function createFetch(options: RPCFetchOptions, fetch_: typeof fetch = fetch) {
  const defaultRequestInit: Readonly<RequestInit> = Object.freeze({
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST'
  } as RequestInit)
  const userRequestInit: Readonly<RequestInit> = Object.freeze({
    ...options.fetchOptions
  })
  const generateRequestInit = () => {
    return {
      ...defaultRequestInit,
      ...userRequestInit
    } as RequestInit;
  }

  const extractParams = (params: any[]) => {
    if (params.length === 0) {
      return undefined;
    }
    if (params.length === 1
        && typeof params[0] === 'object'
        && !Array.isArray(params[0])) {
      return params[0];
    }
    return params;
  }

  const request = <TResult = any, TError = any>(method: string, ...params: any[]) => {
    const id = options.options?.idGenerator
      ? options.options.idGenerator()
      : null;
    const body: RPCRequest = {
      jsonrpc: '2.0',
      method,
      params: extractParams(params),
      id,
    }
    const preRequestInit = generateRequestInit();
    preRequestInit.body = JSON.stringify(body);
    const {url, request} = (options.options?.beforeFetch ?? ((a: RequestContext) => a))({
      url: new URL(options.url.toString()),
      request: preRequestInit,
    });
    return new Promise<ResponseContext<TResult>>(async (resolve, reject) => {
      try {
        const response = await fetch_(url, request)
        if (!response.ok) {
          reject(new HttpError(response.status, response.statusText));
          return;
        }
        const rpcResponse = await response.json() as RPCResponse<TResult, TError>;
        const result = {
          rpcResponse,
          response,
        } as ResponseContext<TResult>;
        if (rpcResponse.error) {
          throw new RPCError(
            rpcResponse.error.code,
            rpcResponse.error.message,
            rpcResponse.error.data
          );
        } else {
          result.data = rpcResponse.result;
        }
        resolve(
          (options.options?.onResponse ?? ((a: ResponseContext<TResult>) => a))(result)
        );
      } catch (e) {
        reject(
          (options.options?.onError ?? ((a: Error) => a))(e as Error)
        );
      }
    });
  }

  return { request };
}

export const createMockRPCResponse = <TResult = any>(result: TResult): RPCResponse<TResult> => ({
  jsonrpc: '2.0',
  result,
  id: null
});

export const createMockRPCErrorResponse =
  <TError = any>(code: number, message?: string, data?: TError): RPCResponse<null, TError> => ({
    jsonrpc: '2.0',
    error: new RPCError(code, message, data),
    id: null
  });

export type MockRPCAction = (rpcRequest: RPCRequest, request: RequestInit) => RPCResponse | HttpError;

export function createMockFetch(actions: Record<string, MockRPCAction>, options?: { delay?: number }) {
  const delay = options?.delay ?? 0;
  const fetch = async (_: URL | RequestInfo, request?: RequestInit) => {
    await new Promise(resolve => setTimeout(resolve, delay));
    const rpcRequest = JSON.parse(request!.body as string) as RPCRequest;
    const action = actions[rpcRequest.method];
    if (!action) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: new RPCError(RPCErrorCode.MethodNotFound),
        id: rpcRequest.id,
      } as RPCResponse))
    }
    const response = action(rpcRequest, request!);
    if (response instanceof HttpError) {
      return new Response(response.message, {
        status: response.status,
        statusText: response.statusText,
      });
    }
    if (rpcRequest.id) {
      response.id = rpcRequest.id;
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  return fetch;
}
