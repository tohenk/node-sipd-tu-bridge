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

const crypto = require('crypto');
const SipdCmd = require('.');

class SipdCmdSetup extends SipdCmd {

    consume(payload) {
        const { socket, data } = payload;
        const res = {};
        if (socket) {
            res.version = this.parent.VERSION;
            if (data.callback) {
                socket.callback = data.callback;
            }
            if (data.key) {
                if (typeof data.key === 'string') {
                    const buff = Buffer.from(data.key, 'base64');
                    if (buff.length) {
                        socket.key = crypto.createPublicKey(buff);
                    }
                }
                if (this.config.pubkey) {
                    const key = this.config.pubkey.export({type: 'spki', format: 'pem'});
                    res.key = Buffer.from(key).toString('base64');
                }
            }
        }
        return res;
    }
}

module.exports = SipdCmdSetup;