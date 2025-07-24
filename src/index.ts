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
import express from 'express';
import WebSocket from './helpers/websocket';
import expressSession from 'express-session';
import type { PathParams } from 'express-serve-static-core';
import Logger from '@gibme/logger';
import Helmet, { HelmetOptions } from 'helmet';
import Compression from 'compression';
import Middleware, { AuthenticationProvider, LogEntry, XMLParserOptions, XMLValidatorOptions } from './middleware';
import SessionStorage from './helpers/sessions';
import Cloudflared, { Connection } from './helpers/cloudflared';
import type { ServeStaticOptions } from 'serve-static';
import type { CipherKey } from 'crypto';

export { Request, Response, Router } from 'express';
export { Logger } from '@gibme/logger';
export { Store } from 'express-session';
export { default as multer } from 'multer';

/**
 * Merges configuration options with their default values
 * @param options
 * @ignore
 */
const merge_options_defaults = (options: Partial<WebServer.Options>): WebServer.Options => {
    options.suppressProcessErrors ??= true;
    options.helmet ??= false;
    options.host ??= '0.0.0.0';
    options.backlog ??= 511;
    options.autoRecommendedHeaders ??= false;
    options.autoContentSecurityPolicyHeaders ??= false;
    options.autoHandle404 ??= true;
    options.autoHandleOptions ??= true;
    options.compression ??= true;
    options.corsOrigin ??= '*';
    options.ssl ??= false;
    options.port ??= options.ssl ? 443 : 80;
    options.logging ??= false;
    options.autoStartCloudflared ??= false;
    options.bodyLimit ??= 2;
    options.sessions ??= false;
    options.xml ??= {};
    options.xml.parserOptions ??= {};
    options.xml.validatorOptions ??= {};
    options.autoParseJSON ??= true;
    options.autoParseRaw ??= true;
    options.autoParseText ??= true;
    options.autoParseURLEncoded ??= true;
    options.autoParseXML ??= true;
    options.cookieSecret ??= [];

    if (!Array.isArray(options.cookieSecret)) {
        options.cookieSecret = [options.cookieSecret];
    }

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

        if (Array.isArray(options.sessions.secret)) {
            options.cookieSecret.push(...options.sessions.secret.map(secret => secret.toString()));
        } else {
            options.cookieSecret.push(options.sessions.secret.toString());
        }
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

    const app = express();
    const instance = (app as any) as WebServer.Application;

    // patch the v4 routes to v5 routes
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace', 'all']) {
        const original = (instance as any)[method].bind(instance);

        (instance as any)[method] = ((route: any, ...handlers: any[]) => {
            if (typeof route === 'string' && /:([a-zA-Z0-9_]+)\?(?!\()/g.test(route)) {
                const clean_route = route.replace(/:([a-zA-Z0-9_]+)\?(?!\()/g, '');
                const full_route = route.replace(/\?/g, '');

                Logger.warn(`⚠️ Patching optional route parameter: '${route}' → ['${clean_route}', '${full_route}']`);

                // Register both routes
                original(clean_route, ...handlers);
                return original(full_route, ...handlers);
            }

            return original(route, ...handlers);
        }) as typeof original;
    }

    // start tracking the response time as early as possible
    instance.use(Middleware.ResponseTime());

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

    assign('host', options.host);
    assign('port', options.port);
    assign('ssl', typeof options.ssl === 'object' || options.ssl);
    assign('localUrl', [
        `http${options.ssl ? 's' : ''}://`,
        options.host === '0.0.0.0' ? '127.0.0.1' : options.host,
        `:${options.port}`
    ].join(''));
    assign('url', instance.localUrl);

    // Set up the WebSocket methods
    {
        const ws = WebSocket(app, instance.server, {
            wsOptions: options.wsOptions
        });

        assign('wsServer', ws.getWss());
        assign('ws', ws.app.ws);
        assign('wsApplyTo', ws.applyTo);
    }

    const standardParserOptions = {
        limit: `${options.bodyLimit}mb`,
        inflate: true
    };

    // Add our middlewares
    instance.use(Middleware.RequestId());
    instance.use(Middleware.RemoteIp());
    instance.use(Middleware.Authorization());
    instance.use(Middleware.Cors(options.corsOrigin));
    instance.use(Middleware.Cookies(options.cookieSecret));
    if (typeof options.sessions === 'object') {
        instance.use(expressSession(options.sessions));
    }
    instance.use(Middleware.Logging(options.logging));
    if (options.autoParseJSON) {
        instance.use(express.json(standardParserOptions));
    }
    if (options.autoParseURLEncoded) {
        instance.use(express.urlencoded({ ...standardParserOptions, extended: true }));
    }
    if (options.autoParseRaw) {
        instance.use(express.raw(standardParserOptions));
    }
    if (options.autoParseText || options.autoParseXML) {
        const type: string[] = [];

        if (options.autoParseText) {
            type.push('text/plain');
        }

        if (options.autoParseXML) {
            type.push('*/xml', 'application/*+xml');
        }

        instance.use(express.text({ ...standardParserOptions, type }));
    }
    if (options.autoParseXML) {
        instance.use(Middleware.XMLParser(options.xml.parserOptions, options.xml.validatorOptions));
    }
    if (options.compression) {
        instance.use(Compression());
    }
    if (options.helmet) {
        instance.use(Helmet(typeof options.helmet === 'object' ? options.helmet : {}));
    }
    if (options.autoRecommendedHeaders) {
        instance.use(Middleware.RecommendedHeaders());
    }
    if (options.autoContentSecurityPolicyHeaders) {
        instance.use(Middleware.ContentSecurityPolicy());
    }

    // Set up the protected router interface
    {
        let provider: AuthenticationProvider | undefined;

        assign('protected', {
            setAuthenticationProvider: (new_provider?: AuthenticationProvider) => {
                provider = new_provider;
            },
            get: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.get(route, ...middlewares);
            },
            post: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.post(route, ...middlewares);
            },
            put: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.put(route, ...middlewares);
            },
            patch: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.patch(route, ...middlewares);
            },
            delete: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.delete(route, ...middlewares);
            },
            head: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.head(route, ...middlewares);
            },
            options: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.options(route, ...middlewares);
            },
            connect: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.connect(route, ...middlewares);
            },
            trace: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.trace(route, ...middlewares);
            },
            all: (route: string, ...middlewares: express.RequestHandler[]) => {
                middlewares.unshift(Middleware.ProtectedRouter(provider));

                return instance.all(route, ...middlewares);
            }
        } as WebServer.ProtectedRouter);
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
    } as WebServer.Tunnel);

    /**
     * Serves static files from the specified path
     * @param path
     * @param local_path
     * @param options
     */
    instance.static = (path: PathParams = '/', local_path: string, options?: ServeStaticOptions) => {
        app.use(path, express.static(resolve(local_path), options));
    };

    /**
     * Starts the server
     */
    instance.start = async (): Promise<void> => {
        if (options.autoHandleOptions) {
            instance.options('*path', (_, response) => {
                return response.status(200).send();
            });
        }

        if (options.autoHandle404) {
            instance.all('*path', (_, response) => {
                return response.status(404).send();
            });
        }

        const start = async (): Promise<void> =>
            new Promise((resolve, reject) => {
                instance.server.once('error', error => {
                    return reject(error);
                });

                instance.server.listen(options.port, options.host, options.backlog, () => {
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
         * Whether we will automatically parse JSON request bodies
         * @default true
         */
        autoParseJSON: boolean;
        /**
         * Whether we will automatically parse RAW request bodies
         * @default true
         */
        autoParseRaw: boolean;
        /**
         * Whether we will automatically parse Text request bodies
         * @default true
         */
        autoParseText: boolean;
        /**
         * Whether we will automatically parse URLEncoded request bodies
         * @default true
         */
        autoParseURLEncoded: boolean;
        /**
         * Whether we will automatically parse XML request bodies
         *
         * @default true
         */
        autoParseXML: boolean;
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
         * Secret(s) used for cookie signing
         */
        cookieSecret: CipherKey | CipherKey[];
        /**
         * The CORS domain name to report in requests
         * @default * (all)
         */
        corsOrigin: string;
        /**
         * Helmet module options
         * @default false
         */
        helmet: HelmetOptions | boolean;
        /**
         * The host address to bind to
         * @default 0.0.0.0 (all)
         */
        host: string;
        /**
         * The bind port for the server
         * @default 443 if ssl, 80 if non-ssl
         */
        port: number;
        /**
         * Defines how request logging is handled.
         *
         * For `true`: High level information of each Request will be logged as `debug` to the console/file
         * For `full`: Headers and the Request body (if POST/PATCH/PUT) are also provided in the log entry
         * For callback: Full log entries are provided to the specified callback method, and the entry will
         * not be passed to the standard logging facility.
         *
         * @default false
         */
        logging: boolean | 'full' | ((entry: LogEntry) => Promise<void> | void);
        /**
         * Whether we enable session support
         *
         * Note: At a minimum, a secret must be supplied if options are specified
         *
         * @default false
         */
        sessions: expressSession.SessionOptions | boolean;
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
         * @default true
         */
        suppressProcessErrors: boolean;
        /**
         * WebSocket server options
         */
        wsOptions: WebSocket.ServerOptions;
        /**
         * Automatic XML body parser handling options
         */
        xml: {
            parserOptions?: XMLParserOptions;
            validatorOptions?: XMLValidatorOptions;
        }
    }

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

    export type ProtectedRouter = {
        /**
         * Sets the authentication provider to use for protected routes.
         *
         * @param provider
         */
        setAuthenticationProvider: (provider?: AuthenticationProvider) => void;
        get: (route: string, ...middlewares: express.RequestHandler[]) => void;
        post: (route: string, ...middlewares: express.RequestHandler[]) => void;
        put: (route: string, ...middlewares: express.RequestHandler[]) => void;
        patch: (route: string, ...middlewares: express.RequestHandler[]) => void;
        delete: (route: string, ...middlewares: express.RequestHandler[]) => void;
        head: (route: string, ...middlewares: express.RequestHandler[]) => void;
        options: (route: string, ...middlewares: express.RequestHandler[]) => void;
        connect: (route: string, ...middlewares: express.RequestHandler[]) => void;
        trace: (route: string, ...middlewares: express.RequestHandler[]) => void;
        all: (route: string, ...middlewares: express.RequestHandler[]) => void;
    }

    export type Application = express.Application & {
        /**
         * The hostname the server is bound to
         */
        readonly host: string;
        /**
         * The local URL of the server
         */
        readonly localUrl: string;
        /**
         * The port the server is bound to
         */
        readonly port: number;
        /**
         * Access to easy-to-use protected routes that automatically insert middleware
         * that checks with the authentication provider for permitted access.
         */
        readonly protected: ProtectedRouter;
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
        ws: WebSocket.RequestHandler;
        /**
         * Applies the WebSocket middleware to the specified Router
         * @param route
         * @param mountPath
         */
        wsApplyTo: WebSocket.ApplyTo;
        /**
         * Returns the WebSocket.Server instance attached to the application
         */
        readonly wsServer: WebSocket.Server
    }

    export const create = WebServer;
}

export default WebServer;
