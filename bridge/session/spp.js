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
const { SipdColumnQuery } = require('../../sipd/query');
const { SipdAnnouncedError } = require('../../sipd');
const { SipdQuerySpp } = require('./pages');
const { By } = require('selenium-webdriver');

class SipdSppSession extends SipdSession {

    VERIFIED = 1
    UNVERIFIED = 2
    TRANSFERED = 4

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
        return this.works([
            [w => this.querySpp(queue, {navigates: ['Pengeluaran', 'SPP', 'LS'], ...(options || {})})],
            [w => Promise.reject(new SipdAnnouncedError(`SPP ${queue.getMappedData('info.nama')} dihapus, diabaikan!`)), w => w.getRes(0) && queue.STATUS === 'Dihapus'],
        ]);
    }

    createSpp(queue) {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.checkSpp(queue)],
            [w => this.sipd.waitAndClick(By.xpath('//button/span/p[text()="Tambah SPP LS"]/../..')), w =>!w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//a/span/p[text()="Barang dan Jasa"]/../..')), w => !w.getRes(0) && allowChange],
            [w => Promise.resolve(this.spp = {}), w => !w.getRes(0) && allowChange],
            [w => this.fillForm(queue, 'spp',
                By.xpath('//h1[text()="Surat Permintaan Pembayaran Langsung (SPP-LS)"]/../../../../..'),
                By.xpath('//button/span/span[text()="Konfirmasi"]/../..')), w => allowChange && !w.getRes(0) && allowChange],
            [w => this.submitForm(By.xpath('//button[text()="Tambah Sekarang"]'), {spinner: true}), w => !w.getRes(0) && allowChange],
            [w => this.querySpp(queue, {flags: this.UNVERIFIED}), w => !w.getRes(0) && allowChange],
        ]);
    }

    verifikasiSpp(queue, status = 'Belum Diverifikasi') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.checkSpp(queue, {flags: this.VERIFIED | this.UNVERIFIED})],
            [w => w.getRes(1).findElement(By.xpath('./td[7]/div/button')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(2).click(), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(2).findElement(By.xpath('../div/div/button/span/p[text()="Verifikasi"]/../..')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(4).click(), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.fillForm(queue, 'verifikasi-spp',
                By.xpath('//header[contains(text(),"Konfirmasi")]/../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Setujui Sekarang"]')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.sipd.waitSpinner(w.getRes(6)), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.dismissModal('Verifikasi SPP Berhasil'), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.querySpp(queue, {flags: this.VERIFIED}), w => w.getRes(1) && queue.STATUS === status && allowChange],
        ]);
    }

    querySpm(queue, options) {
        options = {
            title: 'Pengeluaran',
            nomor: SipdQuerySpp.SPM,
            columns: {
                no: [1, SipdColumnQuery.COL_TIPPY],
                tgl: 3,
                untuk: [6, SipdColumnQuery.COL_SINGLE, true],
                nom: 7,
                status: {index: 4, type: SipdColumnQuery.COL_STATUS, selector: '*/*/p'},
            },
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
        return this.querySpm(queue, {navigates: ['Pengeluaran', 'SPM', 'Pembuatan']});
    }

    verifikasiSpm(queue, status = 'Belum Disetujui') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.checkSpm(queue)],
            [w => w.getRes(1).findElement(By.xpath('./td[9]/div/button')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(2).click(), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(2).findElement(By.xpath('../div/div/button/span/p[text()="Persetujuan"]/../..')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(4).click(), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//header[contains(text(),"Persetujuan SPM")]/../footer/button[text()="Setujui Sekarang"]')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.sipd.waitSpinner(w.getRes(6)), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.querySpm(queue, {flags: this.VERIFIED}), w => w.getRes(1) && queue.STATUS === status && allowChange],
        ]);
    }

    querySp2d(queue, options) {
        options = {
            title: 'Surat Perintah Pencairan Dana | Pencairan',
            nomor: SipdQuerySpp.SP2D,
            columns: {
                no: [1, SipdColumnQuery.COL_TIPPY],
                tgl: 3,
                untuk: [9, SipdColumnQuery.COL_SINGLE, true],
                nom: 10,
                tglCair: 7,
                status: {index: 6, type: SipdColumnQuery.COL_STATUS, selector: '*/*/p'},
            },
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
        return this.querySp2d(queue, {navigates: ['Pengeluaran', 'SP2D', 'Pencairan']});
    }
}

module.exports = SipdSppSession;