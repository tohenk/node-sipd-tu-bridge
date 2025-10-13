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
const SipdQueue = require('../app/queue');
const SipdSppSession = require('./session/spp');
const { SipdRole } = require('../sipd/role');

class SipdSppBridge extends SipdBridge {

    alwaysEditRekanan = false

    createSession(options) {
        return new SipdSppSession(options);
    }

    processSpp({queue, works}) {
        return this.do([
            // switch role
            ['role', w => this.checkRole(queue)],
            // works
            ...works,
            // result
            ['res', w => new Promise((resolve, reject) => {
                let res;
                if (queue.SPP && queue.SPP !== 'DRAFT') {
                    res = {
                        spp: queue.SPP,
                        tglspp: queue.SPP_TGL,
                    }
                    if (queue.SPM) {
                        res.spm = queue.SPM;
                        res.tglspm = queue.SPM_TGL;
                    }
                    if (queue.SP2D) {
                        res.sp2d = queue.SP2D;
                        res.tglsp2d = queue.SP2D_TGL;
                    }
                    if (queue.CAIR) {
                        res.cair = queue.CAIR;
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

    createSpp(queue) {
        return this.processSpp({
            queue,
            works: [
                // --- BP ---
                ['bp', w => this.doAs(SipdRole.BP)],
                ['bp-login', w => w.bp.login()],
                ['bp-rekanan', w => w.bp.createRekanan(queue, this.alwaysEditRekanan)],
                ['bp-spp', w => w.bp.createSpp(queue)],
                // --- PPK ---
                ['ppk', w => this.doAs(SipdRole.PPK)],
                ['ppk-login', w => w.ppk.login()],
                ['ppk-verif-spp', w => w.ppk.verifikasiSpp(queue)],
                // --- PA ---
                ['pa', w => this.doAs(SipdRole.PA)],
                ['pa-login', w => w.pa.login()],
                ['pa-setuju-spm', w => w.pa.verifikasiSpm(queue)],
                ['pa-cek-sp2d', w => w.pa.checkSp2d(queue)],
            ],
        });
    }

    querySpp(queue) {
        return this.processSpp({
            queue,
            works: [
                ['bp', w => this.doAs(SipdRole.BP)],
                ['bp-login', w => w.bp.login()],
                ['bp-cek-spp', w => w.bp.checkSpp(queue)],
                ['bp-cek-spm', w => w.bp.checkSpm(queue)],
                ['bp-cek-sp2d', w => w.bp.checkSp2d(queue)],
            ],
        });
    }
}

module.exports = SipdSppBridge;