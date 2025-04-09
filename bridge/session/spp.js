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
const SipdPage = require('../../sipd/page');
const { SipdAnnouncedError } = require('../../sipd');
const { By } = require('selenium-webdriver');
const debug = require('debug')('sipd:spp');

class SipdSppSession extends SipdSession {

    VERIFIED = 1
    UNVERIFIED = 2
    DELETED = 4

    COL_ICON = 1
    COL_STATUS = 2
    COL_SINGLE = 3
    COL_TIPPY = 4
    COL_TWOLINE2 = 5

    checkRekanan(queue, forceEdit = false) {
        let clicker;
        const lembaga = this.getSafeStr(queue.getMappedData('info.nama'));
        const nik = queue.getMappedData('info.nik');
        const alt = lembaga.indexOf('\'') >= 0;
        const page = this.createPage(alt ? this.PAGE_REKANAN_ALT : this.PAGE_REKANAN, 'Daftar Rekanan');
        return this.works([
            [w => this.sipd.navigate('Pengeluaran', 'Daftar Rekanan')],
            [w => this.sipd.waitLoader()],
            [w => page.setup()],
            [w => page.search(alt ? nik : lembaga)],
            [w => page.each({filtered: true}, el => [
                [x => this.sipd.getText([By.xpath('./td[2]/div/div/div[2]/span[1]'), By.xpath('./td[1]/div/div/div[2]/span[2]')], el)],
                [x => el.findElement(By.xpath('./td[4]/a'))],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0);
                    if (values.length > 1 && values[1]) {
                        values[1] = this.pickNumber(values[1]);
                    }
                    if (values.join('|') === [lembaga, nik].join('|')) {
                        clicker = x.getRes(1);
                        reject(SipdPage.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [w => this.sipd.waitAndClick(By.xpath('//button[text()="Tambah Rekanan"]')), w => !clicker],
            [w => clicker.click(), w => clicker && forceEdit],
            [w => this.fillForm(queue, 'rekanan',
                By.xpath('//h1/h1[text()="Tambah Rekanan"]/../../../..'),
                By.xpath('//button[text()="Konfirmasi"]')), w => !clicker || forceEdit],
            [w => this.sipd.waitAndClick(By.xpath('//section/footer/button[1]')), w => !clicker || forceEdit],
            [w => this.sipd.waitLoader(), w => !clicker || forceEdit],
        ]);
    }

    queryData(queue, options) {
        let result;
        const tgl = this.getDate(queue.getMappedData('spp.spp:TGL'));
        const nominal = queue.getMappedData('spp.spp:NOMINAL');
        const untuk = this.getSafeStr(queue.getMappedData('spp.spp:UNTUK'));
        const title = options.title;
        const jenis = options.jenis;
        const nomor = options.nomor || 'SPP';
        const page = this.createPage(this.PAGE_SPP, title);
        const tvalues = {};
        const tselectors = {
            [this.COL_ICON]: '*/*/*[2]/*[1]',
            [this.COL_STATUS]: '*/*/*/p',
            [this.COL_SINGLE]: '*/*/span',
            [this.COL_TIPPY]: 'div[@class="custom-tippy"]/div/div/div/div[2]/span[1]',
            [this.COL_TWOLINE2]: 'span[2]',
        }
        // index, withIcon, withTippy
        const columns = {
            noSpp: 1,
            tglSpp: 4,
            untukSpp: [5, this.COL_SINGLE, true],
            nomSpp: 6,
            statusSpp: [2, this.COL_STATUS],
        }
        const tippies = {};
        for (const k in columns) {
            const v = options.columns && options.columns[k] ? options.columns[k] : columns[k];
            const idx = Array.isArray(v) ? v[0] : (typeof v === 'object' ? v.index : v);
            const colType = Array.isArray(v) ? v[1] : (typeof v === 'object' && v.type ? v.type : this.COL_ICON);
            const withTippy = Array.isArray(v) ? v[2] : (typeof v === 'object' && v.tippy ? v.tippy : false);
            const selector = typeof v === 'object' && v.selector ? v.selector : tselectors[colType];
            tvalues[k] = By.xpath(`./td[${idx}]/${selector}`);
            if (withTippy) {
                tippies[k] = By.xpath(`./td[${idx}]/div[@class="custom-tippy"]/div`);
            }
        }
        return this.works([
            [w => this.sipd.waitLoader()],
            [w => page.setup()],
            [w => this.sipd.waitAndClick(By.xpath(`//button/p[text()="${jenis}"]/..`))],
            [w => this.sipd.waitSpinner(w.getRes(2))],
            [w => page.search(untuk, 'Keterangan')],
            [w => page.each({filtered: true}, el => [
                [x => this.sipd.getText(tvalues, el)],
                [x => this.getTippyText(tippies, el), x => Object.keys(tippies).length],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0);
                    const tippyValues = Object.keys(tippies).length ? x.getRes(1) : {};
                    const noSpp = values.noSpp;
                    const tglSpp = this.getDate(values.tglSpp);
                    const untukSpp = tippyValues.untukSpp ? tippyValues.untukSpp.trim() : values.untukSpp;
                    const nomSpp = parseFloat(this.pickCurr(values.nomSpp));
                    const statusSpp = values.statusSpp;
                    const dbg = (l, s) => `${l} (${s ? 'v' : 'x'})`;
                    const f = (...args) => {
                        const res = {
                            states: [],
                            info: [],
                        }
                        for (const arg of args) {
                            res.states.push(arg[0] == arg[1]);
                            res.info.push(dbg(arg[0], arg[0] == arg[1]));
                        }
                        res.okay = true;
                        res.states.forEach(state => {
                            if (!state) {
                                res.okay = false;
                                return true;
                            }
                        });
                        return res;
                    }
                    const states = f(
                        [this.dateSerial(tglSpp), this.dateSerial(tgl)],
                        [nomSpp, nominal],
                        [this.getSafeStr(untukSpp), untuk]);
                    debug(statusSpp, ...states.info);
                    if (states.okay) {
                        result = el;
                        queue[nomor] = noSpp;
                        queue.STATUS = statusSpp;
                        reject(SipdPage.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [w => Promise.resolve(result)],
        ]);
    }

    querySpp(queue, options) {
        options = options || {};
        const title = options.title || 'Surat Permintaan Pembayaran (SPP) | Langsung';
        const fVerified = options.flags === undefined ? true : (options.flags & this.VERIFIED) === this.VERIFIED;
        const fUnverified = options.flags === undefined ? true : (options.flags & this.UNVERIFIED) === this.UNVERIFIED;
        const fDeleted = options.flags === undefined ? true : (options.flags & this.DELETED) === this.DELETED;
        return this.works([
            [w => this.queryData(queue, {title, jenis: 'Sudah Diverifikasi'}), w => fVerified],
            [w => this.queryData(queue, {title, jenis: 'Belum Diverifikasi'}), w => fUnverified && !w.getRes(0)],
            [w => this.queryData(queue, {title, jenis: 'Dihapus'}), w => fDeleted && !w.getRes(0) && !w.getRes(1)],
        ]);
    }

    checkSpp(queue) {
        return this.works([
            [w => this.sipd.navigate('Pengeluaran', 'SPP', 'Pembuatan', 'LS')],
            [w => this.querySpp(queue)],
            [w => this.sipd.waitAndClick(By.xpath('//button/span/p[text()="Tambah SPP LS"]/../..')), w => !w.getRes(1)],
            [w => this.sipd.waitAndClick(By.xpath('//a/span/p[text()="SPP LS (Barang & Jasa)"]/../..')), w => !w.getRes(1)],
            [w => Promise.resolve(this.spp = {}), w => !w.getRes(1)],
            [w => this.fillForm(queue, 'spp',
                By.xpath('//h1[text()="Surat Permintaan Pembayaran Langsung (SPP-LS)"]/../../../../..'),
                By.xpath('//button/span/span[text()="Konfirmasi"]/../..')), w => !w.getRes(1)],
            [w => this.sipd.waitAndClick(By.xpath('//button[text()="Tambah Sekarang"]')), w => !w.getRes(1)],
            [w => this.sipd.waitLoader(), w => !w.getRes(1)],
            [w => this.querySpp(queue, {flags: this.UNVERIFIED}), w => !w.getRes(1)],
            [w => Promise.reject(new SipdAnnouncedError(`SPP ${queue.getMappedData('info.nama')} dihapus, diabaikan!`)), w => w.getRes(1) && queue.STATUS === 'Dihapus'],
        ]);
    }

    checkVerifikasiSpp(queue, status = 'Belum Diverifikasi') {
        const title = 'Surat Permintaan Pembayaran (SPP) | Verifikasi';
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.sipd.navigate('Pengeluaran', 'SPP', 'Verifikasi')],
            [w => this.querySpp(queue, {title, flags: this.VERIFIED | this.UNVERIFIED})],
            [w => w.getRes(2).findElement(By.xpath('./td[9]/div/button')), w => w.getRes(2) && queue.STATUS === status],
            [w => w.getRes(3).click(), w => w.getRes(2) && queue.STATUS === status],
            [w => w.getRes(3).findElement(By.xpath('../div/div/button/span/p[text()="Verifikasi"]/../..')), w => w.getRes(2) && queue.STATUS === status],
            [w => w.getRes(5).click(), w => w.getRes(2) && queue.STATUS === status],
            [w => this.fillForm(queue, 'verifikasi-spp',
                By.xpath('//header[text()="Verifikasi (SPP)"]/../div[contains(@class,"chakra-modal__body")]'),
                By.xpath('//button[text()="Setujui Sekarang"]')), w => w.getRes(2) && queue.STATUS === status],
            [w => this.dismissModal('Verifikasi SPP Berhasil'), w => w.getRes(2) && queue.STATUS === status],
            [w => this.querySpp(queue, {title, flags: this.VERIFIED}), w => w.getRes(2) && queue.STATUS === status],
        ]);
    }

    querySpm(queue, options) {
        options = options || {};
        const title = options.title || 'Pengeluaran';
        const columns = options.columns || {
            noSpp: [1, this.COL_TIPPY],
            tglSpp: 3,
            untukSpp: [6, this.COL_SINGLE, true],
            nomSpp: 7,
            statusSpp: {index: 4, type: this.COL_STATUS, selector: '*/*/p'},
        }
        const fVerified = options.flags === undefined ? true : (options.flags & this.VERIFIED) === this.VERIFIED;
        const fUnverified = options.flags === undefined ? true : (options.flags & this.UNVERIFIED) === this.UNVERIFIED;
        return this.works([
            [w => this.queryData(queue, {title, columns, jenis: 'Sudah Diverifikasi', nomor: 'SPM'}), w => fVerified],
            [w => this.queryData(queue, {title, columns, jenis: 'Belum Diverifikasi', nomor: 'SPM'}), w => fUnverified && !w.getRes(0)],
        ]);
    }

    checkVerifikasiSpm(queue, status = 'Belum Disetujui') {
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.sipd.navigate('Pengeluaran', 'SPM', 'Pembuatan')],
            [w => this.sipd.waitLoader()],
            [w => this.sipd.waitAndClick(By.xpath('//button/p[text()="LS"]/..'))],
            [w => this.sipd.waitSpinner(w.getRes(3))],
            [w => this.querySpm(queue)],
            [w => w.getRes(5).findElement(By.xpath('./td[9]/div/button')), w => w.getRes(5) && queue.STATUS === status],
            [w => w.getRes(6).click(), w => w.getRes(5) && queue.STATUS === status],
            [w => w.getRes(6).findElement(By.xpath('../div/div/button/span/p[text()="Persetujuan"]/../..')), w => w.getRes(5) && queue.STATUS === status],
            [w => w.getRes(8).click(), w => w.getRes(5) && queue.STATUS === status],
            [w => this.sipd.waitAndClick(By.xpath('//header[text()="Persetujuan SPM"]/../footer/button[text()="Setujui Sekarang"]')), w => w.getRes(5) && queue.STATUS === status],
            [w => this.sipd.waitLoader(), w => w.getRes(5) && queue.STATUS === status],
            [w => this.querySpm(queue, this.VERIFIED), w => w.getRes(5) && queue.STATUS === status],
        ]);
    }
}

module.exports = SipdSppSession;