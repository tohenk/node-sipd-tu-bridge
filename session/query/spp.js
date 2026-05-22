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

const { SipdQueryBase } = require('.');
const { SipdColumnQuery } = require('../../sipd/query');
const SipdUtil = require('../../sipd/util');

/**
 * Handles SPP data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQuerySpp extends SipdQueryBase {

    doInitialize() {
        const nomor = this.options.nomor || SipdQuerySpp.SPP;
        this.defaultColumns = SipdQuerySpp.getColumns(nomor);
        this.filter = [];
        this.diffs = [];
        this.group = this.options.jenis;
        const query = this.data.getMappedData('info.check');
        let no, tgl, nominal, untuk, type = SipdUtil.pickNrLs(query);
        if (type == nomor) {
            no = query;
        }
        if (no) {
            this.placeholder = 'nomor';
            this.filter.push(no);
            this.diffs.push(['no', no]);
        } else {
            if (nomor !== SipdQuerySpp.SPP) {
                tgl = this.data.SPP_TGL;
                nominal = this.data.SPP_NOM;
                untuk = this.data.SPP_UNTUK;
            } else {
                tgl = SipdUtil.getDate(this.data.getMappedData('spp.spp:TGL'));
                nominal = this.data.getMappedData('spp.spp:NOMINAL');
                untuk = this.data.getMappedData('spp.spp:UNTUK');
            }
            this.placeholder = 'keterangan';
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
            this.data[`${nomor}`] = this.data.values.no;
            this.data[`${nomor}_TGL`] = this.data.values.tgl;
            this.data[`${nomor}_UNTUK`] = this.data.values.untuk;
            this.data[`${nomor}_NOM`] = this.data.values.nom;
            if (this.data.values.ref && this.data.REF) {
                this.data.setValue('info.check', this.data.values.ref);
            }
        }
        // for SPP number query, column `untuk` must retained as is
        if (no) {
            const col = this.columns.find(column => column.name === 'untuk');
            if (col) {
                delete col.normalizer;
            }
        }
    }

    static getColumns(type) {
        const columns = {
            [this.SPP]: {
                no: 1,
                tgl: 4,
                untuk: [5, SipdColumnQuery.COL_SINGLE, true],
                nom: 6,
                status: [2, SipdColumnQuery.COL_STATUS],
                action: [8, SipdColumnQuery.COL_ACTION],
            },
            [this.SPM]: {
                ref: [1, SipdColumnQuery.COL_ICON, true],
                no: [1, SipdColumnQuery.COL_TIPPY],
                tgl: 3,
                untuk: [6, SipdColumnQuery.COL_SINGLE, true],
                nom: 7,
                status: {index: 5, type: SipdColumnQuery.COL_STATUS, selector: '*/*/p'},
                action: [9, SipdColumnQuery.COL_ACTION],
            },
            [this.SP2D]: {
                ref: [1, SipdColumnQuery.COL_ICON, true],
                no: [1, SipdColumnQuery.COL_TIPPY],
                tgl: 3,
                untuk: [9, SipdColumnQuery.COL_SINGLE, true],
                nom: 10,
                tglCair: 7,
                status: {index: 6, type: SipdColumnQuery.COL_STATUS, selector: '*/*/p'},
            }
        }
        return columns[type];
    }

    static get SPP() { return 'SPP' }
    static get SPM() { return 'SPM' }
    static get SP2D() { return 'SP2D' }
}

module.exports = { SipdQuerySpp };