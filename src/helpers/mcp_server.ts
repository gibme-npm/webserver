// Copyright (c) 2026, Brandon Lehmann <brandonlehmann@gmail.com>
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
    McpServer,
    ResourceTemplate as McpResourceTemplate,
    ResourceMetadata as McpResourceMetadata,
    ReadResourceCallback as McpReadResourceCallback,
    ReadResourceTemplateCallback as McpReadResourceTemplateCallback
} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    Implementation as McpServerImplementation,
    ToolAnnotations,
    CallToolResult,
    GetPromptResult,
    ServerRequest,
    ServerNotification
} from '@modelcontextprotocol/sdk/types.js';
import { ServerOptions as McpServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { ZodRawShapeCompat, ShapeOutput } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export {
    McpServer,
    McpServerOptions,
    McpServerImplementation,
    McpResourceTemplate,
    McpResourceMetadata,
    McpReadResourceCallback,
    McpReadResourceTemplateCallback
};

/**
 * The tool result shape returned from an `McpToolCallback`. Narrows `structuredContent` from
 * the SDK's default `Record<string, unknown>` to the shape inferred from the tool's
 * `outputSchema`, so the compiler catches mismatches between the declared output schema and
 * what the callback actually returns.
 */
export type McpToolResult<ToolOutputType extends ZodRawShapeCompat = ZodRawShapeCompat> =
    CallToolResult & {
        structuredContent?: ShapeOutput<ToolOutputType>;
    };

/**
 * The handler signature for a tool registered via `McpTool`. `args` is typed from the tool's
 * `inputSchema` and the return value is typed against the tool's `outputSchema`, providing
 * end-to-end type safety on both sides of the call.
 */
export type McpToolCallback<
    ToolInputType extends ZodRawShapeCompat = ZodRawShapeCompat,
    ToolOutputType extends ZodRawShapeCompat = ZodRawShapeCompat
> = (
    args: ShapeOutput<ToolInputType>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => McpToolResult<ToolOutputType> | Promise<McpToolResult<ToolOutputType>>;

/**
 * Descriptor for a single MCP tool registered on an `McpServer`. Bundles the tool's metadata,
 * its input and output schemas (as raw Zod shapes), and the callback that handles invocations.
 */
export type McpTool<ToolInputType extends ZodRawShapeCompat = ZodRawShapeCompat,
    ToolOutputType extends ZodRawShapeCompat = ZodRawShapeCompat> = {
    /**
     * The unique tool name used by clients to invoke this tool.
     */
    name: string;
    /**
     * Human-readable title surfaced to clients in tool listings.
     */
    title: string;
    /**
     * Human-readable description of what the tool does, surfaced to clients in tool listings.
     */
    description: string;
    /**
     * Raw Zod shape describing the arguments object the tool accepts.
     * Drives the type of `args` passed to `callback`.
     */
    inputSchema?: ToolInputType;
    /**
     * Raw Zod shape describing the `structuredContent` the tool returns.
     * Drives the type of `structuredContent` on the value returned by `callback`.
     */
    outputSchema?: ToolOutputType;
    /**
     * Optional behavioral hints (read-only, idempotent, open-world, etc.) surfaced to clients.
     */
    annotations?: ToolAnnotations;
    /**
     * The handler invoked when a client calls this tool.
     */
    callback: McpToolCallback<ToolInputType, ToolOutputType>;
}

/**
 * Identity helper that locks in `inputSchema` / `outputSchema` inference for an inline tool
 * descriptor. Use when writing tools as array elements of `tools: McpTool[]`, where the array
 * element type otherwise falls back to the default `ZodRawShapeCompat` generics and widens the
 * `callback` return type. Wrapping the descriptor with `define_mcp_tool({...})` causes TS to
 * solve `ToolInputType` and `ToolOutputType` from the literal `inputSchema` / `outputSchema`
 * before checking the callback body, so contextual typing flows precisely into the return
 * expression and `content: [{ type: 'text', ... }]` keeps its discriminator.
 */
export function define_mcp_tool<
    ToolInputType extends ZodRawShapeCompat = ZodRawShapeCompat,
    ToolOutputType extends ZodRawShapeCompat = ZodRawShapeCompat
> (tool: McpTool<ToolInputType, ToolOutputType>): McpTool<ToolInputType, ToolOutputType> {
    return tool;
}

/**
 * Descriptor for a single MCP resource registered on an `McpServer`. Resources expose
 * read-only, URI-addressable content to clients. Two flavors are supported via the `kind`
 * discriminator: a `static` resource bound to one fixed URI, or a `template` resource whose
 * URI follows a pattern (`users://{userId}`) with optional listing and completion callbacks.
 * `kind` defaults to `static` so the common case stays terse.
 */
export type McpResource =
    | {
        /**
         * Static resource bound to a single URI. Default when `kind` is omitted.
         */
        kind?: 'static';
        /**
         * Stable identifier used to register the resource.
         */
        name: string;
        /**
         * Concrete URI the client reads to fetch this resource.
         */
        uri: string;
        /**
         * Optional metadata surfaced to clients in resource listings (title, description,
         * mimeType, etc.).
         */
        metadata?: McpResourceMetadata;
        /**
         * Handler invoked when a client reads the resource at the bound URI.
         */
        readCallback: McpReadResourceCallback;
    }
    | {
        /**
         * Marks this descriptor as a template-based resource. Required to disambiguate from
         * the default `static` variant.
         */
        kind: 'template';
        /**
         * Stable identifier used to register the resource template.
         */
        name: string;
        /**
         * URI template (e.g. `users://{userId}`) along with optional `list` and `complete`
         * callbacks. Use `new ResourceTemplate(...)` from the SDK (re-exported here and on
         * the `MCP` namespace).
         */
        template: McpResourceTemplate;
        /**
         * Optional metadata surfaced to clients in resource listings.
         */
        metadata?: McpResourceMetadata;
        /**
         * Handler invoked when a client reads a concrete URI matching the template. Receives
         * the parsed variable bag from the URI template.
         */
        readCallback: McpReadResourceTemplateCallback;
    };

/**
 * The handler signature for a prompt registered via `McpPrompt`. `args` is typed from the
 * prompt's `argsSchema` so the compiler catches argument mismatches at the call site.
 */
export type McpPromptCallback<PromptArgsType extends ZodRawShapeCompat = ZodRawShapeCompat> = (
    args: ShapeOutput<PromptArgsType>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => GetPromptResult | Promise<GetPromptResult>;

/**
 * Descriptor for a single MCP prompt registered on an `McpServer`. Prompts are user-invoked
 * templates (typically surfaced as slash-commands or a prompt picker in the client) that
 * render into a message list when called with the user's arguments.
 */
export type McpPrompt<PromptArgsType extends ZodRawShapeCompat = ZodRawShapeCompat> = {
    /**
     * The unique prompt name used by clients to invoke this prompt.
     */
    name: string;
    /**
     * Human-readable title surfaced to clients in prompt listings.
     */
    title: string;
    /**
     * Human-readable description of what the prompt does, surfaced to clients in prompt
     * listings.
     */
    description: string;
    /**
     * Raw Zod shape describing the named arguments the prompt accepts. Drives the type of
     * `args` passed to `callback`.
     */
    argsSchema?: PromptArgsType;
    /**
     * The handler invoked when a client requests this prompt.
     */
    callback: McpPromptCallback<PromptArgsType>;
}

/**
 * Identity helper that locks in `argsSchema` inference for an inline prompt descriptor. Use
 * when writing prompts as array elements of `prompts: McpPrompt[]`, where the array element
 * type otherwise falls back to the default `ZodRawShapeCompat` generic and widens the `args`
 * parameter passed to `callback`. Wrapping with `define_mcp_prompt({...})` causes TS to solve
 * `PromptArgsType` from the literal `argsSchema` before checking the callback body, so `args`
 * is typed precisely against the declared shape.
 */
export function define_mcp_prompt<
    PromptArgsType extends ZodRawShapeCompat = ZodRawShapeCompat
> (prompt: McpPrompt<PromptArgsType>): McpPrompt<PromptArgsType> {
    return prompt;
}

/**
 * Configuration accepted by `create_mcp_server`. `implementation` is required; everything
 * else is optional. Each primitive array (`tools`, `resources`, `prompts`) is registered on
 * the returned `McpServer` in declaration order.
 */
export type McpServerConfig = {
    /**
     * Server identity (name, version) surfaced to clients during initialization.
     */
    implementation: McpServerImplementation;
    /**
     * Underlying SDK `ServerOptions` (capabilities, instructions, etc.).
     */
    options?: McpServerOptions;
    /**
     * Tools to register on the server. See `McpTool`.
     */
    tools?: McpTool[];
    /**
     * Resources to register on the server. Each entry may be a static URI or a
     * `ResourceTemplate`. See `McpResource`.
     */
    resources?: McpResource[];
    /**
     * Prompts to register on the server. See `McpPrompt`.
     */
    prompts?: McpPrompt[];
}

/**
 * Creates a new `McpServer` instance and registers the supplied primitives on it. Tool,
 * resource, and prompt schemas are forwarded to the SDK so requests are validated at runtime,
 * and each callback signature is type-checked against its declared schema at compile time.
 *
 * @param config Server identity, SDK options, and the primitive arrays to register.
 */
export function create_mcp_server (config: McpServerConfig): McpServer {
    const server = new McpServer(config.implementation, config.options);

    for (const tool of config.tools ?? []) {
        server.registerTool<ZodRawShapeCompat, ZodRawShapeCompat>(tool.name, {
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: tool.annotations
        }, tool.callback);
    }

    for (const resource of config.resources ?? []) {
        if (resource.kind === 'template') {
            server.registerResource(
                resource.name,
                resource.template,
                resource.metadata ?? {},
                resource.readCallback
            );
        } else {
            server.registerResource(
                resource.name,
                resource.uri,
                resource.metadata ?? {},
                resource.readCallback
            );
        }
    }

    for (const prompt of config.prompts ?? []) {
        server.registerPrompt<ZodRawShapeCompat>(prompt.name, {
            title: prompt.title,
            description: prompt.description,
            argsSchema: prompt.argsSchema
        }, prompt.callback);
    }

    return server;
}
