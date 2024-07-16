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

import * as core from 'express-serve-static-core';
import * as https from 'https';
import * as http from 'http';
import * as Express from 'express';
import { Request, NextFunction } from 'express';
import * as serveStatic from 'serve-static';
import { AddressInfo } from 'net';
import { HelmetOptions } from 'helmet';
import ExpressWS, { RouterLike } from 'express-ws';
import WebSocket, { ServerOptions } from 'ws';
import Application = Express.Application;
import { Connection } from 'cloudflared';
import Cache from '@gibme/cache/dist/common';

export { http, https, serveStatic, ExpressWS };

/**
 * Web Application Options
 */
export interface WebApplicationOptions {
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
     * TCP backlog for the underlying server
     * @default 511
     */
    backlog: number;
    /**
     * The bind port for the server
     * @default 440 if ssl, 80 if non-ssl
     */
    bindPort: number;
    /**
     * The host address to bind to
     * @default 0.0.0.0 (all)
     */
    bindHost: string;
    /**
     * Whether compression should be enabled by default
     * @default true
     */
    compression: boolean;
    /**
     * The CORS domain name to report in requests
     * @default * (all)
     */
    corsDomain: string;
    /**
     * Whether we enable the content security policy header by default
     * @default false
     */
    enableContentSecurityPolicyHeader?: boolean;
    /**
     * Helmet module options
     */
    helmet?: HelmetOptions;
    /**
     * Whether we should return the default list of recommended headers
     * with every request
     * @default true
     */
    recommendedHeaders?: boolean;
    /**
     * Whether we should log requests to file/console
     *
     * Note: if set to `full` then the headers are also logged as well as the request body (if POST/PATCH/PUT)
     *
     * @default false
     */
    requestLogging?: boolean | 'full';
    /**
     * Whether SSL should be enabled
     *
     * Note: 'devcert' is only suitable for test systems as it will prompt to install
     * a Root CA on the host for testing purposes only
     *
     * @default false
     */
    ssl: boolean | 'devcert';
    /**
     * The SSL certificate file and/or data.
     *
     * Note: If a string is specified, a full path is expected
     */
    sslCertificate?: string | Buffer;
    /**
     * The SSL hostname(s) we should use when creating our devcert
     *
     * Note: 'localhost' is always included
     * @default <empty>
     */
    sslHostnames?: string | string[];
    /**
     * The SSL private key file and/or data
     *
     * Note: If a string is specified, a full path is expected
     */
    sslPrivateKey?: string | Buffer;
    /**
     * WebSocket server options
     */
    websocketsOptions?: ServerOptions;
    /**
     * Auto start cloudflared?
     */
    autoStartTunnel: boolean;
    /**
     * Body size limit in Megabytes (MB)
     */
    bodyLimit: number;
    /**
     * Whether we enable session support
     */
    sessions: boolean;
    /**
     * Session cookie name
     */
    sessionName: string;
    /**
     * The default session length in seconds
     */
    sessionLength: number;
    /**
     * The session secret key
     */
    sessionSecret: string;
    /**
     * The session storage cache to use for session storage
     *
     * Note: if this is unset, a memory based storage
     * backend will be used
     */
    sessionStorage?: Cache;
    /**
     * If set to true, allows node to crash via thrown exceptions
     * If set to false (or unset), thrown exceptions are swallowed and logged automatically
     */
    allowProcessErrors: boolean;
}

/**
 * Readonly WebApplication Properties
 */
interface ROWebApplicationProperties {
    /**
     * The options used to create the application
     */
    appOptions: Readonly<WebApplicationOptions>;
    /**
     * The host address that we are to bind to
     */
    bindHost: Readonly<string>;
    /**
     * The port that we are to bind to
     */
    bindPort: Readonly<number>;
    /**
     * The underlying HTTP/S server
     */
    server: http.Server | https.Server;
    /**
     * If SSL is enabled
     */
    ssl: Readonly<boolean>;
    /**
     * The local server URL
     */
    localUrl: Readonly<string>;
    /**
     * The common server URL
     */
    url: Readonly<string>;
}

/**
 * The WebSocket Request Handler callback
 */
export type WebSocketRequestHandler = (socket: WebSocket.WebSocket, request: Request, next: NextFunction) => void;

/**
 * Extends an Express.Application
 * see [https://expressjs.com/en/4x/api.html#app](https://expressjs.com/en/4x/api.html#app)
 */
export interface WebApplication extends Application, Readonly<ROWebApplicationProperties> {
    /**
     * The local address of the server
     */
    address: () => string | AddressInfo | null;
    /**
     * Applies a WebSocket instance to the target
     *
     * @param target
     */
    applyTo?: (target: RouterLike) => void;
    /**
     * Returns the number of connections to the underlying TCP server
     */
    getConnections: () => Promise<number>;
    /**
     * Retrieves the maximum number of connections that the underlying TCP server will accept
     */
    getMaxConnections: () => number;
    /**
     * Opposite of unref(), calling ref() on a previously unrefed server will not let the program exit if it's
     * the only server left (the default behavior). If the server is refed calling ref() again will have no effect.
     */
    ref: () => http.Server | https.Server;
    /**
     * Serves a static path via the Express application
     *
     * @param local_path
     * @param options
     */
    serveStatic: (local_path: string, options?: serveStatic.ServeStaticOptions) => void;
    /**
     * Sets the maximum number of connections that the underlying TCP server will accept
     *
     * @param maximum
     */
    setMaxConnections: (maximum: number) => void;
    /**
     * Starts the server
     */
    start: () => Promise<void>;
    /**
     * Stops the server
     */
    stop: () => Promise<void>;
    /**
     * Calling unref() on a server will allow the program to exit if this is the only active server in the
     * event system. If the server is already unrefed calling unref() again will have no effect.
     */
    unref: () => http.Server | https.Server;
    /**
     * Returns the WebSocket.Server instance attached to the application
     */
    getWss: () => WebSocket.Server;
    /**
     * Creates a WebSocket route in the same kind of format as .get/.post/etc
     *
     * @param route
     * @param middlewares
     */
    ws: (route: core.PathParams, ...middlewares: WebSocketRequestHandler[]) => void;
    /**
     * Installs the cloudflared binary
     */
    installCloudflared: () => Promise<string | undefined>;
    /**
     * Starts a temporary cloudflared tunnel to cloudflare
     */
    tunnelStart: (maxRetries?: number, timeout?: number) => Promise<boolean>;
    /**
     * The cloudflared tunnel url
     */
    tunnelUrl?: Readonly<string>;
    /**
     * The cloudflared tunnel connections
     */
    tunnelConnections?: Readonly<Connection[]>;
    /**
     * Stops the cloudflared tunnel
     */
    tunnelStop: () => Promise<void>;
    /**
     * Path to cloudflared binary
     */
    cloudflared?: Readonly<string>;
}
