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
const SipdRekananSession = require('./rekanan');
const SipdSppActivitySelector = require('./activity/spp');
const SipdUtil = require('../sipd/util');
const { SipdQuerySpp } = require('./query/spp');
const { SipdQuerySpm } = require('./query/spm');
const { SipdQuerySp2d } = require('./query/sp2d');
const { By } = require('selenium-webdriver');

/**
 * Provides SPP functionality.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdSppSession extends SipdRekananSession {

    VERIFIED = 1
    UNVERIFIED = 2
    TRANSFERED = 4

    doInitialize() {
        this.createAfektasi('spp');
        this.kegSelector = SipdSppActivitySelector;
        this.subkegSelector = SipdSppActivitySelector;
    }

    /**
     * Query for SPP.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    querySpp(queue, options) {
        options = options || {};
        const fVerified = options.flags === undefined ? true : (options.flags & this.VERIFIED) === this.VERIFIED;
        const fUnverified = options.flags === undefined ? true : (options.flags & this.UNVERIFIED) === this.UNVERIFIED;
        return this.works([
            [w => this.doQuery(new SipdQuerySpp(this.sipd, queue, {...options, jenis: 'Sudah Diverifikasi'})),
                w => fVerified],
            [w => this.doQuery(new SipdQuerySpp(this.sipd, queue, {...options, jenis: 'Belum Diverifikasi'}), {match: options.exist}),
                w => fUnverified && !w.getRes(0)],
        ]);
    }

    /**
     * Check for SPP.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    checkSpp(queue, options = null) {
        return this.querySpp(queue, options || {});
    }

    /**
     * Create SPP.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    createSpp(queue) {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkSpp(queue)],
            [w => this.sipd.gotoPageTop(), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//button/span/p[text()="Tambah SPP LS"]/../..')), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//a/span/p[text()="Barang dan Jasa"]/../..')), w => !w.getRes(0) && allowChange],
            [w => this.fillForm(queue, 'spp',
                By.xpath('//h1[text()="Surat Permintaan Pembayaran Langsung (SPP-LS)"]/../../../../..'),
                By.xpath('//button/span/span[text()="Konfirmasi"]/../..')), w => allowChange && !w.getRes(0) && allowChange],
            [w => this.sipd.confirmSubmission(By.xpath('//button[text()="Tambah Sekarang"]'), {spinner: true}), w => !w.getRes(0) && allowChange],
            [w => this.querySpp(queue, {flags: this.UNVERIFIED, exist: true}), w => !w.getRes(0) && allowChange],
        ]);
    }

    /**
     * Do SPP verification.
     *
     * @param {SipdQueue} queue Queue
     * @param {string} status Status
     * @returns {Promise<any>}
     */
    verifikasiSpp(queue, status = 'Belum Diverifikasi') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkSpp(queue, {flags: this.UNVERIFIED})],
            [w => this.executeAction(queue, 'Verifikasi', status), w => w.getRes(0) && allowChange],
            [w => this.fillForm(queue, 'verifikasi-spp',
                By.xpath('//header[contains(text(),"Konfirmasi")]/../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Setujui Sekarang"]')), w => w.getRes(1)],
            [w => this.sipd.waitSpinner(w.getRes(2)), w => w.getRes(1)],
            [w => this.dismissModal('Verifikasi SPP Berhasil'), w => w.getRes(1)],
            [w => this.querySpp(queue, {flags: this.VERIFIED, exist: true}), w => w.getRes(1)],
        ]);
    }

    /**
     * Query for SPM.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    querySpm(queue, options) {
        options = options || {};
        const fVerified = options.flags === undefined ? true : (options.flags & this.VERIFIED) === this.VERIFIED;
        const fUnverified = options.flags === undefined ? true : (options.flags & this.UNVERIFIED) === this.UNVERIFIED;
        return this.works([
            [w => this.doQuery(new SipdQuerySpm(this.sipd, queue, {...options, jenis: ['LS', 'Sudah Diverifikasi']})),
                w => fVerified],
            [w => this.doQuery(new SipdQuerySpm(this.sipd, queue, {...options, jenis: ['LS', 'Belum Diverifikasi']}), {match: options.exist}),
                w => fUnverified && !w.getRes(0)],
        ]);
    }

    /**
     * Check for SPM.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    checkSpm(queue, options = null) {
        return this.querySpm(queue, {minDate: true, ...(options || {})});
    }

    /**
     * Do SPM verification.
     *
     * @param {SipdQueue} queue Queue
     * @param {string} status Status
     * @returns {Promise<any>}
     */
    verifikasiSpm(queue, status = 'Belum Disetujui') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkSpm(queue, {flags: this.UNVERIFIED})],
            [w => this.executeAction(queue, 'Persetujuan', status), w => w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//header[contains(text(),"Persetujuan SPM")]/../footer/button[text()="Setujui Sekarang"]')), w => w.getRes(1)],
            [w => this.sipd.waitSpinner(w.getRes(2)), w => w.getRes(1)],
            [w => this.querySpm(queue, {flags: this.VERIFIED, exist: true}), w => w.getRes(1)],
        ]);
    }

    /**
     * Query for SP2D.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    querySp2d(queue, options) {
        options = {minDate: true, ...(options || {})};
        const fTransfered = options.flags === undefined ? true : (options.flags & this.TRANSFERED) === this.TRANSFERED;
        return this.works([
            [w => this.doQuery(new SipdQuerySp2d(this.sipd, queue, {...options, jenis: 'Sudah Ditransfer'}), {match: options.exist}),
                w => fTransfered],
            [w => new Promise((resolve, reject) => {
                const res = w.getRes(0);
                if (queue.values && queue.values.tglCair) {
                    queue.CAIR = SipdUtil.getDate(queue.values.tglCair);
                }
                resolve(res);
            }), w => w.getRes(0)],
        ]);
    }

    /**
     * Check for SP2D.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    checkSp2d(queue, options = null) {
        return this.querySp2d(queue, options || {});
    }
}

module.exports = SipdSppSession;