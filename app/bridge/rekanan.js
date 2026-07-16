/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2026 Toha <tohenk@yahoo.com>
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

const SipdQueue = require('../queue');
const SipdRekananSession = require('../session/rekanan');
const { SipdBridgeHandler } = require('.');
const { SipdRole } = require('../sipd/role');

/**
 * SIPD bridge for common handling.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBridgeRekanan extends SipdBridgeHandler {

    /**
     * Query for partner.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    queryRekanan(queue) {
        return this.bridge.processQueue({
            queue,
            works: [
                ['bp', w => this.bridge.doAs(SipdRole.BP, SipdRekananSession)],
                ['bp-login', w => w.bp.login()],
                ['bp-rekanan', w => w.bp.listRekanan(queue)],
            ],
        });
    }
}

module.exports = SipdBridgeRekanan;