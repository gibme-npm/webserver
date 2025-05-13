// Copyright (c) 2023-2025, Brandon Lehmann <brandonlehmann@gmail.com>
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

import { bin, Connection, install, Tunnel } from 'cloudflared';
import { getServers, lookup, setServers } from 'dns';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { Timer } from '@gibme/timer';
import fetch from '@gibme/fetch';

export { Connection };

class Cloudflared extends EventEmitter {
    public readonly system_dns_servers: string[] = getServers();
    public readonly dns_servers: string[];
    private readonly dns_timer: Timer;
    private readonly https_timer: Timer;
    private readonly ready_timer: Timer;
    private _timeout?: NodeJS.Timeout;

    constructor (public readonly local_url: string, check_interval = 2000) {
        super();

        setServers([
            ...this.system_dns_servers,
            '1.1.1.1',
            '8.8.8.8',
            '9.9.9.9'
        ]);

        this.dns_servers = getServers();

        this.dns_timer = new Timer(check_interval, true);
        this.https_timer = new Timer(check_interval, true);
        this.ready_timer = new Timer(check_interval, true);

        this.dns_timer.on('tick', async () => {
            if (this.hostname) {
                if (await this.dns_exists()) {
                    this._dns_ready = true;

                    this.emit('subservice', {
                        timestamp: new Date(),
                        url: this.url,
                        hostname: this.hostname,
                        connections: this.connections,
                        type: 'dns'
                    });

                    this.dns_timer.destroy();
                } else {
                    this.emit('progress', {
                        timestamp: new Date(),
                        url: this.url,
                        hostname: this.hostname,
                        connections: this.connections,
                        type: 'dns',
                        status: 'not_ready'
                    });
                }
            }
        });

        this.https_timer.on('tick', async () => {
            if (this.hostname) {
                if (await this.https_exists()) {
                    this._https_ready = true;

                    this.emit('subservice', {
                        timestamp: new Date(),
                        url: this.url,
                        hostname: this.hostname,
                        connections: this.connections,
                        type: 'https'
                    });

                    this.https_timer.destroy();
                } else {
                    this.emit('progress', {
                        timestamp: new Date(),
                        url: this.url,
                        hostname: this.hostname,
                        connections: this.connections,
                        type: 'https',
                        status: 'not_ready'
                    });
                }
            }
        });

        this.ready_timer.on('tick', async () => {
            if (this.ready) {
                this.emit('ready', {
                    timestamp: new Date(),
                    url: this.url,
                    hostname: this.hostname,
                    connections: this.connections
                });

                this.ready_timer.destroy();
            }
        });
    }

    private _url?: string;

    public get url (): string | undefined {
        return this._url;
    }

    private _hostname?: string;

    public get hostname (): string | undefined {
        return this._hostname;
    }

    private _connections = new Set<Connection>();

    public get connections (): Set<Connection> {
        return this._connections;
    }

    private _dns_ready = false;

    public get dns_ready (): boolean {
        return this._dns_ready;
    }

    private _https_ready = false;

    public get https_ready (): boolean {
        return this._https_ready;
    }

    public get ready (): boolean {
        return this.dns_ready && this.https_ready;
    }

    private _tunnel?: Tunnel;

    private get tunnel (): Tunnel | undefined {
        return this._tunnel;
    }

    /**
     * Attempts to install the cloudflared binary
     * @private
     */
    public static async install_cloudflared (): Promise<string | undefined> {
        try {
            if (!existsSync(bin)) {
                await install(bin);
            }

            return bin;
        } catch {
        }
    }

    public on(event: 'started', listener: () => void): this;

    public on(event: 'stopped', listener: () => void): this;

    public on(event: 'ready', listener: (event: Cloudflared.ReadyEvent) => void): this;

    public on(event: 'progress', listener: (event: Cloudflared.SubServiceProgressEvent) => void): this;

    public on(event: 'subservice', listener: (event: Cloudflared.SubServiceReadyEvent) => void): this;

    public on(event: 'timeout', listener: (error: Error) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    public once(event: 'started', listener: () => void): this;

    public once(event: 'stopped', listener: () => void): this;

    public once(event: 'ready', listener: (event: Cloudflared.ReadyEvent) => void): this;

    public once(event: 'progress', listener: (event: Cloudflared.SubServiceProgressEvent) => void): this;

    public once(event: 'subservice', listener: (event: Cloudflared.SubServiceReadyEvent) => void): this;

    public once(event: 'timeout', listener: (error: Error) => void): this;

    public once (event: any, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    public off(event: 'started', listener: () => void): this;

    public off(event: 'stopped', listener: () => void): this;

    public off(event: 'ready', listener: (event: Cloudflared.ReadyEvent) => void): this;

    public off(event: 'progress', listener: (event: Cloudflared.SubServiceProgressEvent) => void): this;

    public off(event: 'subservice', listener: (event: Cloudflared.SubServiceReadyEvent) => void): this;

    public off(event: 'timeout', listener: (error: Error) => void): this;

    public off (event: any, listener: (...args: any[]) => void): this {
        return super.off(event, listener);
    }

    public async start (timeout = 30000): Promise<boolean> {
        if (this.tunnel) {
            return true;
        }

        if (!await Cloudflared.install_cloudflared()) {
            return false;
        }

        this._timeout = setTimeout(() => {
            if (!this.ready) {
                this.stop();

                this.emit('timeout',
                    new Error('Tunnel could not be started within the given timeout.'));
            }
        }, timeout);

        try {
            this._tunnel = Tunnel.quick(this.local_url);

            this._tunnel.once('url', url => {
                this._url = url;
                this._hostname = new URL(url).hostname;
            });

            this._tunnel.once('connected', connection => {
                this._connections.clear();
                this._connections.add(connection);
            });

            this.emit('started');

            return true;
        } catch {
            this.cleanup();

            return false;
        }
    }

    private cleanup (): void {
        this.dns_timer.destroy();
        this.https_timer.destroy();
        this.ready_timer.destroy();
        delete this._hostname;
        this._connections.clear();
        delete this._url;
    }

    public async stop (): Promise<boolean> {
        this.cleanup();

        if (!this.tunnel) {
            return true;
        }

        const result = this.tunnel.stop();

        delete this._tunnel;

        this.emit('stopped');

        return result;
    }

    /**
     * Checks if the tunnel is responding via HTTPs
     * @private
     */
    private async https_exists (): Promise<boolean> {
        try {
            if (this.url) {
                await fetch.get(this.url);

                return true;
            } else {
                return false;
            }
        } catch {
            return false;
        }
    }

    /**
     * Checks if the tunnel is responding via DNS
     * @private
     */
    private async dns_exists (): Promise<boolean> {
        return new Promise(resolve => {
            if (this.hostname) {
                lookup(this.hostname, error => {
                    if (error) return resolve(false);

                    return resolve(true);
                });
            } else {
                return resolve(false);
            }
        });
    }
}

export namespace Cloudflared {
    export type ReadyEvent = {
        timestamp: Date;
        url: string;
        hostname: string;
        connection: Set<Connection>;
    }

    export type SubServiceReadyEvent = ReadyEvent & {
        type: 'dns' | 'https';
    }

    export type SubServiceProgressEvent = SubServiceReadyEvent & {
        status: 'not_ready'
    }
}

export default Cloudflared;
