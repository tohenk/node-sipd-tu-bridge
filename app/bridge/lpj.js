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
const SipdLpjSession = require('../session/lpj');
const { SipdBridgeHandler } = require('.');
const { SipdRole } = require('../sipd/role');

/**
 * Sipd bridge for LPJ handling.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBridgeLpj extends SipdBridgeHandler {

    alwaysEditRekanan = false

    /**
     * Check if operation is configured in queue?
     *
     * @param {SipdQueue} queue Queue
     * @param {string} op Operation
     * @returns {boolean}
     */
    _checkOp(queue, op) {
        /** @type {string} */
        const queueOp = queue.getMappedData('info.operasi');
        if (queueOp) {
            const ops = queueOp
                .toLowerCase()
                .split(',')
                .map(s => s.trim());
            return ops.includes(op);
        }
        return true;
    }

    /**
     * Transform processing result.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} result Processing result
     * @returns any[]
     */
    _onResult(queue, result) {
        let res = result, data;
        if (queue.NPD) {
            res = {
                npd: queue.NPD,
                tglnpd: queue.NPD_TGL,
            }
            if (queue.TBP) {
                res.tbp = queue.TBP;
                res.tgltbp = queue.TBP_TGL;
            }
            data = {
                queue: queue.id,
                id: queue.getMappedData('info.id'),
                ...res,
            }
        }
        return [res, data];
    }

    /**
     * Do create LPJ task.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    createLpj(queue) {
        const sess = SipdLpjSession;
        const npd = this._checkOp(queue, 'npd');
        const tbp = this._checkOp(queue, 'tbp');
        return this.bridge.processQueue({
            queue,
            works: [
                // --- PPTK ---
                ['pptk', w => this.bridge.doAs(SipdRole.PPTK, sess), w => npd],
                ['pptk-login', w => w.pptk.login(), w => npd],
                ['pptk-npd', w => w.pptk.createNpd(queue), w => npd],
                // --- PA ---
                ['pa', w => this.bridge.doAs(SipdRole.PA, sess), w => tbp],
                ['pa-login', w => w.pa.login(), w => tbp],
                ['pa-setuju-npd', w => w.pa.setujuiNpd(queue), w => tbp],
                // --- BP ---
                ['bp', w => this.bridge.doAs(SipdRole.BP, sess), w => tbp],
                ['bp-login', w => w.bp.login(), w => tbp],
                ['bp-validasi-npd', w => w.bp.validasiNpd(queue), w => tbp],
                ['bp-rekanan', w => w.bp.createRekanan(queue, this.alwaysEditRekanan), w => tbp],
                ['bp-tbp', w => w.bp.createTbp(queue), w => tbp],
            ],
            onResult: this._onResult,
        });
    }

    /**
     * Do query LPJ task.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    queryLpj(queue) {
        const sess = SipdLpjSession;
        const npd = this._checkOp(queue, 'npd');
        const tbp = this._checkOp(queue, 'tbp');
        return this.bridge.processQueue({
            queue,
            works: [
                ['bp', w => this.bridge.doAs(SipdRole.BP, sess)],
                ['bp-login', w => w.bp.login()],
                ['bp-cek-npd', w => w.bp.checkNpd(queue), w => npd],
                ['bp-cek-tbp', w => w.bp.checkTbp(queue), w => tbp],
            ],
            onResult: this._onResult,
        });
    }

    /**
     * Do list LPJ task.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    listLpj(queue) {
        const sess = SipdLpjSession;
        return this.bridge.processQueue({
            queue,
            works: [
                ['bp', w => this.bridge.doAs(SipdRole.BP, sess)],
                ['bp-login', w => w.bp.login()],
                ['bp-lpj', w => w.bp.listLpj(queue)],
            ],
        });
    }
}

module.exports = SipdBridgeLpj;