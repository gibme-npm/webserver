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

import { readFileSync } from 'fs';
import { resolve } from 'path';
import SessionStorage from './sessions';
import type { WebServer } from '..';

/**
 * Merges configuration options with their default values
 * @param options
 * @ignore
 */
export const merge_options_defaults = (options: Partial<WebServer.Options>): WebServer.Options => {
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

    options.cookieSecret = options.cookieSecret.filter(secret => !!secret);

    if (options.cookieSecret.length === 0) {
        options.cookieSecret.push('insecure');
    }

    if (typeof options.sessions === 'boolean' && options.sessions) {
        options.sessions = {} as any;
    }

    if (typeof options.sessions === 'object') {
        options.sessions.cookie ??= {};
        if (typeof options.sessions.cookie === 'object') {
            options.sessions.cookie.maxAge ??= 86_400_000;
            options.sessions.cookie.secure ??= typeof options.ssl === 'object';
        }
        options.sessions.name ??= 'sid';
        options.sessions.saveUninitialized ??= true;
        options.sessions.resave ??= false;
        options.sessions.secret ??= 'insecure_session_key';
        const stdTTL = (typeof options.sessions.cookie === 'object' && options.sessions.cookie.maxAge
            ? options.sessions.cookie.maxAge
            : 86_400_000) / 1000;
        options.sessions.store ??= new SessionStorage({ stdTTL });

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
