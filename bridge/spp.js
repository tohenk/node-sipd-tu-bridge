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

const SipdBridge = require('.');
const SipdQueue = require('../queue');
const SipdSppSession = require('./session/spp');

class SipdSppBridge extends SipdBridge {

    alwaysEditRekanan = false

    createSession(options) {
        return new SipdSppSession(options);
    }

    createSpp(queue) {
        return this.do([
            // switch role
            ['role', w => this.checkRole(queue)],
            // --- BP ---
            ['bp', w => this.doAs(this.ROLE_BP)],
            ['bp-login', w => w.bp.login()],
            ['bp-rekanan', w => w.bp.checkRekanan(queue, this.alwaysEditRekanan)],
            ['bp-spp', w => w.bp.checkSpp(queue)],
            // --- PPK ---
            ['ppk', w => this.doAs(this.ROLE_PPK)],
            ['ppk-login', w => w.ppk.login()],
            ['ppk-verif', w => w.ppk.checkVerifikasiSpp(queue)],
            // --- PA ---
            ['pa', w => this.doAs(this.ROLE_PA)],
            ['pa-login', w => w.pa.login()],
            ['pa-verif', w => w.pa.checkVerifikasiSpm(queue)],
            // result
            ['res', w => new Promise((resolve, reject) => {
                if (queue.SPP && queue.callback) {
                    const data = {id: queue.getMappedData('info.id'), spp: queue.SPP};
                    if (queue.SPM) {
                        data.spm = queue.SPM;
                    }
                    const callbackQueue = SipdQueue.createCallbackQueue(data, queue.callback);
                    SipdQueue.addQueue(callbackQueue);
                }
                resolve(queue.SPP ? queue.SPP : false);
            })],
        ], (w, err) => {
            return [
                [e => this.end(this.autoClose)],
            ];
        });
    }
}

module.exports = SipdSppBridge;