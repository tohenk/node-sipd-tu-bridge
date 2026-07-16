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

const Queue = require('@ntlab/work/queue');
const SipdNpdKegActivitySelector = require('./activity/npd-keg');
const SipdNpdSubKegActivitySelector = require('./activity/npd-subkeg');
const SipdQueue = require('../queue');
const SipdRekananSession = require('./rekanan');
const SipdLpjReader = require('./reader/lpj');
const SipdTbpReader = require('./reader/tbp');
const { SipdColumnQuery } = require('../sipd/query');
const { SipdQueryBase } = require('./query');
const { SipdQueryNpd } = require('./query/npd');
const { SipdQueryTbp } = require('./query/tbp');
const { SipdQueryLpj } = require('./query/lpj');
const { By } = require('selenium-webdriver');

const dtag = 'lpjsession';

/**
 * Provides LPJ functionality.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdLpjSession extends SipdRekananSession {

    partial = 25

    doInitialize() {
        this.createAfektasi('npd');
        this.kegSelector = SipdNpdKegActivitySelector;
        this.subkegSelector = SipdNpdSubKegActivitySelector;
    }

    /**
     * Create LPJ iterator.
     *
     * @param {SipdQueryBase} query
     * @param {SipdQueue} queue
     * @returns {Function}
     */
    createLpjIterator(query, queue) {
        const reader = new SipdLpjReader(this.sipd);
        return (el, values, result) => {
            if (values?.url) {
                const url = values.url;
                delete values.url;
                return this.works([
                    [w => query.getRowState(values)],
                    [w => this.sipd.doOpenInNewTab(url, [
                        [w => reader.extract()],
                        [w => new Promise((resolve, reject) => {
                            const queues = [...w.res.tbp];
                            const parts = [];
                            const q = new Queue(queues, tbp => {
                                const tbpQueue = SipdQueue.createWithMap(queue.maps)
                                    .setData({
                                        [queue.getMap('info.tbp')]: tbp.NO_TBP,
                                        [queue.getMap('npd.npd:TGL')]: tbp.TGL_TBP,
                                        [queue.getMap('npd.npd:NOMINAL')]: tbp.AFEKTASI,
                                        [queue.getMap('npd.npd:UNTUK')]: tbp.URAIAN,
                                    });
                                this.checkTbp(tbpQueue, {detail: true})
                                    .then(res => {
                                        Object.assign(tbp, tbpQueue.values[SipdTbpReader.KEY]);
                                        if (this.partial) {
                                            parts.push(tbp);
                                            if (parts.length === this.partial) {
                                                queue.sendResult([{...values, [SipdLpjReader.KEY]: parts}]);
                                                parts.splice(0);
                                            }
                                        }
                                        q.next();
                                    })
                                    .catch(err => {
                                        this.sipd.isContinueable()
                                            .then(() => {
                                                this.debug(dtag)(`TBP error: ${err}!`);
                                                q.next();
                                            })
                                            .catch(err => q.done());
                                    });
                            });
                            q.once('done', () => resolve({...values, ...w.res}));
                        })],
                    ]), w => w.getRes(0)],
                ], {alwaysResolved: true});
            } else {
                return Promise.resolve(values);
            }
        }
    }

    /**
     * Query for NPD.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    queryNpd(queue, options) {
        return this.doQuery(new SipdQueryNpd(this.sipd, queue, options || {}));
    }

    /**
     * Check for NPD.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    checkNpd(queue, options = null) {
        return this.queryNpd(queue, {navigates: ['Pengeluaran', 'Pengajuan', 'NPD'], ...(options || {})});
    }

    /**
     * Create NPD.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    createNpd(queue) {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkNpd(queue)],
            [w => this.sipd.gotoPageTop(), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//a/button[text()="Tambah"]/..')), w => !w.getRes(0) && allowChange],
            [w => Promise.resolve(this.npd.clear()), w => !w.getRes(0) && allowChange],
            [w => this.fillForm(queue, 'npd',
                By.xpath('//h1[text()="Pengajuan | Nota Pencairan Dana"]/../../..'),
                By.xpath('//button/span/span[text()="Konfirmasi"]/../..')), w => allowChange && !w.getRes(0) && allowChange],
            [w => this.sipd.confirmSubmission(By.xpath('//button[text()="Tambah Sekarang"]'), {spinner: true}), w => !w.getRes(0) && allowChange],
            [w => this.queryNpd(queue), w => !w.getRes(0) && allowChange],
        ]);
    }

    /**
     * Do NPD approval.
     *
     * @param {SipdQueue} queue Queue
     * @param {string} status Status
     * @returns {Promise<any>}
     */
    setujuiNpd(queue, status = 'Baru') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => Promise.reject('NPD is not created yet!'), w => !queue.NPD],
            [w => this.checkNpd(queue)],
            [w => this.executeAction(queue, 'Persetujuan', status), w => allowChange],
            [w => this.fillForm(queue, 'setuju-npd',
                By.xpath('//header/span[contains(text(),"Setujui Pengajuan (NPD)")]/../../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Setujui Sekarang"]')), w => w.getRes(2)],
            [w => this.sipd.waitSpinner(w.getRes(3)), w => w.getRes(2)],
            [w => this.queryNpd(queue), w => w.getRes(2)],
        ]);
    }

    /**
     * Do NPD validation.
     *
     * @param {SipdQueue} queue Queue
     * @param {string} status Status
     * @returns {Promise<any>}
     */
    validasiNpd(queue, status = 'Persetujuan') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => Promise.reject('NPD is not created yet!'), w => !queue.NPD],
            [w => this.checkNpd(queue)],
            [w => this.executeAction(queue, 'Validasi', status), w => allowChange],
            [w => this.fillForm(queue, 'validasi-npd',
                By.xpath('//header/span[contains(text(),"Validasi Pengajuan (NPD)")]/../../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Validasi Sekarang"]')), w => w.getRes(2)],
            [w => this.sipd.waitSpinner(w.getRes(3)), w => w.getRes(2)],
            [w => this.queryNpd(queue), w => w.getRes(2)],
        ]);
    }

    /**
     * Query for TBP.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    queryTbp(queue, options) {
        const query = new SipdQueryTbp(this.sipd, queue, options || {});
        if (options.detail) {
            this.createReader(query, SipdTbpReader);
        }
        return this.doQuery(query);
    }

    /**
     * Check for TBP.
     *
     * @param {SipdQueue} queue Queue
     * @param {object} options Options
     * @returns {Promise<any>}
     */
    checkTbp(queue, options = null) {
        return this.queryTbp(queue, {navigates: ['Pengeluaran', 'TBP', 'UP / GU'], ...(options || {})});
    }

    /**
     * Create TBP.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    createTbp(queue) {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkTbp(queue)],
            [w => this.sipd.gotoPageTop(), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//a/button[text()="Tambah"]/..')), w => !w.getRes(0) && allowChange],
            [w => this.fillForm(queue, 'tbp',
                By.xpath('//h1[text()="Tanda Bukti Pembayaran (TBP)"]/../../../../..'),
                By.xpath('//button/span/span[text()="Konfirmasi"]/../..')), w => allowChange && !w.getRes(0) && allowChange],
            [w => this.sipd.confirmSubmission(By.xpath('//button[text()="Tambah Sekarang"]'), {spinner: true}), w => !w.getRes(0) && allowChange],
            [w => this.queryTbp(queue), w => !w.getRes(0) && allowChange],
        ]);
    }

    /**
     * List LPJ.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<object[]>}
     */
    listLpj(queue) {
        const query = new SipdQueryLpj(this.sipd, queue, {
            navigates: ['Pengeluaran', 'LPJ', 'UP / GU', 'Pembuatan'],
            jenis: 'Diverifikasi',
        });
        return this.doQuery(query, this.createLpjIterator(query, queue));
    }
}

module.exports = SipdLpjSession;