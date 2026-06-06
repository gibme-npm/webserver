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
import {
    create_mcp_server,
    McpConfigFactory,
    McpServerConfigFor,
    McpTool
} from './mcp_server';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import Logger from '@gibme/logger';
import { v4 as uuid } from 'uuid';

export type McpRouter = ProtectedRouter;

/**
 * Optional per-session lifecycle controls for the MCP transport map. When unset,
 * the router keeps every initialized session until its transport closes or the
 * client sends DELETE. Long-lived deployments that see many short clients without
 * an explicit DELETE should set at least `idleTimeoutMs`.
 */
export type McpSessionOptions = {
    /**
     * Close sessions whose last successful dispatch was longer than this many
     * milliseconds ago. Refreshed on every POST/GET/DELETE that lands on the
     * session's transport.
     */
    idleTimeoutMs?: number;
    /**
     * Close sessions older than this many milliseconds regardless of activity.
     */
    maxAgeMs?: number;
    /**
     * Cap on the number of concurrent sessions. When a new session would push
     * the total above the cap, the oldest (least-recently-active) session is
     * evicted before the new one is admitted.
     */
    maxSessions?: number;
    /**
     * Sweep interval in milliseconds. Defaults to `min(idleTimeoutMs, maxAgeMs) / 4`
     * capped at 60 seconds. Ignored when neither idle nor max-age is set.
     */
    sweepIntervalMs?: number;
};

/** @ignore */
type SessionRecord = {
    transport: StreamableHTTPServerTransport;
    createdAt: number;
    lastActivityAt: number;
};

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
 * Each client session gets its own `McpServer` instance and its own transport, keyed by the
 * `mcp-session-id` header. POST without a session ID initializes a new session; POST with a
 * known session ID dispatches to the existing transport; GET streams server-to-client
 * notifications for an existing session; DELETE terminates a session.
 *
 * The returned router is a `ProtectedRouter`, so callers can install an
 * `AuthenticationProvider` to gate every MCP request.
 *
 * Two ways to specify the per-session server:
 * - Pass a `() => McpServer` factory when the server needs per-session state captured in a
 *   closure (DB connections, session-scoped caches, etc.).
 * - Pass an `McpServerConfig` bundle (the same shape `create_mcp_server` accepts) when the
 *   server is fully described by its declarative primitive list. The config call signatures
 *   are shared with `create_mcp_server` via `McpConfigFactory`, so each tool's and prompt's
 *   schema types flow into its callback identically in both factories.
 */
export const McpRouter: {
    /**
     * @param create_server Factory invoked once per new client session to build the `McpServer`.
     * @param sessionOptions Optional per-session lifecycle controls (idle timeout, max age, cap).
     */
    (create_server: () => McpServer, sessionOptions?: McpSessionOptions): McpRouter;
} & McpConfigFactory<McpRouter, [sessionOptions?: McpSessionOptions]> = function (
    source: (() => McpServer) | McpServerConfigFor<readonly McpTool<any, any>[], readonly ZodRawShapeCompat[]>,
    sessionOptions?: McpSessionOptions
): McpRouter {
    const create_server: () => McpServer = typeof source === 'function'
        ? source
        : () => create_mcp_server(source);

    const router = ProtectedRouter();

    const sessions = new Map<string, SessionRecord>();

    const idleTimeoutMs = sessionOptions?.idleTimeoutMs;
    const maxAgeMs = sessionOptions?.maxAgeMs;
    const maxSessions = sessionOptions?.maxSessions;

    const computeSweepInterval = (): number | undefined => {
        if (sessionOptions?.sweepIntervalMs) {
            return sessionOptions.sweepIntervalMs;
        }
        const candidates = [idleTimeoutMs, maxAgeMs].filter((v): v is number => typeof v === 'number' && v > 0);
        if (candidates.length === 0) return undefined;
        return Math.min(60_000, Math.max(50, Math.floor(Math.min(...candidates) / 4)));
    };

    const sweepIntervalMs = computeSweepInterval();
    let sweepTimer: NodeJS.Timeout | undefined;

    const removeSession = (sessionId: string, reason: string) => {
        const record = sessions.get(sessionId);
        if (!record) return;
        sessions.delete(sessionId);
        Logger.debug('MCP session %s evicted (%s)', sessionId, reason);
        record.transport.close().catch(() => { /* ignore close failures */ });
    };

    const sweep = () => {
        if (!idleTimeoutMs && !maxAgeMs) return;
        const now = Date.now();
        for (const [sessionId, record] of sessions) {
            if (idleTimeoutMs && now - record.lastActivityAt > idleTimeoutMs) {
                removeSession(sessionId, 'idle-timeout');
                continue;
            }
            if (maxAgeMs && now - record.createdAt > maxAgeMs) {
                removeSession(sessionId, 'max-age');
            }
        }
        if (sessions.size === 0) {
            stopSweeper();
        }
    };

    const startSweeper = () => {
        if (sweepTimer || !sweepIntervalMs) return;
        sweepTimer = setInterval(sweep, sweepIntervalMs);
        if (typeof sweepTimer.unref === 'function') {
            sweepTimer.unref();
        }
    };

    const stopSweeper = () => {
        if (!sweepTimer) return;
        clearInterval(sweepTimer);
        sweepTimer = undefined;
    };

    const touch = (sessionId: string | undefined) => {
        if (!sessionId) return;
        const record = sessions.get(sessionId);
        if (record) {
            record.lastActivityAt = Date.now();
        }
    };

    const evictOldestIfNeeded = () => {
        if (!maxSessions) return;
        while (sessions.size >= maxSessions) {
            let oldestId: string | undefined;
            let oldestActivity = Infinity;
            for (const [id, record] of sessions) {
                if (record.lastActivityAt < oldestActivity) {
                    oldestActivity = record.lastActivityAt;
                    oldestId = id;
                }
            }
            if (!oldestId) break;
            removeSession(oldestId, 'max-sessions');
        }
    };

    router.post('/', async (request, response) => {
        const session_id = request.header('mcp-session-id');

        if (session_id) {
            const record = sessions.get(session_id);
            if (!record) {
                return response.status(404).send();
            }
            touch(session_id);
            return safe_dispatch('POST dispatch', record.transport, request, response, request.body);
        }

        if (!isInitializeRequest(request.body)) {
            return response.status(400).json(
                json_rpc_error(-32000, 'Bad Request: No valid session ID provided')
            );
        }

        evictOldestIfNeeded();

        const server = create_server();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => uuid(),
            onsessioninitialized: id => {
                const now = Date.now();
                sessions.set(id, { transport, createdAt: now, lastActivityAt: now });
                if (sweepIntervalMs) startSweeper();
            }
        });

        transport.onclose = () => {
            if (transport.sessionId) {
                sessions.delete(transport.sessionId);
                if (sessions.size === 0) stopSweeper();
            }
        };

        try {
            await server.connect(transport);
        } catch (error) {
            Logger.error('MCP session initialization failed: %s', error);
            if (transport.sessionId) {
                sessions.delete(transport.sessionId);
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
        const record = sessions.get(session_id);
        if (!record) {
            return response.status(404).end();
        }
        touch(session_id);
        return safe_dispatch('GET stream', record.transport, request, response);
    });

    router.delete('/', async (request, response) => {
        const session_id = request.header('mcp-session-id');
        if (!session_id) {
            return response.status(400).json(json_rpc_error(-32000, 'Missing session ID'));
        }
        const record = sessions.get(session_id);
        if (!record) {
            return response.status(404).end();
        }
        try {
            await safe_dispatch('DELETE', record.transport, request, response);
        } finally {
            sessions.delete(session_id);
            if (sessions.size === 0) stopSweeper();
        }
    });

    return router;
};
