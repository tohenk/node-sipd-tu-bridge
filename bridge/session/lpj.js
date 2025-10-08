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

const SipdSession = require('.');
const { SipdNpdKegActivitySelector, SipdNpdSubKegActivitySelector } = require('./activity');
const { SipdQueryNpd, SipdQueryTbp } = require('./pages');
const { By } = require('selenium-webdriver');

class SipdLpjSession extends SipdSession {

    doInitialize() {
        this.createAfektasi('npd');
        this.kegSelector = new SipdNpdKegActivitySelector();
        this.subkegSelector = new SipdNpdSubKegActivitySelector();
        this.progressInitialValue = 'Baru';
    }

    queryNpd(queue, options) {
        return this.doQuery(new SipdQueryNpd(this.sipd, queue, options || {}));
    }

    checkNpd(queue, options = null) {
        return this.queryNpd(queue, {navigates: ['Pengeluaran', 'Pengajuan', 'NPD'], ...(options || {})});
    }

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

    setujuiNpd(queue, status = 'Baru') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => Promise.reject('NPD belum dibuat!'), w => !queue.NPD],
            [w => this.checkNpd(queue)],
            [w => this.executeAction(queue, 'Persetujuan', status), w => allowChange],
            [w => this.fillForm(queue, 'setuju-npd',
                By.xpath('//header/span[contains(text(),"Setujui Pengajuan (NPD)")]/../../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Setujui Sekarang"]')), w => w.getRes(2)],
            [w => this.sipd.waitSpinner(w.getRes(3)), w => w.getRes(2)],
            [w => this.queryNpd(queue), w => w.getRes(2)],
        ]);
    }

    validasiNpd(queue, status = 'Persetujuan') {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => Promise.reject('NPD belum dibuat!'), w => !queue.NPD],
            [w => this.checkNpd(queue)],
            [w => this.executeAction(queue, 'Validasi', status), w => allowChange],
            [w => this.fillForm(queue, 'validasi-npd',
                By.xpath('//header/span[contains(text(),"Validasi Pengajuan (NPD)")]/../../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Validasi Sekarang"]')), w => w.getRes(2)],
            [w => this.sipd.waitSpinner(w.getRes(3)), w => w.getRes(2)],
            [w => this.queryNpd(queue), w => w.getRes(2)],
        ]);
    }

    queryTbp(queue, options) {
        return this.doQuery(new SipdQueryTbp(this.sipd, queue, options || {}));
    }

    checkTbp(queue, options = null) {
        return this.queryTbp(queue, {navigates: ['Pengeluaran', 'TBP', 'UP / GU'], ...(options || {})});
    }

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
}

module.exports = SipdLpjSession;