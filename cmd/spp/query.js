/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025-2026 Toha <tohenk@yahoo.com>
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

const SipdCmd = require('..');
const SipdQueue = require('../../app/queue');

class SipdCmdSppQuery extends SipdCmd {

    consume(payload) {
        let result;
        const { socket, data, filename } = payload;
        const batch = Array.isArray(data.items);
        const items = batch ? data.items : [data];
        let cnt = 0;
        items.forEach(spp => {
            const [res, queue] = this.dequeue.createQueue({
                type: SipdQueue.QUEUE_SPP_QUERY,
                data: spp,
                callback: socket?.callback,
            }, true);
            cnt++;
            if (!batch) {
                if (filename) {
                    queue.filename = filename;
                }
                result = res;
            }
        });
        if (batch) {
            result = {count: cnt, message: 'SPP query is being queued'};
        }
        return result;
    }
}

module.exports = SipdCmdSppQuery;