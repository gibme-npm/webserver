// Copyright (c) 2025, Brandon Lehmann <brandonlehmann@gmail.com>
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

import express from 'express';
import http from 'http';
import type https from 'https';
import { Stream } from 'stream';
import ws from 'ws';
import { URL } from 'url';
import type { CipherKey } from 'crypto';
import { parse_authorization_header } from '../middleware/authorization';
import { parse_cookies } from '../middleware/cookies';
import { AuthenticationProvider, AuthenticationResult, runAuthenticationProvider } from '../middleware/protected';
import { ErrorSink, invoke_error_sink } from '../middleware/error_sink';
import { ProtectedRouterBrand } from './protected_router';

/** @ignore */
const resolve_route_path = (basePath: string, route: string): string => {
    const normalizedBase = basePath.replace(/\/+$/, '') || '';

    const normalizedRoute = route.startsWith('/') ? route : `/${route}`;

    return `${normalizedBase}${normalizedRoute}`.replace(/\/+/g, '/');
};

/** @ignore */
const matchPath = (pathname: string, pattern: string): { params: any } | undefined => {
    // Exact match or wildcard
    if (pattern === pathname || pattern === '*') {
        return { params: {} };
    }

    const pathSegments = pathname.split('/').filter(Boolean);

    const patternSegments = pattern.split('/').filter(Boolean);

    // Different number of segments means no match
    if (pathSegments.length !== patternSegments.length) {
        return;
    }

    const params: any = {};

    for (let i = 0; i < patternSegments.length; i++) {
        const patternSegment = patternSegments[i];

        const pathSegment = pathSegments[i];

        if (patternSegment.startsWith(':')) {
            // Parameter segment
            params[patternSegment.slice(1)] = pathSegment;
        } else if (patternSegment !== pathSegment) {
            // Literal segment that doesn't match
            return;
        }
    }

    return { params };
};

/** @ignore */
const write_auth_denied_response = (
    socket: Stream.Duplex,
    result: Extract<AuthenticationResult, { ok: false }>,
    errorSink?: ErrorSink
) => {
    const statusCode = result.statusCode || 401;
    let body = '';
    let contentType = 'text/plain';

    if (typeof result.message === 'string') {
        body = result.message;
    } else if (result.message && typeof result.message === 'object') {
        body = JSON.stringify(result.message);
        contentType = 'application/json';
    }

    const reasonPhrase = http.STATUS_CODES[statusCode] ?? '';
    const lines = [
        `HTTP/1.1 ${statusCode} ${reasonPhrase}`,
        `Content-Type: ${contentType}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        body
    ];

    // socket.end() sends FIN; write()+destroy() sends RST after flush. Since `ws`
    // has already handed the socket to the client via 'unexpected-response', an RST
    // surfaces as ECONNRESET on ClientRequest -> uncaught + node:test post-end failure.
    try {
        socket.end(lines.join('\r\n'));
    } catch (error) {
        invoke_error_sink(errorSink, error, 'websocket-write');
        socket.destroy();
    }
};

/** @ignore */
const parse_ws_args = (args: any[]): {
    route: string;
    auth?: AuthenticationProvider;
    handler: WebSocket.WebSocketHandler;
} => {
    const [route, ...rest] = args;

    if (rest.length === 1) {
        return { route, handler: rest[0] };
    }

    // (route, auth, handler) form
    return { route, auth: rest[0], handler: rest[1] };
};

/** @ignore */
const wrap_protected_router_auth = (instance: any): AuthenticationProvider | undefined => {
    if (instance?.[ProtectedRouterBrand] !== true) return undefined;

    const accessor = instance._protectedRouterProvider as
        | (() => AuthenticationProvider | undefined)
        | undefined;

    if (typeof accessor !== 'function') return undefined;

    return async (request) => {
        const current = accessor();

        if (!current) {
            return true;
        }

        return current(request);
    };
};

/**
 * Adds websocket support to an express application
 * @param app
 * @param server
 * @param options
 */
export function WebSocket (
    app: express.Application,
    server: http.Server | https.Server,
    options: WebSocket.Options = {}
): {
    app: WebSocket.Application;
    getWss: () => ws.WebSocketServer;
    applyTo: <T extends object>(router: T, mountPath?: string) => T & WebSocket.Router;
} {
    options ??= {};

    const wss = new ws.WebSocketServer({
        ...options.wsOptions,
        noServer: true
    });

    const cookieSecrets: CipherKey[] = options.cookieSecret
        ? (Array.isArray(options.cookieSecret) ? options.cookieSecret : [options.cookieSecret])
        : [];
    const errorSink: ErrorSink | undefined = options.errorSink;
    const wsAuth: AuthenticationProvider | undefined = options.wsAuth;
    const wsAuthTimeoutMs: number = typeof options.wsAuthTimeoutMs === 'number' ? options.wsAuthTimeoutMs : 30_000;

    const wsRoutes = new Map<string, {
        handler: WebSocket.WebSocketHandler;
        mountPath?: string;
        auth?: AuthenticationProvider;
    }>();
    const wsMiddleware: WebSocket.WebSocketHandler[] = [];

    const matchRoute = (pathname: string): {
        handler: WebSocket.WebSocketHandler;
        params: any;
        auth?: AuthenticationProvider;
    } | undefined => {
        for (const [route, entry] of wsRoutes) {
            const match = matchPath(pathname, route);
            if (match) {
                return { handler: entry.handler, params: match.params, auth: entry.auth };
            }
        }
    };

    const handle_upgrade = (request: http.IncomingMessage, socket: Stream.Duplex, head: Buffer) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
        const pathname = url.pathname;

        const match = matchRoute(pathname);

        if (!match) {
            socket.destroy();
            return;
        }

        const req = Object.create(request) as WebSocket.Request;
        req.params = match.params;
        req.query = Object.fromEntries(url.searchParams.entries());
        req.authorization = parse_authorization_header(request.headers.authorization, errorSink);

        const parsedCookies = parse_cookies(request.headers.cookie, cookieSecrets, errorSink);
        req.cookies = parsedCookies.cookies;
        req.signedCookies = parsedCookies.signedCookies;

        const effectiveAuth = match.auth ?? wsAuth;

        const proceed = () => {
            wss.handleUpgrade(request, socket, head, ws => {
                req.ws = ws;

                const next: express.NextFunction = (error?: any) => {
                    if (error) {
                        ws.close(1011, 'Internal Server Error');
                    }
                };

                let middleware_index = 0;
                const run_middleware = () => {
                    if (middleware_index < wsMiddleware.length) {
                        const middleware = wsMiddleware[middleware_index++];

                        try {
                            middleware(ws, req, () => {
                                run_middleware();
                            });
                        } catch (error: any) {
                            next(error);
                        }
                    } else {
                        try {
                            match.handler(ws, req, next);
                        } catch (error: any) {
                            next(error);
                        }
                    }
                };

                run_middleware();
            });
        };

        if (!effectiveAuth) {
            proceed();
            return;
        }

        // Auth runs against the decorated upgrade request. On deny we write a raw
        // HTTP response and destroy the socket without upgrading. A timeout caps
        // how long an unanswered handshake is allowed to hold the socket open,
        // turning a hung provider into a deny rather than a leak.
        (async () => {
            let timer: NodeJS.Timeout | undefined;
            const timeout = new Promise<AuthenticationResult>(resolve => {
                if (wsAuthTimeoutMs <= 0) return;
                timer = setTimeout(
                    () => resolve({ ok: false, statusCode: 504, message: 'Authentication timeout' }),
                    wsAuthTimeoutMs
                );
                if (typeof timer.unref === 'function') timer.unref();
            });

            try {
                const result = await Promise.race([
                    runAuthenticationProvider(effectiveAuth, req),
                    timeout
                ]);

                if (result.ok) {
                    proceed();
                    return;
                }

                write_auth_denied_response(socket, result, errorSink);
            } catch (error) {
                invoke_error_sink(errorSink, error, 'websocket-auth');
                write_auth_denied_response(
                    socket,
                    { ok: false, statusCode: 500, message: 'Internal Server Error' },
                    errorSink
                );
            } finally {
                if (timer) clearTimeout(timer);
            }
        })();
    };

    server.on('upgrade', handle_upgrade);

    if (!options.leaveRouterUntouched) {
        const RouterProto = express.Router as any;

        if (!RouterProto.prototype.ws) {
            RouterProto.prototype.ws = function (this: any, ...args: any[]) {
                const { route, auth, handler } = parse_ws_args(args);

                const inheritedAuth = auth ?? wrap_protected_router_auth(this);

                wsRoutes.set(route, { handler, auth: inheritedAuth });

                return this;
            };
        }
    }

    const wsApp = app as WebSocket.Application;

    wsApp.ws = function (this: any, ...args: any[]): any {
        if (typeof args[0] === 'function') {
            wsMiddleware.push(args[0]);
            return this;
        }

        const { route, auth, handler } = parse_ws_args(args);

        wsRoutes.set(route, { handler, auth });

        return this;
    };

    function applyTo<T extends object> (router: T, mountPath: string = ''): T & WebSocket.Router {
        const wsRouter = router as T & WebSocket.Router;

        // The global prototype patch on express.Router installs `.ws` on EVERY router
        // instance via the prototype chain, but without mountPath awareness. We want
        // applyTo's mountPath-aware version to win when explicitly requested, so we
        // check for an own (instance) property rather than rejecting based on
        // prototype-inherited methods.
        if (Object.prototype.hasOwnProperty.call(wsRouter, 'ws')) {
            return wsRouter;
        }

        wsRouter.ws = function (this: any, ...args: any[]) {
            const { route, auth, handler } = parse_ws_args(args);

            const fullRoute = resolve_route_path(mountPath, route);

            const inheritedAuth = auth ?? wrap_protected_router_auth(this);

            wsRoutes.set(fullRoute, { handler, mountPath, auth: inheritedAuth });

            return this;
        } as any;

        return wsRouter;
    }

    return {
        app: wsApp,
        getWss: () => wss,
        applyTo
    };
}

export namespace WebSocket {
    export type Request = express.Request & { ws: ws.WebSocket };
    export type WebSocketHandler = (socket: ws.WebSocket, request: Request, next: express.NextFunction) => void;

    export interface RequestHandler {
        (route: string, handler: WebSocketHandler): void;
        (route: string, auth: AuthenticationProvider, handler: WebSocketHandler): void;
        (handler: WebSocketHandler): void;
    }

    export interface Application extends express.Application {
        ws(route: string, handler: WebSocketHandler): this;
        ws(route: string, auth: AuthenticationProvider, handler: WebSocketHandler): this;
        ws(handler: WebSocketHandler): this;
    }

    export interface Router extends express.Router {
        ws(route: string, handler: WebSocketHandler): this;
        ws(route: string, auth: AuthenticationProvider, handler: WebSocketHandler): this;
    }

    export type ApplyTo = <T extends object>(router: T, mountPath?: string) => T & Router;

    export type ServerOptions = ws.ServerOptions;

    export type Options = {
        leaveRouterUntouched?: boolean;
        wsOptions?: ServerOptions;
        /**
         * Authentication provider applied to every WebSocket route that does not
         * specify its own. Useful as a global default before per-route overrides.
         */
        wsAuth?: AuthenticationProvider;
        /**
         * Maximum time in milliseconds an authentication provider is allowed to
         * take before the handshake is denied with HTTP 504. Set to 0 to disable
         * the timeout. Defaults to 30000.
         */
        wsAuthTimeoutMs?: number;
        /**
         * Cookie secret(s) used to parse signed cookies on the upgrade request so
         * authentication providers can read `request.signedCookies`. Should be the
         * same value supplied to `WebServer({ cookieSecret })`.
         */
        cookieSecret?: CipherKey | CipherKey[];
        /**
         * Error sink invoked on internal errors during cookie or authorization
         * parsing of the upgrade request, and on authentication-provider failures.
         */
        errorSink?: ErrorSink;
    }

    export type Server = ws.WebSocketServer;
}

export default WebSocket;
