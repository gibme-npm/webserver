// Copyright (c) 2018-2022, Brandon Lehmann
//
// Please see the included LICENSE file for more information.

import * as https from 'https';
import * as http from 'http';
import * as Express from 'express';
import * as serveStatic from 'serve-static';
import { AddressInfo } from 'net';
import { HelmetOptions } from 'helmet';

/**
 * Web Application Options
 */
export interface WebApplicationOptions {
    autoHandle404: boolean;
    autoHandleOptions: boolean;
    backlog: number;
    bindPort: number;
    bindHost: string;
    compression: boolean;
    corsDomain: string;
    helmet?: HelmetOptions;
    recommendedHeaders: boolean;
    requestLogging?: boolean | 'full';
    ssl: boolean | 'devcert';
    sslCertificate?: string | Buffer;
    sslHostnames?: string | string[];
    sslPrivateKey?: string | Buffer;
}

/**
 * Readonly WebApplication Properties
 */
interface ReadOnlyWebApplicationProperties {
    appOptions: Readonly<WebApplicationOptions>;
    bindHost: string;
    bindPort: number;
    server: http.Server | https.Server;
    ssl: boolean;
}

/**
 * Extends an Express.Application
 */
export interface WebApplication extends Express.Application, Readonly<ReadOnlyWebApplicationProperties> {
    address: () => string | AddressInfo | null;
    getConnections: () => Promise<number>;
    getMaxConnections: () => number;
    ref: () => http.Server | https.Server;
    serveStatic: (local_path: string, options?: serveStatic.ServeStaticOptions) => void;
    setMaxConnections: (maximum: number) => void;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    unref: () => http.Server | https.Server;
}
