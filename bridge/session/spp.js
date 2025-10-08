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

const SipdSession = require('.');
const SipdUtil = require('../../sipd/util');
const { SipdSppActivitySelector } = require('./activity');
const { SipdQuerySpp } = require('./pages');
const { By } = require('selenium-webdriver');

class SipdSppSession extends SipdSession {

    VERIFIED = 1
    UNVERIFIED = 2
    TRANSFERED = 4

    doInitialize() {
        this.createAfektasi('spp');
        this.kegSelector = new SipdSppActivitySelector();
        this.subkegSelector = new SipdSppActivitySelector();
    }

    querySpp(queue, options) {
        options = {
            title: 'Surat Permintaan Pembayaran (SPP) | LS',
            ...(options || {}),
        }
        const fVerified = options.flags === undefined ? true : (options.flags & this.VERIFIED) === this.VERIFIED;
        const fUnverified = options.flags === undefined ? true : (options.flags & this.UNVERIFIED) === this.UNVERIFIED;
        return this.works([
            [w => this.doQuery(new SipdQuerySpp(this.sipd, queue, {...options, jenis: 'Sudah Diverifikasi'})), w => fVerified],
            [w => this.doQuery(new SipdQuerySpp(this.sipd, queue, {...options, jenis: 'Belum Diverifikasi'})), w => fUnverified && !w.getRes(0)],
        ]);
    }

    checkSpp(queue, options = null) {
        options = options || {};
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => options.exist && !queue.SPP],
            [w => this.querySpp(queue, {navigates: ['Pengeluaran', 'SPP', 'LS'], ...options})],
        ]);
    }

    createSpp(queue) {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkSpp(queue)],
            [w => this.sipd.gotoPageTop(), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//button/span/p[text()="Tambah SPP LS"]/../..')), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//a/span/p[text()="Barang dan Jasa"]/../..')), w => !w.getRes(0) && allowChange],
            [w => Promise.resolve(this.spp.clear()), w => !w.getRes(0) && allowChange],
            [w => this.fillForm(queue, 'spp',
                By.xpath('//h1[text()="Surat Permintaan Pembayaran Langsung (SPP-LS)"]/../../../../..'),
                By.xpath('//button/span/span[text()="Konfirmasi"]/../..')), w => allowChange && !w.getRes(0) && allowChange],
            [w => this.sipd.confirmSubmission(By.xpath('//button[text()="Tambah Sekarang"]'), {spinner: true}), w => !w.getRes(0) && allowChange],
            [w => this.querySpp(queue, {flags: this.UNVERIFIED}), w => !w.getRes(0) && allowChange],
        ]);
    }

    verifikasiSpp(queue, status = 'Belum Diverifikasi') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkSpp(queue, {flags: this.VERIFIED | this.UNVERIFIED, exist: true})],
            [w => this.executeAction(queue, 'Verifikasi', status), w => allowChange],
            [w => this.fillForm(queue, 'verifikasi-spp',
                By.xpath('//header[contains(text(),"Konfirmasi")]/../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Setujui Sekarang"]')), w => w.getRes(1)],
            [w => this.sipd.waitSpinner(w.getRes(2)), w => w.getRes(1)],
            [w => this.dismissModal('Verifikasi SPP Berhasil'), w => w.getRes(1)],
            [w => this.querySpp(queue, {flags: this.VERIFIED}), w => w.getRes(1)],
        ]);
    }

    querySpm(queue, options) {
        options = {
            title: 'Pengeluaran',
            nomor: SipdQuerySpp.SPM,
            ...(options || {}),
        }
        const fVerified = options.flags === undefined ? true : (options.flags & this.VERIFIED) === this.VERIFIED;
        const fUnverified = options.flags === undefined ? true : (options.flags & this.UNVERIFIED) === this.UNVERIFIED;
        return this.works([
            [w => this.doQuery(new SipdQuerySpp(this.sipd, queue, {...options, jenis: ['LS', 'Sudah Diverifikasi']})), w => fVerified],
            [w => this.doQuery(new SipdQuerySpp(this.sipd, queue, {...options, jenis: ['LS', 'Belum Diverifikasi']})), w => fUnverified && !w.getRes(0)],
        ]);
    }

    checkSpm(queue) {
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.querySpm(queue, {navigates: ['Pengeluaran', 'SPM', 'Pembuatan']})],
        ]);
    }

    verifikasiSpm(queue, status = 'Belum Disetujui') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkSpm(queue)],
            [w => this.executeAction(queue, 'Persetujuan', status), w => allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//header[contains(text(),"Persetujuan SPM")]/../footer/button[text()="Setujui Sekarang"]')), w => w.getRes(1)],
            [w => this.sipd.waitSpinner(w.getRes(2)), w => w.getRes(1)],
            [w => this.querySpm(queue, {flags: this.VERIFIED}), w => w.getRes(1)],
        ]);
    }

    querySp2d(queue, options) {
        options = {
            title: 'Surat Perintah Pencairan Dana | Pencairan',
            nomor: SipdQuerySpp.SP2D,
            skipDate: true,
            ...(options || {}),
        }
        const fTransfered = options.flags === undefined ? true : (options.flags & this.TRANSFERED) === this.TRANSFERED;
        return this.works([
            [w => this.doQuery(new SipdQuerySpp(this.sipd, queue, {...options, jenis: 'Sudah Ditransfer'})), w => fTransfered],
            [w => new Promise((resolve, reject) => {
                const res = w.getRes(0);
                if (queue.values && queue.values.tglCair) {
                    queue.CAIR = SipdUtil.getDate(queue.values.tglCair);
                }
                resolve(res);
            }), w => w.getRes(0)],
        ]);
    }

    checkSp2d(queue) {
        return this.works([
            [w => Promise.reject('SPM belum dibuat!'), w => !queue.SPM],
            [w => this.querySp2d(queue, {navigates: ['Pengeluaran', 'SP2D', 'Pencairan']})],
        ]);
    }
}

module.exports = SipdSppSession;