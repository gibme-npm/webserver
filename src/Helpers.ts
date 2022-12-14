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
import * as path from 'path';
import * as devcert from 'devcert';
import { WebApplicationOptions } from './Types';
import * as dotenv from 'dotenv';

dotenv.config();

/** @ignore */
const processBoolean = (envVar: string, default_value: boolean): boolean => {
    const variable = process.env[envVar];

    return typeof variable !== 'undefined'
        ? variable === 'true' || variable === '1'
        : default_value;
};

/**
 * Merges configuration options with their defaults and/or environment variables
 *
 * @param options
 * @ignore
 */
export const mergeWebApplicationDefaults = async (
    options: Partial<WebApplicationOptions> = {}
): Promise<WebApplicationOptions> => {
    options.helmet ||= {};
    options.bindHost ||= process.env.BIND_HOST || '0.0.0.0';
    options.backlog ||= parseInt(process.env.BACKLOG || '511');
    options.recommendedHeaders ??= processBoolean('USE_RECOMMENDED_HEADERS', true);
    options.compression ??= processBoolean('USE_COMPRESSION', true);
    options.corsDomain ||= process.env.CORS_DOMAIN || '*';
    options.ssl ??= processBoolean('USE_SSL', false);
    options.bindPort ||=
        parseInt(process.env.BIND_PORT || options.ssl ? '443' : '80');
    options.requestLogging ??= process.env.REQUEST_LOGGING === 'full'
        ? 'full'
        : processBoolean('REQUEST_LOGGING', false);
    options.autoHandle404 ??= processBoolean('AUTO_HANDLE_404', true);
    options.autoHandleOptions ??= processBoolean('AUTO_HANDLE_OPTIONS', true);

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
        options.sslPrivateKey = readFileSync(path.resolve(options.sslPrivateKey));
    }

    if (options.sslCertificate && typeof options.sslCertificate === 'string') {
        options.sslCertificate = readFileSync(path.resolve(options.sslCertificate));
    }

    if (options.ssl && (!options.sslPrivateKey || !options.sslCertificate)) {
        if (options.ssl === 'devcert') {
            console.warn('Generating certificates for: %s',
                options.sslHostnames.join(','));

            const ssl = await devcert.certificateFor(
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
 * Currently recommended headers to return with responses
 *
 * @param options
 * @constructor
 */
export const RecommendedHeaders = (options: WebApplicationOptions): Map<string, string> =>
    new Map<string, string>([
        ['X-Requested-With', '*'],
        ['Access-Control-Allow-Origin', options.corsDomain],
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
        ['Content-Security-Policy', 'default-src =\'none\''],
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
