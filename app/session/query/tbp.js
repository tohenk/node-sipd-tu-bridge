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

const { SipdQueryBase } = require('.');
const { SipdColumnQuery } = require('../../sipd/query');
const SipdUtil = require('../../sipd/util');

/**
 * Handles TBP data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryTbp extends SipdQueryBase {

    doInitialize() {
        this.options.title = 'Tanda Bukti Pembayaran';
        this.defaultColumns = {
            no: 1,
            tgl: 2,
            untuk: [3, SipdColumnQuery.COL_SINGLE, true],
            nom: 6,
            url: {type: SipdColumnQuery.COL_ACTION_URL, selector: './/a/span/p[text()="Cetak"]/../..'},
        }
        const nomor = SipdQueryTbp.TBP;
        const no = this.data.getMappedData('info.tbp');
        const tgl = SipdUtil.getDate(this.data.getMappedData('npd.npd:TGL'));
        const nominal = this.data.getMappedData('npd.npd:NOMINAL');
        const untuk = SipdUtil.getSafeStr(this.data.getMappedData('npd.npd:UNTUK'));
        if (no) {
            this.placeholder = 'nomor dokumen';
            this.filter = [no];
        } else {
            this.placeholder = 'tujuan pembayaran';
            this.filter = [() => SipdUtil.escapeTerm(untuk, true)];
        }
        this.diffs = [
            ['tgl', tgl],
            ['untuk', untuk],
            ['nom', nominal],
        ];
        this.pageOptions = {filter: this.getFilterSelector()};
        this.onResult = () => {
            this.data[`${nomor}`] = this.data.values.no;
            this.data[`${nomor}_TGL`] = this.data.values.tgl;
            this.data[`${nomor}_UNTUK`] = this.data.values.untuk;
            this.data[`${nomor}_NOM`] = this.data.values.nom;
        }
    }

    static get TBP() { return 'TBP' }
}

module.exports = { SipdQueryTbp };
