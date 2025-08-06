/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025 Toha <tohenk@yahoo.com>
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

const SipdBridge = require('.');
const SipdQueue = require('../app/queue');
const SipdLpjSession = require('./session/lpj');
const { SipdRole } = require('../sipd/role');

class SipdLpjBridge extends SipdBridge {

    alwaysEditRekanan = false

    createSession(options) {
        return new SipdLpjSession(options);
    }

    processLpj({queue, works}) {
        return this.do([
            // switch role
            ['role', w => this.checkRole(queue)],
            // works
            ...works,
            // result
            ['res', w => new Promise((resolve, reject) => {
                let res;
                if (queue.NPD) {
                    res = {
                        npd: queue.NPD,
                        tglnpd: queue.NPD_TGL,
                    }
                    if (queue.TBP) {
                        res.tbp = queue.TBP;
                        res.tgltbp = queue.TBP_TGL;
                    }
                    if (queue.callback) {
                        const data = {
                            queue: queue.id,
                            id: queue.getMappedData('info.id'),
                            ...res,
                        }
                        const callbackQueue = SipdQueue.createCallbackQueue(data, queue.callback);
                        SipdQueue.addQueue(callbackQueue);
                    }
                }
                resolve(res ? res : false);
            })],
        ], (w, err) => {
            return [
                [e => this.end(queue, this.autoClose)],
            ];
        });
    }

    createLpj(queue) {
        return this.processLpj({
            queue,
            works: [
                // --- PPTK ---
                ['pptk', w => this.doAs(SipdRole.PPTK)],
                ['pptk-login', w => w.pptk.login()],
                ['pptk-npd', w => w.pptk.createNpd(queue)],
                // --- PA ---
                ['pa', w => this.doAs(SipdRole.PA)],
                ['pa-login', w => w.pa.login()],
                ['pa-setuju', w => w.pa.setujuiNpd(queue)],
                // --- BP ---
                ['bp', w => this.doAs(SipdRole.BP)],
                ['bp-login', w => w.bp.login()],
                ['bp-validasi', w => w.bp.validasiNpd(queue)],
                ['bp-rekanan', w => w.bp.createRekanan(queue, this.alwaysEditRekanan)],
                ['bp-tbp', w => w.bp.createTbp(queue)],
            ],
        });
    }

    queryLpj(queue) {
        return this.processLpj({
            queue,
            works: [
                ['bp', w => this.doAs(SipdRole.BP)],
                ['bp-login', w => w.bp.login()],
                ['bp-npd', w => w.bp.checkNpd(queue)],
                ['bp-tbp', w => w.bp.checkTbp(queue)],
            ],
        });
    }
}

module.exports = SipdLpjBridge;