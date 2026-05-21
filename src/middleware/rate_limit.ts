// Copyright (c) 2026, Brandon Lehmann <brandonlehmann@gmail.com>
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

import type express from 'express';
import NodeCache from 'node-cache';
import { ErrorSink, invoke_error_sink } from './error_sink';

export type RateLimitBucket = {
    count: number;
    resetAt: number;
};

export type RateLimitStore = {
    get: (key: string) => RateLimitBucket | undefined | Promise<RateLimitBucket | undefined>;
    set: (key: string, bucket: RateLimitBucket, ttlMs: number) => void | Promise<void>;
    clear: (key: string) => void | Promise<void>;
};

export type RateLimitInfo = {
    limit: number;
    remaining: number;
    resetAt: number;
    retryAfterSeconds: number;
};

export type RateLimitOptions = {
    /** Window length in milliseconds. */
    windowMs: number;
    /** Maximum requests allowed per key per window. */
    max: number;
    /** Function producing the bucket key. Defaults to `request.remoteIp || request.ip`. */
    keyGenerator?: (request: express.Request) => string;
    /** Predicate; when truthy the request is not counted and is forwarded. */
    skip?: (request: express.Request) => boolean | Promise<boolean>;
    /** Override the default 429 response. */
    handler?: (request: express.Request, response: express.Response, info: RateLimitInfo) => void | Promise<void>;
    /**
     * Emit `RateLimit`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
     * headers per draft-ietf-httpapi-ratelimit-headers.
     * @default true
     */
    standardHeaders?: boolean;
    /**
     * Emit legacy `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers.
     * @default false
     */
    legacyHeaders?: boolean;
    /** Pluggable bucket store. Defaults to an in-process node-cache. */
    store?: RateLimitStore;
    /** Error sink for store failures. */
    errorSink?: ErrorSink;
};

export const createInMemoryRateLimitStore = (): RateLimitStore => {
    const cache = new NodeCache({ useClones: false });

    return {
        get: (key) => cache.get<RateLimitBucket>(key),
        set: (key, bucket, ttlMs) => {
            cache.set(key, bucket, Math.max(1, Math.ceil(ttlMs / 1000)));
        },
        clear: (key) => {
            cache.del(key);
        }
    };
};

const default_key = (request: express.Request): string => {
    const candidate = (request as any).remoteIp ?? request.ip ?? 'unknown';
    return String(candidate);
};

const apply_headers = (
    response: express.Response,
    info: RateLimitInfo,
    standardHeaders: boolean,
    legacyHeaders: boolean
) => {
    const resetSeconds = Math.max(0, Math.ceil((info.resetAt - Date.now()) / 1000));

    if (standardHeaders) {
        response.setHeader('RateLimit-Limit', String(info.limit));
        response.setHeader('RateLimit-Remaining', String(info.remaining));
        response.setHeader('RateLimit-Reset', String(resetSeconds));
        response.setHeader('RateLimit', `limit=${info.limit}, remaining=${info.remaining}, reset=${resetSeconds}`);
    }

    if (legacyHeaders) {
        response.setHeader('X-RateLimit-Limit', String(info.limit));
        response.setHeader('X-RateLimit-Remaining', String(info.remaining));
        response.setHeader('X-RateLimit-Reset', String(Math.ceil(info.resetAt / 1000)));
    }
};

export default function middleware (options: RateLimitOptions) {
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
        throw new Error('RateLimit: windowMs must be a positive finite number');
    }
    if (!Number.isFinite(options.max) || options.max <= 0) {
        throw new Error('RateLimit: max must be a positive finite number');
    }

    const windowMs = options.windowMs;
    const max = options.max;
    const standardHeaders = options.standardHeaders ?? true;
    const legacyHeaders = options.legacyHeaders ?? false;
    const keyGenerator = options.keyGenerator ?? default_key;
    const store = options.store ?? createInMemoryRateLimitStore();

    return async (request: express.Request, response: express.Response, next: express.NextFunction) => {
        if (options.skip && await options.skip(request)) {
            return next();
        }

        const key = keyGenerator(request);
        let bucket: RateLimitBucket | undefined;

        try {
            bucket = await store.get(key);
        } catch (error) {
            invoke_error_sink(options.errorSink, error, 'rate-limit-store');
            // fail open: forward the request rather than 500-ing on a broken store
            return next();
        }

        const now = Date.now();

        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 1, resetAt: now + windowMs };
        } else {
            bucket.count += 1;
        }

        try {
            await store.set(key, bucket, Math.max(1, bucket.resetAt - now));
        } catch (error) {
            invoke_error_sink(options.errorSink, error, 'rate-limit-store');
            return next();
        }

        const info: RateLimitInfo = {
            limit: max,
            remaining: Math.max(0, max - bucket.count),
            resetAt: bucket.resetAt,
            retryAfterSeconds: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000))
        };

        apply_headers(response, info, standardHeaders, legacyHeaders);

        if (bucket.count > max) {
            response.setHeader('Retry-After', String(info.retryAfterSeconds));

            if (options.handler) {
                return options.handler(request, response, info);
            }

            response.setHeader('Content-Type', 'text/plain');
            return response.status(429).send('Too Many Requests');
        }

        return next();
    };
}
