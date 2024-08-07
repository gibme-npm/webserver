// Copyright (c) 2023, Brandon Lehmann <brandonlehmann@gmail.com>
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

import { tunnel, Connection, bin as cloudflared, install } from 'cloudflared';
import { lookup, setServers, getServers } from 'dns';
import { ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import fetch from '@gibme/fetch';

export { Connection };

setServers([
    ...getServers(),
    '1.1.1.1',
    '8.8.8.8',
    '9.9.9.9'
]);

/** @ignore */
const sleep = async (timeout: number) =>
    new Promise(resolve => setTimeout(resolve, timeout));

/**
 * @ignore
 * @param hostname
 */
const checkDNS = async (hostname: string): Promise<boolean> =>
    new Promise(resolve => {
        lookup(hostname, (error) => {
            if (error) {
                return resolve(false);
            }

            return resolve(true);
        });
    });

/**
 * @ignore
 * @param url
 * @param maxRetries
 * @param timeout
 * @param attempt
 */
const waitForDNS = async (
    url: string,
    maxRetries = 10,
    timeout = 2000,
    attempt = 0
): Promise<boolean> => {
    if (attempt >= maxRetries) {
        return false;
    }

    await sleep(timeout);

    const result = await checkDNS(new URL(url).hostname);

    if (result) {
        return result;
    }

    return waitForDNS(url, maxRetries, timeout, ++attempt);
};

/**
 * Wait for HTTPs to respond over the tunnel
 *
 * @param url
 * @param maxRetries
 * @param timeout
 * @param attempt
 */
const waitForHttps = async (
    url: string,
    maxRetries = 10,
    timeout = 2000,
    attempt = 0
): Promise<boolean> => {
    if (attempt >= maxRetries) {
        return false;
    }

    await sleep(timeout);

    try {
        await fetch(url);

        return true;
    } catch (error: any) {
        if (error.toString().toLowerCase().includes('ENOTFOUND')) {
            return waitForHttps(url, maxRetries, timeout, ++attempt);
        }

        return false;
    }
};

/**
 * Installs the cloudflared binary if it is not already installed
 */
export const installCloudflared = async (): Promise<string | undefined> => {
    try {
        if (!existsSync(cloudflared)) {
            await install(cloudflared);
        }

        return cloudflared;
    } catch {

    }
};

/**
 * Starts a cloudflared tunnel and waits the maximum number of retries
 * for DNS to resolve otherwise the state is "unknown"
 *
 * @param localURL
 * @param maxRetries
 * @param timeout
 */
const startCloudflaredTunnel = async (
    localURL: string,
    maxRetries = 10,
    timeout = 2000
): Promise<{
    url: string,
    connections: Connection[],
    child: ChildProcess,
    stop: () => Promise<boolean>
} | undefined> => {
    const cloudflared = await installCloudflared();

    if (!cloudflared) {
        return;
    }

    const _tunnel = tunnel({
        '--url': localURL
    });

    const child = _tunnel.child;

    const url = await _tunnel.url;

    const connections = await Promise.all(_tunnel.connections);

    const stop = async (): Promise<boolean> => {
        try {
            return _tunnel.stop();
        } catch {
            return true;
        }
    };

    // wait until the tunnel DNS resolves
    if (!await waitForDNS(url, maxRetries, timeout)) {
        return;
    }

    // wait until the tunnel is actually reachable
    if (!await waitForHttps(url, maxRetries, timeout)) {
        return;
    }

    return {
        url,
        connections,
        child,
        stop
    };
};

export default startCloudflaredTunnel;
