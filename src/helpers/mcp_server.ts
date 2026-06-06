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
 * The empty raw shape. Used as the inferred default for a tool or prompt that does not declare
 * an input/args schema, so its callback receives an empty `args` object instead of an untyped
 * `Record<string, any>` bag.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type McpEmptyShape = {};

/**
 * A tool list whose element input schemas are inferred per element via a reverse-mapped tuple.
 * This is the fallback signature shape for `create_mcp_server` / `McpRouter` / `define_mcp_tools`
 * when the tools array exceeds the fixed-arity overloads: callback `args` stay precisely typed
 * (as long as every element declares an `inputSchema`), but `structuredContent` is not checked
 * against `outputSchema` at this level (the SDK still validates it at runtime).
 *
 * Note: if any element omits `inputSchema`, TypeScript cannot invert the mapped type and the
 * whole list falls back to loosely typed callbacks. Declare `inputSchema: {}` on no-argument
 * tools to keep inference intact.
 */
export type McpToolList<Inputs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]> = {
    [K in keyof Inputs]: McpTool<Inputs[K], ZodRawShapeCompat>;
};

/**
 * A prompt list whose element args schemas are inferred per element via a reverse-mapped tuple.
 * Same inversion caveat as `McpToolList`: declare `argsSchema: {}` on no-argument prompts to
 * keep inference intact for the whole list.
 */
export type McpPromptList<PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]> = {
    [K in keyof PromptArgs]: McpPrompt<PromptArgs[K]>;
};

/**
 * Configuration accepted by `create_mcp_server` and the config form of `McpRouter`.
 * `implementation` is required; everything else is optional. Each primitive array
 * (`tools`, `resources`, `prompts`) is registered on the returned `McpServer` in
 * declaration order.
 *
 * The `Tools` and `PromptArgs` parameters exist so the fixed-arity overloads of
 * `create_mcp_server` / `McpRouter` can type each tool and prompt element individually;
 * consumers annotating a config variable can use the bare `McpServerConfig` alias.
 */
export type McpServerConfigFor<
    Tools extends readonly McpTool<any, any>[] = McpTool[],
    PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
> = {
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
    tools?: Tools;
    /**
     * Resources to register on the server. Each entry may be a static URI or a
     * `ResourceTemplate`. See `McpResource`.
     */
    resources?: McpResource[];
    /**
     * Prompts to register on the server. See `McpPrompt`.
     */
    prompts?: McpPromptList<PromptArgs>;
}

/**
 * Backwards-compatible, non-generic config shape. Equivalent to
 * `McpServerConfigFor<McpTool[], ZodRawShapeCompat[]>`.
 */
export type McpServerConfig = McpServerConfigFor;

/**
 * The call-signature ladder shared by every config-form MCP factory: `create_mcp_server` and
 * the config form of `McpRouter`. Declared once so the two factories cannot drift.
 *
 * Fixed-arity signatures (up to 12 tools) infer each tool's `inputSchema`/`outputSchema`
 * independently, so inline tool literals get precisely typed callback `args` and a checked
 * `structuredContent` return. The final signature is the fallback for tools arrays beyond
 * twelve entries (or non-tuple arrays): `args` stay inferred per element while
 * `structuredContent` is left to the SDK's runtime validation; see `McpToolList`. Prompt
 * `argsSchema` types flow into prompt callbacks in every signature.
 */
export interface McpConfigFactory<FactoryResult, ExtraArgs extends readonly unknown[] = []> {
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>, McpTool<I6, O6>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
        McpTool<I9, O9>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I10 extends ZodRawShapeCompat = McpEmptyShape, O10 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
        McpTool<I9, O9>, McpTool<I10, O10>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I10 extends ZodRawShapeCompat = McpEmptyShape, O10 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I11 extends ZodRawShapeCompat = McpEmptyShape, O11 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
        McpTool<I9, O9>, McpTool<I10, O10>, McpTool<I11, O11>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I10 extends ZodRawShapeCompat = McpEmptyShape, O10 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I11 extends ZodRawShapeCompat = McpEmptyShape, O11 extends ZodRawShapeCompat = ZodRawShapeCompat,
        I12 extends ZodRawShapeCompat = McpEmptyShape, O12 extends ZodRawShapeCompat = ZodRawShapeCompat,
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<readonly [
        McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
        McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
        McpTool<I9, O9>, McpTool<I10, O10>, McpTool<I11, O11>, McpTool<I12, O12>
    ], PromptArgs>, ...extra: ExtraArgs): FactoryResult;
    <
        Inputs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[],
        PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
    > (config: McpServerConfigFor<McpToolList<Inputs>, PromptArgs>, ...extra: ExtraArgs): FactoryResult;
}

/**
 * Creates a new `McpServer` instance and registers the supplied primitives on it. Tool,
 * resource, and prompt schemas are forwarded to the SDK so requests are validated at runtime,
 * and each callback signature is type-checked against its declared schema at compile time.
 * See `McpConfigFactory` for how the `tools` / `prompts` schema types flow into callbacks.
 *
 * @param config Server identity, SDK options, and the primitive arrays to register.
 */
export const create_mcp_server: McpConfigFactory<McpServer> = function (
    config: McpServerConfigFor<readonly McpTool<any, any>[], readonly ZodRawShapeCompat[]>
): McpServer {
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
};

/**
 * Identity helper that locks in per-element `inputSchema` / `outputSchema` inference for a
 * whole tools array defined outside a `create_mcp_server` / `McpRouter` call. One wrapper
 * around the array replaces wrapping every element with `define_mcp_tool`. Do NOT annotate
 * the result (or the array) as `McpTool[]`; the annotation widens every element back to the
 * default generics and erases the inference this helper provides.
 *
 * Fixed-arity overloads cover up to twelve tools with full input and output typing; larger
 * arrays fall back to per-element `args` inference only, with `structuredContent` left to the
 * SDK's runtime validation (see `McpToolList`).
 */
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>
]): readonly [
    McpTool<I1, O1>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I10 extends ZodRawShapeCompat = McpEmptyShape, O10 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>, McpTool<I10, O10>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>, McpTool<I10, O10>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I10 extends ZodRawShapeCompat = McpEmptyShape, O10 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I11 extends ZodRawShapeCompat = McpEmptyShape, O11 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>, McpTool<I10, O10>, McpTool<I11, O11>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>, McpTool<I10, O10>, McpTool<I11, O11>
];
export function define_mcp_tools<
    I1 extends ZodRawShapeCompat = McpEmptyShape, O1 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I2 extends ZodRawShapeCompat = McpEmptyShape, O2 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I3 extends ZodRawShapeCompat = McpEmptyShape, O3 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I4 extends ZodRawShapeCompat = McpEmptyShape, O4 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I5 extends ZodRawShapeCompat = McpEmptyShape, O5 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I6 extends ZodRawShapeCompat = McpEmptyShape, O6 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I7 extends ZodRawShapeCompat = McpEmptyShape, O7 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I8 extends ZodRawShapeCompat = McpEmptyShape, O8 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I9 extends ZodRawShapeCompat = McpEmptyShape, O9 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I10 extends ZodRawShapeCompat = McpEmptyShape, O10 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I11 extends ZodRawShapeCompat = McpEmptyShape, O11 extends ZodRawShapeCompat = ZodRawShapeCompat,
    I12 extends ZodRawShapeCompat = McpEmptyShape, O12 extends ZodRawShapeCompat = ZodRawShapeCompat
> (tools: readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>, McpTool<I10, O10>, McpTool<I11, O11>, McpTool<I12, O12>
]): readonly [
    McpTool<I1, O1>, McpTool<I2, O2>, McpTool<I3, O3>, McpTool<I4, O4>,
    McpTool<I5, O5>, McpTool<I6, O6>, McpTool<I7, O7>, McpTool<I8, O8>,
    McpTool<I9, O9>, McpTool<I10, O10>, McpTool<I11, O11>, McpTool<I12, O12>
];
/**
 * Fallback signature for tools arrays beyond twelve entries; see `McpToolList`.
 */
export function define_mcp_tools<
    Inputs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
> (tools: McpToolList<Inputs>): McpToolList<Inputs>;
export function define_mcp_tools (tools: readonly McpTool<any, any>[]): any {
    return tools;
}

/**
 * Identity helper that locks in per-element `argsSchema` inference for a whole prompts array
 * defined outside a `create_mcp_server` / `McpRouter` call. One wrapper around the array
 * replaces wrapping every element with `define_mcp_prompt`. Do NOT annotate the result (or
 * the array) as `McpPrompt[]`; the annotation widens every element back to the default
 * generic and erases the inference this helper provides.
 */
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>
]): readonly [
    McpPrompt<A1>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape,
    A6 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape,
    A6 extends ZodRawShapeCompat = McpEmptyShape,
    A7 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape,
    A6 extends ZodRawShapeCompat = McpEmptyShape,
    A7 extends ZodRawShapeCompat = McpEmptyShape,
    A8 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape,
    A6 extends ZodRawShapeCompat = McpEmptyShape,
    A7 extends ZodRawShapeCompat = McpEmptyShape,
    A8 extends ZodRawShapeCompat = McpEmptyShape,
    A9 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape,
    A6 extends ZodRawShapeCompat = McpEmptyShape,
    A7 extends ZodRawShapeCompat = McpEmptyShape,
    A8 extends ZodRawShapeCompat = McpEmptyShape,
    A9 extends ZodRawShapeCompat = McpEmptyShape,
    A10 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>, McpPrompt<A10>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>, McpPrompt<A10>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape,
    A6 extends ZodRawShapeCompat = McpEmptyShape,
    A7 extends ZodRawShapeCompat = McpEmptyShape,
    A8 extends ZodRawShapeCompat = McpEmptyShape,
    A9 extends ZodRawShapeCompat = McpEmptyShape,
    A10 extends ZodRawShapeCompat = McpEmptyShape,
    A11 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>, McpPrompt<A10>, McpPrompt<A11>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>, McpPrompt<A10>, McpPrompt<A11>
];
export function define_mcp_prompts<
    A1 extends ZodRawShapeCompat = McpEmptyShape,
    A2 extends ZodRawShapeCompat = McpEmptyShape,
    A3 extends ZodRawShapeCompat = McpEmptyShape,
    A4 extends ZodRawShapeCompat = McpEmptyShape,
    A5 extends ZodRawShapeCompat = McpEmptyShape,
    A6 extends ZodRawShapeCompat = McpEmptyShape,
    A7 extends ZodRawShapeCompat = McpEmptyShape,
    A8 extends ZodRawShapeCompat = McpEmptyShape,
    A9 extends ZodRawShapeCompat = McpEmptyShape,
    A10 extends ZodRawShapeCompat = McpEmptyShape,
    A11 extends ZodRawShapeCompat = McpEmptyShape,
    A12 extends ZodRawShapeCompat = McpEmptyShape
> (prompts: readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>, McpPrompt<A10>, McpPrompt<A11>, McpPrompt<A12>
]): readonly [
    McpPrompt<A1>, McpPrompt<A2>, McpPrompt<A3>, McpPrompt<A4>, McpPrompt<A5>, McpPrompt<A6>,
    McpPrompt<A7>, McpPrompt<A8>, McpPrompt<A9>, McpPrompt<A10>, McpPrompt<A11>, McpPrompt<A12>
];
/**
 * Fallback signature for prompts arrays beyond twelve entries; see `McpPromptList`.
 */
export function define_mcp_prompts<
    PromptArgs extends readonly ZodRawShapeCompat[] = ZodRawShapeCompat[]
> (prompts: McpPromptList<PromptArgs>): McpPromptList<PromptArgs>;
export function define_mcp_prompts (prompts: readonly McpPrompt<any>[]): any {
    return prompts;
}
