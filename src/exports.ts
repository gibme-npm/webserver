// Copyright (c) 2018-2025, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import {
    createProxyMiddleware,
    Options as ProxyOptions,
    fixRequestBody as ProxyFixRequestBody,
    responseInterceptor as ProxyResponseInterceptor,
    RequestHandler as ProxyRequestHandler,
    loggerPlugin as ProxyLoggerPlugin,
    proxyEventsPlugin as ProxyEventsPlugin,
    Filter as ProxyFilter,
    Plugin as ProxyPlugin,
    errorResponsePlugin as ProxyErrorResponsePlugin,
    debugProxyErrorsPlugin as ProxyDebugProxyErrorsPlugin
} from 'http-proxy-middleware';
import {
    create_mcp_server,
    define_mcp_tool,
    define_mcp_tools,
    define_mcp_prompt,
    define_mcp_prompts,
    McpServer,
    McpServerOptions,
    McpServerImplementation,
    McpServerConfig,
    McpServerConfigFor,
    McpEmptyShape,
    McpTool,
    McpToolCallback,
    McpToolList,
    McpToolResult,
    McpResource,
    McpResourceTemplate,
    McpResourceMetadata,
    McpReadResourceCallback,
    McpReadResourceTemplateCallback,
    McpPrompt,
    McpPromptCallback,
    McpPromptList
} from './helpers/mcp_server';
import { McpRouter, McpSessionOptions } from './helpers/mcp_router';
import type { ToolAnnotations as McpToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';

export { Router } from './helpers/router';
export { ProtectedRouter } from './helpers/protected_router';
export { Request, Response } from 'express';
export { Logger } from '@gibme/logger';
export { Store } from 'express-session';
export { default as multer } from 'multer';
export { z as zod } from 'zod';
export { default as RateLimit, createInMemoryRateLimitStore } from './middleware/rate_limit';
export { default as CSRF } from './middleware/csrf';

export namespace Proxy {
    export const createMiddleware = createProxyMiddleware;
    export type Options = ProxyOptions;
    export const fixRequestBody = ProxyFixRequestBody;
    export const responseInterceptor = ProxyResponseInterceptor;
    export type RequestHandler = ProxyRequestHandler;
    export const loggerPlugin = ProxyLoggerPlugin;
    export const eventsPlugin = ProxyEventsPlugin;
    export type Filter = ProxyFilter;
    export type Plugin = ProxyPlugin;
    export const ErrorResponsePlugin = ProxyErrorResponsePlugin;
    export const DebugProxyErrorsPlugin = ProxyDebugProxyErrorsPlugin;
}

export namespace MCP {
    export const createServer = create_mcp_server;
    export const Server = McpServer;
    export const Router = McpRouter;
    export type Router = McpRouter;
    export const ResourceTemplate = McpResourceTemplate;
    export type ResourceTemplate = McpResourceTemplate;
    export type ServerOptions = McpServerOptions;
    export type ServerImplementation = McpServerImplementation;
    export type ServerConfig = McpServerConfig;
    export type ServerConfigFor<
        Tools extends readonly McpTool<any, any>[] = McpTool[],
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > = McpServerConfigFor<Tools, PromptArgs>;
    export type EmptyShape = McpEmptyShape;
    export const Tool = define_mcp_tool;
    export const Tools = define_mcp_tools;
    export type ToolList<Inputs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]> =
        McpToolList<Inputs>;
    export type Tool<
        ToolInputType extends ZodRawShapeCompat = ZodRawShapeCompat,
        ToolOutputType extends ZodRawShapeCompat = ZodRawShapeCompat
    > = McpTool<ToolInputType, ToolOutputType>;
    export type ToolCallback<
        ToolInputType extends ZodRawShapeCompat = ZodRawShapeCompat,
        ToolOutputType extends ZodRawShapeCompat = ZodRawShapeCompat
    > = McpToolCallback<ToolInputType, ToolOutputType>;
    export type ToolResult<ToolOutputType extends ZodRawShapeCompat = ZodRawShapeCompat> =
        McpToolResult<ToolOutputType>;
    export type ToolAnnotations = McpToolAnnotations;
    export type Resource = McpResource;
    export type ResourceMetadata = McpResourceMetadata;
    export type ResourceCallback = McpReadResourceCallback;
    export type TemplatedResourceCallback = McpReadResourceTemplateCallback;
    export const Prompt = define_mcp_prompt;
    export const Prompts = define_mcp_prompts;
    export type Prompt<PromptArgsType extends ZodRawShapeCompat = ZodRawShapeCompat> =
        McpPrompt<PromptArgsType>;
    export type PromptCallback<PromptArgsType extends ZodRawShapeCompat = ZodRawShapeCompat> =
        McpPromptCallback<PromptArgsType>;
    export type PromptList<PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]> =
        McpPromptList<PromptArgs>;
    export type PromptArgsShape = ZodRawShapeCompat;
    export type SessionOptions = McpSessionOptions;
}

export type {
    AuthenticationProvider,
    AuthenticationResult,
    CorsOptions,
    CorsOrigin,
    CSPDirectives,
    ErrorSink,
    ErrorSinkContext,
    LogEntry,
    XMLParserOptions,
    XMLValidatorOptions,
    RateLimitOptions,
    RateLimitStore,
    RateLimitBucket,
    RateLimitInfo,
    CSRFOptions,
    CSRFSecret
} from './middleware';
