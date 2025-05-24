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
import type http from 'http';
import type https from 'https';
import { Stream } from 'stream';
import ws from 'ws';
import { URL } from 'url';

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

    const wsRoutes = new Map<string, { handler: WebSocket.WebSocketHandler; mountPath?: string; }>();
    const wsMiddleware: WebSocket.WebSocketHandler[] = [];

    const matchRoute = (pathname: string): { handler: WebSocket.WebSocketHandler; params: any } | undefined => {
        for (const [route, { handler }] of wsRoutes) {
            const match = matchPath(pathname, route);
            if (match) {
                return { handler, params: match.params };
            }
        }
    };

    const handle_upgrade = (request: http.IncomingMessage, socket: Stream.Duplex, head: Buffer) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
        const pathname = url.pathname;

        const match = matchRoute(pathname);

        if (match) {
            wss.handleUpgrade(request, socket, head, ws => {
                const req = Object.create(request) as WebSocket.Request;
                req.params = match.params;
                req.query = Object.fromEntries(url.searchParams.entries());
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
        } else {
            socket.destroy();
        }
    };

    server.on('upgrade', handle_upgrade);

    if (!options.leaveRouterUntouched) {
        const RouterProto = express.Router as any;

        if (!RouterProto.prototype.ws) {
            RouterProto.prototype.ws = function (route: string, handler: WebSocket.WebSocketHandler) {
                wsRoutes.set(route, { handler });

                return this;
            };
        }
    }

    const wsApp = app as WebSocket.Application;

    wsApp.ws = function (routeOrHandler: string | WebSocket.WebSocketHandler, handler?: WebSocket.WebSocketHandler) {
        if (typeof routeOrHandler === 'function') {
            wsMiddleware.push(routeOrHandler);
        } else if (handler) {
            wsRoutes.set(routeOrHandler, { handler });
        }

        return this;
    };

    function applyTo<T extends object> (router: T, mountPath: string = ''): T & WebSocket.Router {
        const wsRouter = router as T & WebSocket.Router;

        if (typeof wsRouter.ws === 'function') return wsRouter;

        wsRouter.ws = function (route: string, handler: WebSocket.WebSocketHandler) {
            const fullRoute = resolve_route_path(mountPath, route);

            wsRoutes.set(fullRoute, { handler, mountPath });

            return this;
        };

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
    export type RequestHandler = (routeOrHandler: string | WebSocketHandler, handler?: WebSocketHandler) => void;

    export interface Application extends express.Application {
        ws(route: string, handler: WebSocketHandler): this;

        ws(handler: WebSocketHandler): this;
    }

    export interface Router extends express.Router {
        ws(route: string, handler: WebSocketHandler): this;
    }

    export type ApplyTo = <T extends object>(router: T, mountPath?: string) => T & Router;

    export type ServerOptions = ws.ServerOptions;

    export type Options = {
        leaveRouterUntouched?: boolean;
        wsOptions?: ServerOptions;
    }

    export type Server = ws.WebSocketServer;
}

export default WebSocket;
