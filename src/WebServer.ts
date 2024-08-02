// Copyright (c) 2018-2024, Brandon Lehmann <brandonlehmann@gmail.com>
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

import type { WebApplication, WebApplicationOptions, WebSocketRequestHandler, ServeStaticOptions } from './Types';
import { createServer as createHTTPServer } from 'http';
import { createServer as createHTTPSServer } from 'https';
import Express, { Request, Response } from 'express';
import ExpressWS from 'express-ws';
import ExpressSession from 'express-session';
import Helmet from 'helmet';
import Compression from 'compression';
import multer from 'multer';
import Logger from '@gibme/logger';
import startCloudflaredTunnel, { installCloudflared } from './cloudflared';
import { mergeWebApplicationDefaults, RecommendedHeaders, updateSSLOptions, ContentSecurityHeader } from './Helpers';
import { resolve } from 'path';
import { v4 as uuid } from 'uuid';
import SessionStorage from './sessions';

export {
    Express,
    WebApplication,
    WebApplicationOptions,
    Logger,
    WebSocketRequestHandler,
    Request,
    Response,
    multer,
    SessionStorage
};

declare global {
    namespace Express {
        interface Request {
            id: string;
            remoteIp?: string;
        }
    }
}

export default abstract class WebServer {
    /**
     * Constructs a new instance of a web server application that
     * utilizes the express framework. This method makes it very
     * simple to spin up either an HTTP or HTTPs server with
     * preloaded recommended headers for APIs and the like.
     *
     * It also supports auto-generating development SSL certificates
     * for the specified hostname(s) and installing a development
     * root CA in your OS. This mode is **NOT** for production use.
     *
     * @param serverOptions
     */
    public static create (
        serverOptions: Partial<WebApplicationOptions> = {}
    ): WebApplication {
        let options = mergeWebApplicationDefaults(serverOptions);

        if (!options.allowProcessErrors) {
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

        const app = Express() as any as WebApplication;

        const server = (options.ssl
            ? createHTTPSServer({
                key: options.sslPrivateKey,
                cert: options.sslCertificate
            }, app)
            : createHTTPServer(app));

        const wsInstance = ExpressWS(app, server, {
            wsOptions: options.websocketsOptions
        });

        app.applyTo = wsInstance.applyTo;

        app.getWss = wsInstance.getWss;

        app.ws = wsInstance.app.ws;

        app.use(Express.json({ limit: `${options.bodyLimit}mb` }));
        app.use(Express.urlencoded({ limit: `${options.bodyLimit}mb`, extended: true }));
        app.use(Express.text({ limit: `${options.bodyLimit}mb` }));
        app.use(Express.raw({ limit: `${options.bodyLimit}mb` }));

        if (typeof options.sessions === 'object') {
            app.use(ExpressSession(options.sessions));
        }

        // add our always defined headers
        app.use((request, response, next) => {
            request.id = uuid();
            request.remoteIp = request.header('cf-connecting-ipv6') ||
                request.header('x-forwarded-for') ||
                request.header('cf-connecting-ip') ||
                request.ip;

            response.setHeader('X-Request-ID', request.id);
            response.removeHeader('x-powered-by');

            return next();
        });

        // Set the CORS header if set in the options
        if (options.corsDomain.length !== 0) {
            app.use((_request, response, next) => {
                response.header('Access-Control-Allow-Origin', options.corsDomain.trim());
                response.header('X-Requested-With', '*');
                response.header('Access-Control-Allow-Headers', '*');
                response.header('Access-Control-Allow-Methods', '*');

                return next();
            });
        }

        if (options.recommendedHeaders) {
            app.use(Helmet(options.helmet));

            app.use((_request, response, next) => {
                const headers = RecommendedHeaders();

                for (const [key, value] of headers) {
                    response.header(key, value);
                }

                return next();
            });
        }

        if (options.enableContentSecurityPolicyHeader) {
            app.use((_request, response, next) => {
                const headers = ContentSecurityHeader();

                for (const [key, value] of headers) {
                    response.header(key, value);
                }

                return next();
            });
        }

        if (options.compression) {
            app.use(Compression());
        }

        if (options.requestLogging) {
            app.use((request, _response, next) => {
                const entry: any = {
                    id: request.id,
                    ip: request.ip,
                    method: request.method,
                    url: request.url
                };

                if (options.requestLogging === 'full') {
                    entry.headers = request.headers;

                    switch (request.method) {
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

        (app as any).bindHost = options.bindHost;
        (app as any).bindPort = options.bindPort;
        (app as any).ssl = options.ssl;
        (app as any).localUrl = [
            `http${options.ssl ? 's' : ''}://`,
            options.bindHost === '0.0.0.0' ? '127.0.0.1' : options.bindHost,
            `:${options.bindPort}`
        ].join('');
        (app as any).url = app.localUrl;

        (app as any).address = () => server.address();

        app.getConnections = async (): Promise<number> =>
            new Promise((resolve, reject) => {
                server.getConnections((error, count) => {
                    if (error) {
                        return reject(error);
                    }

                    return resolve(count);
                });
            });

        app.getMaxConnections = () => server.maxConnections;

        app.ref = () => server.ref();

        app.serveStatic = (
            local_path: string,
            options?: ServeStaticOptions
        ): void => {
            app.use(Express.static(resolve(local_path), options));
        };

        app.setMaxConnections = (maximum: number): void => {
            server.maxConnections = maximum;
        };

        app.installCloudflared = installCloudflared;

        app.tunnelStop = async (): Promise<void> => {};

        app.tunnelStart = async (maxRetries = 10, timeout = 2000): Promise<boolean> => {
            app.cloudflared = await installCloudflared();

            const tunnel = await startCloudflaredTunnel(app.localUrl, maxRetries, timeout);

            if (!tunnel) return false;

            const { url, connections, child, stop } = tunnel;

            app.tunnelUrl = (app as any).url = url;

            app.tunnelConnections = connections;

            app.tunnelStop = async () => {
                try {
                    await stop();
                } catch {} finally {
                    (app as any).url = app.localUrl;
                    delete app.tunnelUrl;
                    delete app.tunnelConnections;
                    app.tunnelStop = async (): Promise<void> => {};
                }
            };

            child.on('error', error => app.emit('error', error));
            child.on('exit', code => app.emit('tunnelClosed', code));

            return true;
        };

        app.start = async (): Promise<void> => {
            (app as any).appOptions = options = await updateSSLOptions(options);

            if (options.autoHandleOptions) {
                app.options('*', (_request, response) => {
                    return response.sendStatus(200).send();
                });
            }

            if (options.autoHandle404) {
                app.all('*', (_request, response) => {
                    return response.sendStatus(404).send();
                });
            }

            const start = async (): Promise<void> => new Promise((resolve, reject) => {
                server.once('error', error => {
                    return reject(error);
                });

                server.listen(options.bindPort, options.bindHost, options.backlog, () => {
                    server.removeAllListeners('error');

                    server.on('error', error => app.emit('error', error));

                    return resolve();
                });
            });

            await start();

            if (options.autoStartTunnel) {
                await app.tunnelStart();
            }
        };

        app.stop = async (): Promise<void> => {
            await app.tunnelStop();

            return new Promise((resolve, reject) => {
                if (!server.listening) {
                    return resolve();
                }

                server.close(error => {
                    if (error) {
                        return reject(error);
                    }

                    return resolve();
                });
            });
        };

        app.unref = () => server.unref();

        (app as any).server = server;

        (app as any).appOptions = options;

        return app;
    }
}

export { WebServer };
