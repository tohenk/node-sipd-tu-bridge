/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

class SipdNotifier {

    static notify(queue) {
        return this.notifyCallback(queue.callback, queue.data);
    }

    // https://nodejs.org/dist/latest-v14.x/docs/api/http.html#http_http_request_options_callback
    static notifyCallback(url, data) {
        return new Promise((resolve, reject) => {
            let done = false;
            const payload = JSON.stringify(data);
            const options = {method: 'POST'};
            const headers = {
                'user-agent': `Node ${process.version}`,
                'accept': '*/*',
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload)
            }
            const f = () => {
                /** @type {Buffer} buff */
                let buff, err, code, rheaders;
                const parsedUrl = new URL(url);
                const http = require('https:' == parsedUrl.protocol ? 'https' : 'http');
                headers.origin = parsedUrl.origin;
                headers.referer = parsedUrl.origin;
                const cookie = this.readCookie(parsedUrl);
                if (cookie) {
                    headers.cookie = cookie;
                } else {
                    delete headers.cookie;
                }
                options.headers = headers;
                const req = http.request(url, options, res => {
                    rheaders = res.headers;
                    code = res.statusCode;
                    res.setEncoding('utf8');
                    res.on('data', chunk => {
                        if (typeof chunk === 'string') {
                            chunk = Buffer.from(chunk, 'utf8');
                        }
                        if (buff) {
                            buff = Buffer.concat([buff, chunk]);
                        } else {
                            buff = chunk;
                        }
                    });
                    res.on('end', () => {
                        if (code === 301 || code === 302) {
                            if (rheaders.location) {
                                url = rheaders.location;
                            } else {
                                reject('No redirection to follow!');
                            }
                        } else {
                            done = true;
                        }
                    });
                });
                req.on('error', e => {
                    err = e;
                });
                req.on('close', () => {
                    if (err) {
                        return reject(err);
                    }
                    if (done) {
                        if (rheaders['set-cookie']) {
                            this.writeCookie(parsedUrl, rheaders['set-cookie']);
                        }
                        resolve(code === 200 ? buff.toString() : null);
                    } else {
                        f();
                    }
                });
                req.write(payload);
                req.end();
            }
            f();
        });
    }

    /**
     * Read cookie from storage.
     *
     * @param {URL} url The url
     * @returns {string}
     */
    static readCookie(url) {
        if (!this.cookies) {
            this.cookies = {};
        }
        if (this.cookies[url.hostname]) {
            const cookies = {};
            for (const cookiePath of Object.keys(this.cookies[url.hostname])) {
                if (url.pathname.startsWith(cookiePath)) {
                    Object.assign(cookies, this.cookies[url.hostname][cookiePath]);
                }
            }
            if (Object.keys(cookies).length) {
                const cookie = [];
                for (const k of Object.keys(cookies)) {
                    cookie.push(`${k}=${cookies[k]}`);
                }
                return cookie.join('; ');
            }
        }
    }

    /**
     * Write cookie to storage.
     *
     * @param {URL} url The url
     * @param {string[]} cookies Cookie values
     */
    static writeCookie(url, cookies) {
        const items = {};
        for (const cookie of cookies) {
            let cookiePath;
            const cookieNames = {};
            for (const a of cookie.split(';').map(a => a.trim())) {
                const [k, v] = a.split('=');
                switch (k) {
                    case 'path':
                        cookiePath = v;
                        break;
                    case 'domain':
                        break;
                    default:
                        cookieNames[k] = v;
                }
            }
            if (cookiePath && Object.keys(cookieNames).length) {
                if (!items[cookiePath]) {
                    items[cookiePath] = {};
                }
                Object.assign(items[cookiePath], cookieNames);
            }
        }
        if (Object.keys(items).length) {
            /**
             * {
             *   '/': {Cookie1: 'Value1', Cookie2: 'Value2'
             * }
             */
            if (!this.cookies) {
                this.cookies = {};
            }
            if (!this.cookies[url.hostname]) {
                this.cookies[url.hostname] = {};
            }
            for (const cookiePath of Object.keys(items)) {
                if (!this.cookies[url.hostname][cookiePath]) {
                    this.cookies[url.hostname][cookiePath] = {};
                }
                Object.assign(this.cookies[url.hostname][cookiePath], items[cookiePath]);
            }
        }
    }
}

module.exports = SipdNotifier;