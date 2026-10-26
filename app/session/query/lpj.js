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
 * Handles LPJ data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryLpj extends SipdQueryBase {

    doSetup() {
        this.id = 'LPJ';
        this.title = 'Laporan Pertanggung Jawaban';
        this.navigates = ['Pengeluaran', 'LPJ', 'UP / GU', 'Pembuatan'];
    }

    doInitialize() {
        this.group = this.options.jenis;
        const tgl = [
            SipdUtil.getDate(this.data.getDataValue('LPJ_START')),
            SipdUtil.getDate(this.data.getDataValue('LPJ_END'))
        ];
        this.diffs = [
            ['tgl', tgl, SipdUtil.isDateInRange.bind(SipdUtil)],
        ];
        this.onResult = () => {
            this.data[`${this.id}`] = this.data.values.no;
            this.data[`${this.id}_TGL`] = this.data.values.tgl;
            this.data[`${this.id}_NOM`] = this.data.values.nom;
        }
    }
}

module.exports = { SipdQueryLpj };
