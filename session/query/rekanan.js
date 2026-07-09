/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025-2026 Toha <tohenk@yahoo.com>
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

const { SipdVoter } = require('.');
const { SipdColumnQuery } = require('../../sipd/query');
const SipdUtil = require('../../sipd/util');

/**
 * Handles partner selection.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoterRekanan extends SipdVoter {

    doInitialize() {
        const queue = this.data.queue ?? this.data;
        this.options.title = 'Daftar Rekanan';
        this.options.jenis = queue.getMappedData('info.jenis');
        this.diffs = [];
        const rekanan = Array.isArray(this.data.value) ? this.data.value[0] : this.data.value;
        const nik = Array.isArray(this.data.value) ? this.data.value[1] : null;
        if (this.usaha) {
            const fRekanan = () => SipdUtil.escapeTerm(rekanan, true);
            this.filter = [fRekanan];
            this.placeholder = 'perusahaan';
            this.diffs.push(['usaha', rekanan]);
            if (nik) {
                this.filter = [[fRekanan, nik]];
                this.placeholder = [this.placeholder, 'nik'];
            }
        } else {
            this.filter = [nik];
            this.placeholder = 'nik';
        }
        if (nik) {
            this.diffs.push(['nik', nik]);
        }
        this.diffs.push(['nama', null, false]);
        this.pageOptions = {
            selector: '//h1[contains(@class,"card-title")]/h1[text()="%TITLE%"]/../../../..',
            filter: this.getFilterSelector(),
        }
        this.defaultColumns = {
            nama: {selector: './td[1]/div/div/div[2]/span[1]'},
            nik: {selector: './td[1]/div/div/div[2]/span[2]'},
            usaha: {selector: './td[2]/div/div/div[2]/span[1]'},
            action: {type: SipdColumnQuery.COL_ACTION, selector: './/button'},
        }
    }

    get jenis() {
        return this.options.jenis ?? SipdVoterRekanan.REKANAN_USAHA;
    }

    get usaha() {
        return this.jenis === SipdVoterRekanan.REKANAN_USAHA;
    }

    static get REKANAN_USAHA() { return 'usaha' }
    static get REKANAN_PNS() { return 'pns' }
    static get REKANAN_ORANG() { return 'orang' }
}

/**
 * Handles partner data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryRekanan extends SipdVoterRekanan {

    doPreInitialize() {
        this.actionEnabled = false;
        this.dialog = false;
        this.data.value = [
            SipdUtil.getSafeStr(this.data.getMappedData('info.rekanan')),
            this.data.getMappedData('info.nik'),
        ];
    }

    doPostInitialize() {
        this.defaultColumns.action.selector = './td[4]/a';
        this.defaultColumns.url = {type: SipdColumnQuery.COL_ACTION_URL, selector: './td[4]/a'};
    }
}

module.exports = { SipdVoterRekanan, SipdQueryRekanan };