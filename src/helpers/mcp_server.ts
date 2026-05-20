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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    Implementation as McpServerImplementation,
    ToolAnnotations,
    CallToolResult,
    ServerRequest,
    ServerNotification
} from '@modelcontextprotocol/sdk/types.js';
import { ServerOptions as McpServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { ZodRawShapeCompat, ShapeOutput } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export { McpServer, McpServerOptions, McpServerImplementation };

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
 * Pass an array of these to `create_mcp_server` to register them all in one shot.
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
 * Creates a new `McpServer` instance and registers the supplied tools on it. Each tool's
 * `inputSchema` and `outputSchema` are forwarded to the SDK so requests and responses are
 * validated at runtime, and the callback signature is type-checked against both schemas
 * at compile time.
 *
 * @param implementation
 * @param serverOptions
 * @param tools
 */
export function create_mcp_server (
    implementation: McpServerImplementation,
    serverOptions?: McpServerOptions,
    tools: McpTool[] = []
): McpServer {
    const server = new McpServer(implementation, serverOptions);

    for (const tool of tools) {
        server.registerTool<ZodRawShapeCompat, ZodRawShapeCompat>(tool.name, {
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: tool.annotations
        }, tool.callback);
    }

    return server;
}
