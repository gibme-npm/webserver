// Copyright (c) 2018-2022, Brandon Lehmann
//
// Please see the included LICENSE file for more information.

import Express from 'express';
import Helmet from 'helmet';
import Compression from 'compression';
import {
    WebApplication,
    WebApplicationOptions
} from './Types';
import { mergeWebApplicationDefaults, RecommendedHeaders } from './Helpers';
import * as https from 'https';
import * as http from 'http';
import * as serveStatic from 'serve-static';
import * as path from 'path';
import Logger from '@gibme/logger';

export {
    Express,
    WebApplication,
    WebApplicationOptions,
    Logger
};

export default class WebServer {
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
    public static async create (
        options?: Partial<WebApplicationOptions>
    ): Promise<WebApplication> {
        const _options = await mergeWebApplicationDefaults(options);

        const app = Express();

        const server = (_options.ssl
            ? https.createServer({
                key: _options.sslPrivateKey,
                cert: _options.sslCertificate
            }, app)
            : http.createServer(app));

        if (_options.recommendedHeaders) {
            app.use((request, response, next) => {
                const headers = RecommendedHeaders(_options);

                for (const [key, value] of headers) {
                    response.header(key, value);
                }

                return next();
            });
        }

        app.use(Helmet(_options.helmet));

        if (_options.compression) {
            app.use(Compression());
        }

        app.use(Express.json());
        app.use(Express.urlencoded({ extended: true }));
        app.use(Express.text());

        app.use((request, response, next) => {
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

        (app as any).appOptions = _options;
        (app as any).bindHost = _options.bindHost;
        (app as any).bindPort = _options.bindPort;
        (app as any).ssl = _options.ssl;

        (app as any).address = () => server.address();

        (app as any).getConnections = async (): Promise<number> => new Promise((resolve, reject) => {
            server.getConnections((error, count) => {
                if (error) {
                    return reject(error);
                }

                return count;
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

        (app as any).start = async (): Promise<void> => {
            if (_options.autoHandleOptions) {
                app.options('*', (request, response) => {
                    return response.sendStatus(200).send();
                });
            }

            if (_options.autoHandle404) {
                app.all('*', (request, response) => {
                    return response.sendStatus(404).send();
                });
            }

            return new Promise((resolve, reject) => {
                server.once('error', error => {
                    return reject(error);
                });

                server.listen(_options.bindPort, _options.bindHost, _options.backlog, () => {
                    server.removeAllListeners('error');

                    server.on('error', error => app.emit('error', error));

                    return resolve();
                });
            });
        };

        (app as any).stop = async (): Promise<void> => new Promise((resolve, reject) => {
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

        (app as any).unref = () => server.unref();

        (app as any).server = server;

        return app as any;
    }
}
