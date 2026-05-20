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

import type express from 'express';
import { ProtectedRouter } from './protected_router';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import Logger from '@gibme/logger';
import { v4 as uuid } from 'uuid';

export type McpRouter = ProtectedRouter;

/** @ignore */
const json_rpc_error = (code: number, message: string) => ({
    jsonrpc: '2.0' as const,
    error: { code, message },
    id: null
});

/** @ignore */
const safe_dispatch = async (
    context: string,
    transport: StreamableHTTPServerTransport,
    request: express.Request,
    response: express.Response,
    body?: unknown
): Promise<void> => {
    try {
        await transport.handleRequest(request, response, body);
    } catch (error) {
        Logger.error('MCP %s failed: %s', context, error);
        if (!response.headersSent) {
            response.status(500).json(json_rpc_error(-32603, 'Internal error'));
            return;
        }
        if (!response.writableEnded) {
            response.end();
        }
    }
};

/**
 * Creates a mountable Router that hosts an MCP server over the Streamable HTTP transport.
 * Each client session gets its own `McpServer` instance (constructed via `create_server`)
 * and its own transport, keyed by the `mcp-session-id` header. POST without a session ID
 * initializes a new session; POST with a known session ID dispatches to the existing
 * transport; GET streams server-to-client notifications for an existing session; DELETE
 * terminates a session.
 *
 * The returned router is a `ProtectedRouter`, so callers can install an
 * `AuthenticationProvider` to gate every MCP request.
 *
 * @param create_server Factory invoked once per new client session to build the `McpServer`
 *                      that will own the session's tools, resources, and prompts.
 */
export function McpRouter (create_server: () => McpServer): McpRouter {
    const router = ProtectedRouter();

    const transports = new Map<string, StreamableHTTPServerTransport>();

    router.post('/', async (request, response) => {
        const session_id = request.header('mcp-session-id');

        if (session_id) {
            const transport = transports.get(session_id);
            if (!transport) {
                return response.status(404).send();
            }
            return safe_dispatch('POST dispatch', transport, request, response, request.body);
        }

        if (!isInitializeRequest(request.body)) {
            return response.status(400).json(
                json_rpc_error(-32000, 'Bad Request: No valid session ID provided')
            );
        }

        const server = create_server();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => uuid(),
            onsessioninitialized: id => {
                transports.set(id, transport);
            }
        });

        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
            }
        };

        try {
            await server.connect(transport);
        } catch (error) {
            Logger.error('MCP session initialization failed: %s', error);
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
            }
            await transport.close().catch(() => {});
            if (!response.headersSent) {
                return response.status(500).json(
                    json_rpc_error(-32603, 'Internal error during session initialization')
                );
            }
            if (!response.writableEnded) {
                response.end();
            }
            return;
        }

        return safe_dispatch('POST init', transport, request, response, request.body);
    });

    router.get('/', async (request, response) => {
        const session_id = request.header('mcp-session-id');
        if (!session_id) {
            return response.status(400).json(json_rpc_error(-32000, 'Missing session ID'));
        }
        const transport = transports.get(session_id);
        if (!transport) {
            return response.status(404).end();
        }
        return safe_dispatch('GET stream', transport, request, response);
    });

    router.delete('/', async (request, response) => {
        const session_id = request.header('mcp-session-id');
        if (!session_id) {
            return response.status(400).json(json_rpc_error(-32000, 'Missing session ID'));
        }
        const transport = transports.get(session_id);
        if (!transport) {
            return response.status(404).end();
        }
        try {
            await safe_dispatch('DELETE', transport, request, response);
        } finally {
            transports.delete(session_id);
        }
    });

    return router;
}
