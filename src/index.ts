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

import { createServer as createHTTPServer } from 'http';
import { createServer as createHTTPSServer, Server } from 'https';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import Express, { Application as ExpressApplication } from 'express';
import ExpressWS from 'express-ws';
import type {
    Server as WebSocketServer,
    ServerOptions as WebSocketServerOptions,
    WebSocket as WebSocketInstance
} from 'ws';
import ExpressSession, { SessionOptions } from 'express-session';
import type { PathParams } from 'express-serve-static-core';
import Logger from '@gibme/logger';
import Helmet, { HelmetOptions } from 'helmet';
import Compression from 'compression';
import SessionStorage from './sessions';
import Cloudflared, { Connection } from './cloudflared';
import type { ServeStaticOptions } from 'serve-static';
import { v4 as uuid } from 'uuid';

export { Request, Response, Router } from 'express';
export { Logger } from '@gibme/logger';
export { Store } from 'express-session';

declare global {
    namespace Express {
        interface Request {
            /**
             * The unique request ID
             */
            id: string;
            /**
             * Auto-resolves the actual client IP address via the request headers from cloudflare
             * specified headers, x-forwarded-for, etc.
             */
            remoteIp: string;
            /**
             * Authorization information decoded from the request headers.
             */
            authorization?: {
                /**
                 * The type of authorization used
                 */
                type: 'Basic' | 'Bearer';
                /**
                 * Basic authorization information
                 */
                basic?: {
                    /**
                     * The username supplied
                     */
                    username: string;
                    /**
                     * The password supplied
                     */
                    password: string;
                };
                /**
                 * Bearer authorization information
                 */
                bearer?: {
                    /**
                     * The token supplied
                     */
                    token: string;
                }
                /**
                 * JWT authorization information
                 */
                jwt?: {
                    /**
                     * The JWT header
                     */
                    header: {
                        alg: string;
                        typ?: string;
                    };
                    /**
                     * The JWT payload
                     */
                    payload: Record<string, any>;
                    /**
                     * The JWT signature
                     */
                    signature: string;
                }
            }
        }
    }
}

declare module 'express-session' {
    interface SessionData {
        [key: string]: any;
    }
}

/**
 * The default content security header policy
 * @ignore
 */
const ContentSecurityPolicy: Record<string, string> = {
    'Content-Security-Policy': 'default-src \'self\''
};

/**
 * Currently recommended headers to return with responses
 * @ignore
 */
const RecommendedHeaders: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, User-Agent',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH',
    'Cache-Control': 'max-age=30, public',
    'Referrer-Policy': 'no-referrer',
    'Feature-Policy': [
        'geolocation none',
        'notifications none',
        'push none',
        'sync-xhr none',
        'microphone none',
        'camera none',
        'magnetometer none',
        'gyroscope none',
        'speaker self',
        'vibrate none',
        'fullscreen self',
        'payment none'
    ].join(';'),
    'Permissions-Policy': [
        'geolocation=()',
        'midi=()',
        'notifications=()',
        'push=()',
        'sync-xhr=()',
        'microphone=()',
        'camera=()',
        'magnetometer=()',
        'gyroscope=()',
        'speaker=(self)',
        'vibrate=()',
        'fullscreen=(self)',
        'payment=()'
    ].join(', ')
};

/**
 * Merges configuration options with their default values
 * @param options
 * @ignore
 */
const merge_options_defaults = (options: Partial<WebServer.Options>): WebServer.Options => {
    options.suppressProcessErrors ??= true;
    options.helmet ??= {};
    options.hostname ??= '0.0.0.0';
    options.backlog ??= 511;
    options.autoRecommendedHeaders ??= true;
    options.autoContentSecurityPolicyHeaders ??= false;
    options.autoHandle404 ??= true;
    options.autoHandleOptions ??= true;
    options.compression ??= true;
    options.corsOrigin ??= '*';
    options.ssl ??= false;
    options.port ??= options.ssl ? 443 : 80;
    options.requestLogging ??= false;
    options.autoStartCloudflared ??= false;
    options.bodyLimit ??= 2;
    options.sessions ??= false;

    if (typeof options.sessions === 'boolean' && options.sessions) {
        options.sessions = {} as any;
    }

    if (typeof options.sessions === 'object') {
        options.sessions.cookie ??= {};
        options.sessions.cookie.maxAge ??= 86_400_000;
        options.sessions.cookie.secure ??= typeof options.ssl === 'object';
        options.sessions.name ??= 'sid';
        options.sessions.saveUninitialized ??= true;
        options.sessions.resave ??= false;
        options.sessions.secret ??= 'insecure_session_key';
        options.sessions.store ??= new SessionStorage({
            stdTTL: options.sessions.cookie.maxAge / 1000
        });
    }

    if (typeof options.ssl === 'object') {
        if (typeof options.ssl.certificate === 'string') {
            options.ssl.certificate = readFileSync(resolve(options.ssl.certificate));
        }

        if (typeof options.ssl.privateKey === 'string') {
            options.ssl.privateKey = readFileSync(resolve(options.ssl.privateKey));
        }

        if (!options.ssl.certificate || !options.ssl.privateKey) {
            throw new Error('SSL certificate and private key must be specified');
        }
    }

    return options as WebServer.Options;
};

/**
 * Creates a new Express WebServer instance
 * @param serverOptions
 */
export function WebServer (
    serverOptions: Partial<WebServer.Options> = {}
): WebServer.Application {
    const options = merge_options_defaults(serverOptions);

    if (options.suppressProcessErrors) {
        // *waves hand in jedi manner* there will be no crashes here
        process.on('uncaughtException', (error, origin) => {
            Logger.error('Caught Exception: %s', error.toString());
            Logger.error(origin);
        });
        process.on('unhandledRejection', (reason: Error | any, p: Promise<unknown>) => {
            Logger.error('Unhandled Rejection at: Promise %s reason: %s', p, reason);
            Logger.error(reason.stack);
        });
    }

    const app = Express();
    const instance = (app as any) as WebServer.Application;
    const assign = (property: string, value: any) => {
        (instance as any)[property] = value;
    };

    {
        const server = options.ssl
            ? createHTTPSServer({
                key: options.ssl.privateKey,
                cert: options.ssl.certificate,
                rejectUnauthorized: false
            }, app)
            : createHTTPServer(app);
        assign('server', server);
    }

    assign('hostname', options.hostname);
    assign('port', options.port);
    assign('ssl', typeof options.ssl === 'object' || options.ssl);
    assign('localUrl', [
        `http${options.ssl ? 's' : ''}://`,
        options.hostname === '0.0.0.0' ? '127.0.0.1' : options.hostname,
        `:${options.port}`
    ].join(''));
    assign('url', instance.localUrl);

    // Set up the WebSocket methods
    {
        const ws = ExpressWS(app, instance.server, {
            wsOptions: options.wsOptions
        });

        assign('wsServer', ws.getWss());

        instance.ws = ws.app.ws;
    }

    // Set up automatic body parsing
    instance.use(Express.json({ limit: `${options.bodyLimit}mb` }));
    instance.use(Express.urlencoded({ limit: `${options.bodyLimit}mb`, extended: true }));
    instance.use(Express.text({ limit: `${options.bodyLimit}mb` }));
    instance.use(Express.raw({ limit: `${options.bodyLimit}mb` }));

    // Set up the session middleware if specified
    if (typeof options.sessions === 'object') {
        instance.use(ExpressSession(options.sessions));
    }

    // Add a request ID
    instance.use((request, response, next) => {
        request.id = uuid();

        response.setHeader('X-Request-ID', request.id);
        response.removeHeader('x-powered-by');

        return next();
    });

    // Resolve the remote IP address
    instance.use((request, _, next) => {
        request.remoteIp = request.header('cf-connecting-ipv6') ||
            request.header('x-forwarded-for') ||
            request.header('cf-connecting-ip') ||
            request.ip || '0.0.0.0';

        return next();
    });

    // Attempt to decode the authorization header if set
    instance.use((request, _, next) => {
        const authorization = request.header('authorization');

        if (authorization) {
            try {
                const [type, token] = authorization.split(' ', 2);

                if (type.toLowerCase() === 'basic') {
                    const [username, password] = Buffer.from(token, 'base64').toString().split(':');

                    if (username && password) {
                        request.authorization = {
                            type: 'Basic',
                            basic: {
                                username,
                                password
                            }
                        };
                    }
                } else if (type.toLowerCase() === 'bearer') {
                    request.authorization = {
                        type: 'Bearer',
                        bearer: {
                            token
                        }
                    };

                    if (token.includes('.')) {
                        const [header, payload, signature] = token.split('.');

                        if (header && payload && signature) {
                            request.authorization.jwt = {
                                header: JSON.parse(Buffer.from(header, 'base64url').toString()),
                                payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
                                signature
                            };
                        }
                    }
                }
            } catch {}
        }

        return next();
    });

    // Set the CORS header if set in the options
    if (options.corsOrigin.length !== 0) {
        instance.use((_, response, next) => {
            response.header('Access-Control-Allow-Origin', options.corsOrigin.trim());
            response.header('X-Requested-With', '*');
            response.header('Access-Control-Allow-Headers', '*');
            response.header('Access-Control-Allow-Methods', '*');

            return next();
        });
    }

    // If using our recommended headers, add them to the application
    if (options.autoRecommendedHeaders) {
        instance.use(Helmet(options.helmet));

        instance.use((_, response, next) => {
            Object.entries(RecommendedHeaders)
                .forEach(([key, value]) => response.header(key, value));

            return next();
        });
    }

    // If using the CSP headers, add them to the application
    if (options.autoContentSecurityPolicyHeaders) {
        instance.use((_, response, next) => {
            Object.entries(ContentSecurityPolicy)
                .forEach(([key, value]) => response.header(key, value));

            return next();
        });
    }

    // Enable compression if set in the options
    if (options.compression) {
        instance.use(Compression());
    }

    // Set up our request logging middleware
    if (options.requestLogging) {
        instance.use((request, _, next) => {
            const { id, ip, method, url, remoteIp } = request;

            const entry: Record<string, any> = {
                id,
                ip: ip ?? '',
                remoteIp: remoteIp ?? '',
                method,
                url
            };

            if (options.requestLogging === 'full') {
                entry.headers = request.headers;

                switch (method) {
                    case 'POST':
                    case 'PATCH':
                    case 'PUT':
                        entry.body = request.body;
                        break;
                    default:
                        break;
                }
            }

            Logger.debug(JSON.stringify(entry));

            return next();
        });
    }

    // Set up the Tunnel interface
    const assignTunnel = (property: string, value: any) => {
        ((instance as any).tunnel as any)[property] = value;
    };

    assign('tunnel', {
        stop: async () => {},
        start: async (timeout = 30000): Promise<boolean> => {
            assignTunnel('binary', await Cloudflared.install_cloudflared());

            return new Promise(resolve => {
                const tunnel = new Cloudflared(instance.localUrl);

                tunnel.on('ready', () => {
                    assignTunnel('url', tunnel.url);
                    assign('url', tunnel.url);
                    assignTunnel('connections', [...tunnel.connections]);

                    instance.tunnel.stop = async (): Promise<void> => {
                        try {
                            await tunnel.stop();
                        } catch {
                        } finally {
                            assignTunnel('url', undefined);
                            assign('url', instance.localUrl);
                            assignTunnel('connections', []);

                            instance.tunnel.stop = async (): Promise<void> => {};
                        }
                    };

                    return resolve(true);
                });

                tunnel.on('timeout', () => {
                    return resolve(false);
                });

                (async () => {
                    if (!await tunnel.start(timeout)) {
                        return resolve(false);
                    }
                })();
            });
        },
        install: Cloudflared.install_cloudflared
    });

    /**
     * Serves static files from the specified path
     * @param path
     * @param local_path
     * @param options
     */
    instance.static = (path: PathParams = '/', local_path: string, options?: ServeStaticOptions) => {
        app.use(path, Express.static(resolve(local_path), options));
    };

    /**
     * Starts the server
     */
    instance.start = async (): Promise<void> => {
        if (options.autoHandleOptions) {
            instance.options('*', (_, response) => {
                return response.status(200).send();
            });
        }

        if (options.autoHandle404) {
            instance.all('*', (_, response) => {
                return response.status(404).send();
            });
        }

        const start = async (): Promise<void> =>
            new Promise((resolve, reject) => {
                instance.server.once('error', error => {
                    return reject(error);
                });

                instance.server.listen(options.port, options.hostname, options.backlog, () => {
                    instance.server.removeAllListeners('error');

                    instance.server.on('error', error => instance.emit('error', error));

                    return resolve();
                });
            });

        await start();

        if (options.autoStartCloudflared) {
            await instance.tunnel.start();
        }
    };

    /**
     * Stops the server
     */
    instance.stop = async (): Promise<void> => {
        await instance.tunnel.stop();

        return new Promise((resolve, reject) => {
            if (!instance.server.listening) {
                return resolve();
            }

            instance.server.close(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    };

    return instance;
}

export namespace WebServer {
    export type Options = {
        /**
         * Whether we enable the content security policy header by default
         * @default false
         */
        autoContentSecurityPolicyHeaders: boolean;
        /**
         * Whether we should auto handle 404s
         * @default true
         */
        autoHandle404: boolean;
        /**
         * Whether we should auto handle options
         * @default true
         */
        autoHandleOptions: boolean;
        /**
         * Whether we should return the default list of recommended headers
         * with every request
         * @default true
         */
        autoRecommendedHeaders: boolean;
        /**
         * Whether to automatically start cloudflared tunnel
         * @default false
         */
        autoStartCloudflared: boolean;
        /**
         * TCP backlog for the underlying server
         * @default 511
         */
        backlog: number;
        /**
         * Body size limit in MB
         * @default 2
         */
        bodyLimit: number;
        /**
         * Whether compression should be enabled by default
         * @default true
         */
        compression: boolean;
        /**
         * The CORS domain name to report in requests
         * @default * (all)
         */
        corsOrigin: string;
        /**
         * Helmet module options
         */
        helmet: HelmetOptions;
        /**
         * The host address to bind to
         * @default 0.0.0.0 (all)
         */
        hostname: string;
        /**
         * The bind port for the server
         * @default 443 if ssl, 80 if non-ssl
         */
        port: number;
        /**
         * Whether we should log requests to file/console
         *
         * Note: if set to `full` then the headers are also logged as well as the request body (if POST/PATCH/PUT)
         *
         * @default false
         */
        requestLogging: boolean | 'full';
        /**
         * Whether we enable session support
         *
         * Note: At a minimum, a secret must be supplied if options are specified
         */
        sessions: SessionOptions | boolean;
        /**
         * Whether SSL should be enabled
         * @default false
         */
        ssl: false | {
            /**
             * The SSL certificate file and/or data.
             *
             * Note: If a string is specified, a full path is expected
             */
            certificate: string | Buffer;
            /**
             * The SSL private key file and/or data
             *
             * Note: If a string is specified, a full path is expected
             */
            privateKey: string | Buffer;
        }
        /**
         * If set to true, allows node to crash via thrown exceptions
         * If set to false (or unset), thrown exceptions are swallowed and logged automatically
         */
        suppressProcessErrors: boolean;
        /**
         * WebSocket server options
         */
        wsOptions: WebSocketServerOptions;
    }

    /**
     * The WebSocket Request Handler callback
     * @param socket
     * @param request
     * @param next
     */
    export type WebSocketRequestHandler =
        (socket: WebSocketInstance, request: Express.Request, next: Express.NextFunction) => void;

    export type Tunnel = {
        /**
         * The path to the cloudflared binary
         */
        readonly binary?: string;
        /**
         * The connections of the cloudflared tunnel
         */
        readonly connections: Connection[];
        /**
         * Installs the cloudflared binary if it is not already installed and returns the path to the binary
         */
        install: () => Promise<string | undefined>;
        /**
         * Starts a cloudflared tunnel
         * @param timeout The timeout in milliseconds to wait for the tunnel to start. Defaults to 30000.
         */
        start: (timeout?: number) => Promise<boolean>;
        /**
         * Stops the cloudflared tunnel
         */
        stop: () => Promise<void>;
        /**
         * The public URL of the cloudflared tunnel
         */
        readonly url?: string;
    }

    export type Application = ExpressApplication & {
        /**
         * The hostname the server is bound to
         */
        readonly hostname: string;
        /**
         * The local URL of the server
         */
        readonly localUrl: string;
        /**
         * The port the server is bound to
         */
        readonly port: number;
        /**
         * The underlying HTTP/s server instance
         */
        readonly server: Server;
        /**
         * Whether this server is answering SSL requests
         */
        readonly ssl: boolean;
        /**
         * Starts the server
         */
        start: () => Promise<void>;
        /**
         * Serves static files from the specified path
         * @param path
         * @param local_path
         * @param options
         */
        static: (path: PathParams, local_path: string, options?: ServeStaticOptions) => void;
        /**
         * Stops the server
         */
        stop: () => Promise<void>;
        /**
         * The cloudflared tunnel instance
         */
        readonly tunnel: Tunnel;
        /**
         * The public URL of the server
         */
        readonly url: string;
        /**
         * Creates a WebSocket route in the same kind of format as .get/.post/etc
         * @param route
         * @param middlewares
         */
        ws: (route: PathParams, ...middlewares: WebSocketRequestHandler[]) => void;
        /**
         * Returns the WebSocket.Server instance attached to the application
         */
        readonly wsServer: WebSocketServer
    }

    export const create = WebServer;
}

export default WebServer;
