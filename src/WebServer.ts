// Copyright (c) 2018-2023, Brandon Lehmann <brandonlehmann@gmail.com>
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

import Express, { Request, Response } from 'express';
import Helmet from 'helmet';
import Compression from 'compression';
import {
    ExpressWS,
    http,
    https,
    serveStatic,
    WebApplication,
    WebApplicationOptions,
    WebSocketRequestHandler
} from './Types';
import { mergeWebApplicationDefaults, RecommendedHeaders, updateSSLOptions, ContentSecurityHeader } from './Helpers';
import * as path from 'path';
import Logger from '@gibme/logger';
import startCloudflaredTunnel from './cloudflared';

export {
    Express,
    WebApplication,
    WebApplicationOptions,
    Logger,
    WebSocketRequestHandler,
    Request,
    Response
};

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
     * @param options
     */
    public static create (
        options: Partial<WebApplicationOptions> = {}
    ): WebApplication {
        let _options = mergeWebApplicationDefaults(options);

        const app = Express();

        const server = (_options.ssl
            ? https.createServer({
                key: _options.sslPrivateKey,
                cert: _options.sslCertificate
            }, app)
            : http.createServer(app));

        const wsInstance = ExpressWS(app, server, {
            wsOptions: _options.websocketsOptions
        });

        (app as any).applyTo = wsInstance.applyTo;

        (app as any).getWss = wsInstance.getWss;

        (app as any).ws = wsInstance.app.ws;

        app.use((_request, response, next) => {
            response.removeHeader('x-powered-by');

            return next();
        });

        // Set the CORS header if set in the options
        if (_options.corsDomain.length !== 0) {
            app.use((_request, response, next) => {
                response.header('Access-Control-Allow-Origin', _options.corsDomain.trim());
                response.header('X-Requested-With', '*');
                response.header('Access-Control-Allow-Headers', '*');
                response.header('Access-Control-Allow-Methods', '*');

                return next();
            });
        }

        if (_options.recommendedHeaders) {
            app.use(Helmet(_options.helmet));

            app.use((_request, response, next) => {
                const headers = RecommendedHeaders();

                for (const [key, value] of headers) {
                    response.header(key, value);
                }

                return next();
            });
        }

        if (_options.enableContentSecurityPolicyHeader) {
            app.use((_request, response, next) => {
                const headers = ContentSecurityHeader();

                for (const [key, value] of headers) {
                    response.header(key, value);
                }

                return next();
            });
        }

        if (_options.compression) {
            app.use(Compression());
        }

        app.use(Express.json());
        app.use(Express.urlencoded({ extended: true }));
        app.use(Express.text());
        app.use(Express.raw());

        app.use((request, _response, next) => {
            const ip = request.header('x-forwarded-for') ||
                request.header('cf-connecting-ip') ||
                request.ip;

            if (_options.requestLogging === 'full') {
                switch (request.method) {
                    case 'POST':
                    case 'PATCH':
                    case 'PUT':
                        Logger.debug('%s [%s] %s: %s',
                            ip,
                            request.method,
                            request.url,
                            typeof request.body === 'object' || Array.isArray(request.body)
                                ? JSON.stringify(request.body)
                                : request.body);
                        break;
                    default:
                        Logger.debug('%s [%s] %s',
                            ip,
                            request.method,
                            request.url);
                        break;
                }
            } else if (_options.requestLogging) {
                Logger.debug('%s [%s] %s',
                    ip,
                    request.method,
                    request.url);
            }

            return next();
        });

        (app as any).bindHost = _options.bindHost;
        (app as any).bindPort = _options.bindPort;
        (app as any).ssl = _options.ssl;
        (app as any).localUrl = [
            `http${_options.ssl ? 's' : ''}://`,
            _options.bindHost === '0.0.0.0' ? '127.0.0.1' : _options.bindHost,
            `:${_options.bindPort}`
        ].join('');
        (app as any).url = (app as any).localUrl;

        (app as any).address = () => server.address();

        (app as any).getConnections = async (): Promise<number> => new Promise((resolve, reject) => {
            server.getConnections((error, count) => {
                if (error) {
                    return reject(error);
                }

                return resolve(count);
            });
        });

        (app as any).getMaxConnections = () => server.maxConnections;

        (app as any).ref = () => server.ref();

        (app as any).serveStatic = (
            local_path: string,
            options?: serveStatic.ServeStaticOptions
        ): void => {
            app.use(Express.static(path.resolve(local_path), options));
        };

        (app as any).setMaxConnections = (maximum: number): void => {
            server.maxConnections = maximum;
        };

        (app as any).tunnelStop = async () => { return undefined; };

        (app as any).tunnelStart = async (maxRetries = 10): Promise<void> => {
            const { url, connections, child, stop } =
                await startCloudflaredTunnel((app as any).localUrl, maxRetries);

            (app as any).tunnelUrl = (app as any).url = url;

            (app as any).tunnelConnections = connections;

            (app as any).tunnelStop = async () => {
                try {
                    await stop();
                } catch {} finally {
                    (app as any).url = (app as any).localUrl;
                    delete (app as any).tunnelUrl;
                    delete (app as any).tunnelConnections;
                    (app as any).tunnelStop = async () => { return undefined; };
                }
            };

            child.on('error', error => app.emit('error', error));
            child.on('exit', code => app.emit('tunnelClosed', code));
        };

        (app as any).start = async (): Promise<void> => {
            (app as any).appOptions = _options = await updateSSLOptions(_options);

            if (_options.autoHandleOptions) {
                app.options('*', (_request, response) => {
                    return response.sendStatus(200).send();
                });
            }

            if (_options.autoHandle404) {
                app.all('*', (_request, response) => {
                    return response.sendStatus(404).send();
                });
            }

            const start = async (): Promise<void> => new Promise((resolve, reject) => {
                server.once('error', error => {
                    return reject(error);
                });

                server.listen(_options.bindPort, _options.bindHost, _options.backlog, () => {
                    server.removeAllListeners('error');

                    server.on('error', error => app.emit('error', error));

                    return resolve();
                });
            });

            await start();

            if (_options.autoStartTunnel) {
                await (app as any).tunnelStart();
            }
        };

        (app as any).stop = async (): Promise<void> => {
            await (app as any).tunnelStop();

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

        (app as any).unref = () => server.unref();

        (app as any).server = server;

        (app as any).appOptions = _options;

        return app as any;
    }
}

export { WebServer };
