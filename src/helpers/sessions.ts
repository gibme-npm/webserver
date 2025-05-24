// Copyright (c) 2024-2025, Brandon Lehmann <brandonlehmann@gmail.com>
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

import { SessionData, Store } from 'express-session';
import Cache from 'node-cache';

export { Store } from 'express-session';

declare module 'express-session' {
    interface SessionData {
        [key: string]: any;
    }
}

/**
 * Implements the Storage class for express-session using
 * a `Cache` of memory-based cache as the underlying storage provider
 */
export default class SessionStorage extends Store {
    private readonly cache: Cache;

    /**
     * Constructs a new instance of the class
     *
     * @param options
     */
    constructor (
        private readonly options: Partial<{ stdTTL: number, checkperiod: number }> = {}
    ) {
        super();

        this.cache = new Cache(this.options);
    }

    /**
     * Returns all sessions from the store
     *
     * @param callback
     */
    public all (callback: (error: Error | null, sessions: SessionData[]) => void) {
        try {
            const keys = this.cache.keys();

            const kvs = this.cache.mget<SessionData>(keys);

            return callback(null, Object.entries(kvs).map(([, value]) => value));
        } catch (error: any) {
            return callback(error instanceof Error ? error : new Error(error), []);
        }
    }

    /**
     * Destroys the session with the given session ID
     *
     * @param sid
     * @param callback
     */
    public destroy (sid: string, callback: (error: Error | null) => void) {
        try {
            this.cache.del(sid);

            return callback(null);
        } catch (error: any) {
            return callback(error instanceof Error ? error : new Error(error));
        }
    }

    /**
     * Delete all sessions from the store
     *
     * @param callback
     */
    public clear (callback: (error: Error | null) => void) {
        try {
            this.cache.flushAll();

            return callback(null);
        } catch (error: any) {
            return callback(error instanceof Error ? error : new Error(error));
        }
    }

    /**
     * Returns the amount of sessions in the store
     *
     * @param callback
     */
    public length (callback: (error: Error | null, length: number) => void) {
        try {
            const keys = this.cache.keys();

            return callback(null, keys.length);
        } catch (error: any) {
            return callback(error instanceof Error ? error : new Error(error), 0);
        }
    }

    /**
     * Gets the session from the store given a session ID and passes it to `callback`.
     *
     * @param sid
     * @param callback
     */
    public get (sid: string, callback: (error: Error | null, session?: SessionData | null) => void) {
        try {
            const value = this.cache.get<SessionData>(sid);

            return callback(null, value || null);
        } catch (error: any) {
            return callback(error instanceof Error ? error : new Error(error));
        }
    }

    /**
     * Upserts a session in the store given a session ID and SessionData
     *
     * @param sid
     * @param session
     * @param callback
     */
    public set (sid: string, session: SessionData, callback: (error: Error | null) => void) {
        try {
            this.cache.set(sid, session, this.options.stdTTL ?? 86400);

            return callback(null);
        } catch (error: any) {
            return callback(error instanceof Error ? error : new Error(error));
        }
    }

    /**
     * "Touches" a given session, resetting the idle timer
     *
     * @param sid
     * @param _session
     * @param callback
     */
    public touch (sid: string, _session: SessionData, callback: () => void) {
        try {
            this.cache.ttl(sid, this.options.stdTTL ?? 86400);
        } catch {
        }

        return callback();
    }
}
