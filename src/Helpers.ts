// Copyright (c) 2018-2022, Brandon Lehmann <brandonlehmann@gmail.com>
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

import { isIP } from 'net';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { certificateFor as devcert } from 'devcert';
import { WebApplicationOptions } from './Types';
import { config } from 'dotenv';
import SessionStorage from './sessions';

config();

/** @ignore */
const processBoolean = (envVar: string, default_value: boolean): boolean => {
    const variable = (process.env[envVar] || '').toLowerCase();

    switch (variable) {
        case '1':
        case 'true':
            return true;
        case '0':
        case 'false':
            return false;
        default:
            return default_value;
    }
};

/** @ignore */
const processNumber = (envVar: string, default_value: number): number =>
    parseInt(process.env[envVar] ?? default_value.toString());

/** @ignore */
const processString = (envVar: string, default_value: string): string =>
    process.env[envVar] ?? default_value;

/**
 * Merges configuration options with their defaults and/or environment variables
 *
 * @param options
 * @ignore
 */
export const mergeWebApplicationDefaults = (
    options: Partial<WebApplicationOptions> = {}
): WebApplicationOptions => {
    options.helmet ??= {};
    options.bindHost ??= processString('BIND_HOST', '0.0.0.0');
    options.backlog ??= processNumber('BACKLOG', 511);
    options.recommendedHeaders ??= processBoolean('USE_RECOMMENDED_HEADERS', true);
    options.enableContentSecurityPolicyHeader ??= processBoolean('ENABLE_CSP_HEADER', false);
    options.compression ??= processBoolean('USE_COMPRESSION', true);
    options.corsDomain ??= processString('CORS_DOMAIN', '*');
    options.ssl ??= processBoolean('USE_SSL', false);
    options.bindPort ??= processNumber('BIND_PORT', options.ssl ? 443 : 80);
    options.requestLogging ??= process.env.REQUEST_LOGGING === 'full'
        ? 'full'
        : processBoolean('REQUEST_LOGGING', false);
    options.autoHandle404 ??= processBoolean('AUTO_HANDLE_404', true);
    options.autoHandleOptions ??= processBoolean('AUTO_HANDLE_OPTIONS', true);
    options.autoStartTunnel ??= false;
    options.bodyLimit ??= processNumber('BODY_LIMIT', 2);
    options.allowProcessErrors ??= false;

    if (typeof options.sessions === 'boolean' && options.sessions) {
        options.sessions = {} as any;
    }

    if (typeof options.sessions === 'object') {
        options.sessions.cookie ??= {};
        options.sessions.cookie.maxAge ??= processNumber('SESSION_LENGTH', 86400000);
        options.sessions.cookie.secure ??= typeof options.ssl === 'boolean' ? options.ssl : true;
        options.sessions.name ??= processString('SESSION_NAME', 'sid');
        options.sessions.resave ??= false;
        options.sessions.store ??= new SessionStorage({
            stdTTL: options.sessions.cookie.maxAge / 1000
        });
        options.sessions.saveUninitialized ??= true;
        options.sessions.secret ??= processString('SESSION_SECURE', 'insecure_session_key');
    }

    {
        const hostnames: string[] = options.sslHostnames
            ? Array.isArray(options.sslHostnames)
                ? options.sslHostnames
                : [options.sslHostnames]
            : ['localhost'];

        if (!hostnames.includes('localhost')) {
            hostnames.push('localhost');
        }

        if (isIP(options.bindHost) === 0) {
            hostnames.push(options.bindHost);
        }

        options.sslHostnames = hostnames;
    }

    if (options.sslPrivateKey && typeof options.sslPrivateKey === 'string') {
        options.sslPrivateKey = readFileSync(resolve(options.sslPrivateKey));
    }

    if (options.sslCertificate && typeof options.sslCertificate === 'string') {
        options.sslCertificate = readFileSync(resolve(options.sslCertificate));
    }

    return options as WebApplicationOptions;
};

/**
 * Updates the SSL options at for a devcert
 *
 * @param options
 */
export const updateSSLOptions = async (
    options: Partial<WebApplicationOptions>
): Promise<WebApplicationOptions> => {
    if (options.ssl && options.sslHostnames && (!options.sslPrivateKey || !options.sslCertificate)) {
        if (!Array.isArray(options.sslHostnames)) {
            options.sslHostnames = [options.sslHostnames];
        }

        if (options.ssl === 'devcert') {
            console.warn('Generating certificates for: %s',
                options.sslHostnames.join(','));

            const ssl = await devcert(
                options.sslHostnames,
                {
                    skipHostsFile: true,
                    skipCertutilInstall: true
                });

            options.sslPrivateKey = ssl.key;
            options.sslCertificate = ssl.cert;
        } else {
            throw new Error('SSL mode requires private key and cert');
        }
    }

    return options as WebApplicationOptions;
};

/**
 * Sets the Content-Security Policy header to the specified value
 * @constructor
 */
export const ContentSecurityHeader = (): Map<string, string> =>
    new Map<string, string>([
        ['Content-Security-Policy', 'default-src \'self\'']
    ]);

/**
 * Currently recommended headers to return with responses
 *
 * @constructor
 */
export const RecommendedHeaders = (): Map<string, string> =>
    new Map<string, string>([
        ['Access-Control-Allow-Headers', [
            'Origin',
            'X-Requested-With',
            'Content-Type',
            'Accept',
            'User-Agent'
        ].join(', ')],
        ['Access-Control-Allow-Methods', [
            'GET',
            'HEAD',
            'POST',
            'PUT',
            'DELETE',
            'CONNECT',
            'OPTIONS',
            'TRACE',
            'PATCH'
        ].join(', ')],
        ['Cache-Control', [
            'max-age=30',
            'public'
        ].join(', ')],
        ['Referrer-Policy', 'no-referrer'],
        ['Feature-Policy', [
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
        ].join(';')],
        ['Permissions-Policy', [
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
        ].join(', ')]
    ]);
