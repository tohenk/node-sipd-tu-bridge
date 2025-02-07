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

class SiapNotifier {

    static notify(queue) {
        return this.notifyCallback(queue.callback, queue.data);
    }

    // https://nodejs.org/dist/latest-v14.x/docs/api/http.html#http_http_request_options_callback
    static notifyCallback(url, data) {
        return new Promise((resolve, reject) => {
            let done = false;
            const payload = JSON.stringify(data);
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }
            const f = () => {
                /** @type {Buffer} buff */
                let buff, err, code;
                const parsedUrl = new URL(url);
                const http = require('https:' == parsedUrl.protocol ? 'https' : 'http');
                const req = http.request(url, options, res => {
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
                            if (res.headers.location) {
                                url = res.headers.location;
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
}

module.exports = SiapNotifier;