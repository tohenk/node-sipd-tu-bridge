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

const dtag = 'spp';

class SipdSppSession extends SipdSession {

    VERIFIED = 1
    UNVERIFIED = 2
    TRANSFERED = 4

    COL_ICON = 1
    COL_STATUS = 2
    COL_SINGLE = 3
    COL_TIPPY = 4
    COL_TWOLINE2 = 5

    queueAllowChange(queue) {
        return !queue.readonly;
    }

    createRekanan(queue, forceEdit = false) {
        let clicker;
        const lembaga = this.getSafeStr(queue.getMappedData('info.nama'));
        const nik = queue.getMappedData('info.nik');
        const alt = lembaga.indexOf('\'') >= 0;
        const page = this.createPage(alt ? this.PAGE_REKANAN_ALT : this.PAGE_REKANAN, 'Daftar Rekanan');
        const allowChange = this.queueAllowChange(queue);
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
                    if (values.join('|').toLowerCase() === [lembaga, nik].join('|').toLowerCase()) {
                        clicker = x.getRes(1);
                        reject(SipdPage.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [w => this.sipd.waitAndClick(By.xpath('//button[text()="Tambah Rekanan"]')), w => !clicker && allowChange],
            [w => clicker.click(), w => clicker && forceEdit && allowChange],
            [w => this.fillForm(queue, 'rekanan',
                By.xpath('//h1/h1[text()="Tambah Rekanan"]/../../../..'),
                By.xpath('//button[text()="Konfirmasi"]')), w => (!clicker || forceEdit) && allowChange],
            [w => this.submitForm(By.xpath('//section/footer/button[1]'), {spinner: true}), w => (!clicker || forceEdit) && allowChange],
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
            ...(options.columns || {}),
        }
        const tippies = {};
        for (const k in columns) {
            const v = columns[k];
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
            [w => this.sipd.waitSpinner(w.getRes(2), this.sipd.SPINNER_CHAKRA)],
            [w => page.search(untuk, 'Keterangan')],
            [w => page.each({filtered: true}, el => [
                [x => this.sipd.getText(tvalues, el)],
                [x => this.getTippyText(tippies, el), x => Object.keys(tippies).length],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0);
                    const tippyValues = Object.keys(tippies).length ? x.getRes(1) : {};
                    // convert dates
                    for (const k of Object.keys(values)) {
                        if (k.includes('tgl') && values[k] && !values[k] instanceof Date) {
                            values[k] = this.getDate(values[k]);
                        }
                    }
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
                    const args = [];
                    if (!options.skipDate) {
                        args.push([this.dateSerial(tglSpp), this.dateSerial(tgl)]);
                    }
                    args.push(
                        [this.fmtCurr(nomSpp), this.fmtCurr(nominal)],
                        [this.getSafeStr(untukSpp), untuk]
                    );
                    const states = f(...args);
                    this.debug(dtag)(statusSpp, ...states.info);
                    if (states.okay) {
                        result = el;
                        queue[nomor] = noSpp;
                        queue[nomor + '_TGL'] = tglSpp;
                        queue.STATUS = statusSpp;
                        queue.values = {...values, ...tippyValues};
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
        const title = options.title || 'Surat Permintaan Pembayaran (SPP) | LS';
        const fVerified = options.flags === undefined ? true : (options.flags & this.VERIFIED) === this.VERIFIED;
        const fUnverified = options.flags === undefined ? true : (options.flags & this.UNVERIFIED) === this.UNVERIFIED;
        return this.works([
            [w => this.queryData(queue, {title, jenis: 'Sudah Diverifikasi'}), w => fVerified],
            [w => this.queryData(queue, {title, jenis: 'Belum Diverifikasi'}), w => fUnverified && !w.getRes(0)],
        ]);
    }

    checkSpp(queue, options = null) {
        return this.works([
            [w => this.sipd.navigate('Pengeluaran', 'SPP', 'LS')],
            [w => this.querySpp(queue, options)],
            [w => Promise.reject(new SipdAnnouncedError(`SPP ${queue.getMappedData('info.nama')} dihapus, diabaikan!`)), w => w.getRes(1) && queue.STATUS === 'Dihapus'],
        ]);
    }

    createSpp(queue) {
        const allowChange = this.queueAllowChange(queue);
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
        const allowChange = this.queueAllowChange(queue);
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

    checkSpm(queue) {
        return this.works([
            [w => this.sipd.navigate('Pengeluaran', 'SPM', 'Pembuatan')],
            [w => this.sipd.waitLoader()],
            [w => this.sipd.waitAndClick(By.xpath('//button/p[text()="LS"]/..'))],
            [w => this.querySpm(queue)],
        ]);
    }

    verifikasiSpm(queue, status = 'Belum Disetujui') {
        const allowChange = this.queueAllowChange(queue);
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.checkSpm(queue)],
            [w => w.getRes(1).findElement(By.xpath('./td[9]/div/button')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(2).click(), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(2).findElement(By.xpath('../div/div/button/span/p[text()="Persetujuan"]/../..')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => w.getRes(4).click(), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//header[contains(text(),"Persetujuan SPM")]/../footer/button[text()="Setujui Sekarang"]')), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.sipd.waitSpinner(w.getRes(6)), w => w.getRes(1) && queue.STATUS === status && allowChange],
            [w => this.querySpm(queue, this.VERIFIED), w => w.getRes(1) && queue.STATUS === status && allowChange],
        ]);
    }

    querySp2d(queue, options) {
        options = options || {};
        const title = options.title || 'Surat Perintah Pencairan Dana | Pencairan';
        const columns = options.columns || {
            noSpp: [1, this.COL_TIPPY],
            tglSpp: 3,
            untukSpp: [9, this.COL_SINGLE, true],
            nomSpp: 10,
            tglCair: 7,
            statusSpp: {index: 6, type: this.COL_STATUS, selector: '*/*/p'},
        }
        const fTransfered = options.flags === undefined ? true : (options.flags & this.TRANSFERED) === this.TRANSFERED;
        return this.works([
            [w => this.queryData(queue, {title, columns, jenis: 'Sudah Ditransfer', nomor: 'SP2D', skipDate: true}), w => fTransfered],
            [w => new Promise((resolve, reject) => {
                const res = w.getRes(0);
                if (queue.values && queue.values.tglCair) {
                    queue.CAIR = this.getDate(queue.values.tglCair);
                }
                resolve(res);
            }), w => w.getRes(0)],
        ]);
    }

    checkSp2d(queue) {
        return this.works([
            [w => this.sipd.navigate('Pengeluaran', 'SP2D', 'Pencairan')],
            [w => this.querySp2d(queue)],
        ]);
    }
}

module.exports = SipdSppSession;