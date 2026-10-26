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
const SipdUtil = require('../../sipd/util');

/**
 * Handles SPP data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQuerySpp extends SipdQueryBase {

    doSetup() {
        this.id = SipdQuerySpp.SPP;
        this.title = 'Surat Permintaan Pembayaran';
        this.pageTitle = 'Surat Permintaan Pembayaran (SPP) | LS';
        this.navigates = ['Pengeluaran', 'SPP', 'LS'];
    }

    doInitialize() {
        this.filter = [];
        this.diffs = [];
        this.group = this.options.jenis;
        const query = this.data.getMappedData('info.check');
        let no, tgl, nominal, untuk, type = SipdUtil.pickNrLs(query);
        if (type === this.id) {
            no = query;
        }
        if (no) {
            this.placeholder = 'no';
            this.filter.push(no);
            this.diffs.push(['no', no]);
        } else {
            if (this.id !== SipdQuerySpp.SPP) {
                tgl = this.data.SPP_TGL;
                nominal = this.data.SPP_NOM;
                untuk = this.data.SPP_UNTUK;
            } else {
                tgl = SipdUtil.getDate(this.data.getMappedData('spp.spp:TGL'));
                nominal = this.data.getMappedData('spp.spp:NOMINAL');
                untuk = this.data.getMappedData('spp.spp:UNTUK');
            }
            this.placeholder = 'untuk';
            this.filter.push(untuk);
            if (!this.options.skipDate) {
                this.diffs.push(['tgl', tgl]);
            }
            this.diffs.push(
                ['untuk', SipdUtil.getSafeStr(untuk)],
                ['nom', nominal],
            );
        }
        this.pageOptions = {filter: this.getFilterSelector()};
        this.onResult = () => {
            this.data[`${this.id}`] = this.data.values.no;
            this.data[`${this.id}_TGL`] = this.data.values.tgl;
            this.data[`${this.id}_UNTUK`] = this.data.values.untuk;
            this.data[`${this.id}_NOM`] = this.data.values.nom;
            if (this.data.values.ref && this.data.REF) {
                this.data.setValue('info.check', this.data.values.ref);
            }
        }
        // for SPP number query, column `untuk` must be retained as is
        if (no) {
            const col = this.columns.find(column => column.name === 'untuk');
            if (col) {
                delete col.normalizer;
            }
        }
    }

    static get SPP() { return 'SPP' }
    static get SPM() { return 'SPM' }
    static get SP2D() { return 'SP2D' }
}

module.exports = { SipdQuerySpp };