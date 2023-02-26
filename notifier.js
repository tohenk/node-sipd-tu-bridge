/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2023 Toha <tohenk@yahoo.com>
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

const util = require('util');

class SiapNotifier {

    static notify(queue) {
        return this.notifyCallback(queue.callback, queue.data);
    }

    // https://nodejs.org/dist/latest-v14.x/docs/api/http.html#http_http_request_options_callback
    static notifyCallback(url, data) {
        return new Promise((resolve, reject) => {
            let buff, result, err;
            const parsedUrl = require('url').parse(url);
            const http = require('https:' == parsedUrl.protocol ? 'https' : 'http');
            const payload = JSON.stringify(data);
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }
            const req = http.request(url, options, res => {
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    if (buff) {
                        buff += chunk;
                    } else {
                        buff = chunk;
                    }
                });
                res.on('end', () => {
                    result = buff;
                });
            });
            req.on('error', e => {
                err = e;
            });
            req.on('close', () => {
                if (result) {
                    resolve(util.format('%s', result));
                } else {
                    reject(err);
                }
            });
            req.write(payload);
            req.end();
        });
    }
}

module.exports = SiapNotifier;