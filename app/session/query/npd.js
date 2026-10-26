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

const { SipdQueryBase, SipdVoter } = require('.');
const SipdUtil = require('../../sipd/util');

/**
 * Handles NPD selection.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoterNpd extends SipdVoter {

    doSetup() {
        this.id = 'NPD-VOTER';
        this.title = 'Nota Pencairan Dana';
        this.pageTitle = 'Pengajuan | Nota Pencairan Dana';
    }

    doInitialize() {
        if (this.placeholder === undefined) {
            this.placeholder = 'no';
        }
        this.pageOptions = {filter: this.getFilterSelector()};
        const queue = this.data.queue ?? this.data;
        this.filter = [queue[this.data.value]];
        this.diffs = [
            ['no', queue[this.data.value]],
        ];
    }

    doPageInitialize() {
        if (this.dialog) {
            this.pageOptions.selector = '//h1[text()="%TITLE%"]/../../..';
        }
    }
}

/**
 * Handles NPD data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryNpd extends SipdVoterNpd {

    doPostSetup() {
        this.id = 'NPD';
        this.navigates = ['Pengeluaran', 'Pengajuan', 'NPD'];
    }

    doPreInitialize() {
        this.mode = SipdQueryBase.MATCH;
        this.dialog = false;
        if (!this.data[this.id]) {
            this.placeholder = 'untuk';
        }
    }

    doPostInitialize() {
        const no = this.data[this.id];
        if (no) {
            this.filter = [no];
            this.diffs = [
                ['no', no]
            ];
        } else {
            const tgl = SipdUtil.getDate(this.data.getMappedData('npd.npd:TGL'));
            const nominal = this.data.getMappedData('npd.npd:NOMINAL');
            const untuk = SipdUtil.getSafeStr(this.data.getMappedData('npd.npd:UNTUK'));
            this.filter = [() => SipdUtil.escapeTerm(untuk, true)];
            this.diffs = [
                ['tgl', tgl],
                ['untuk', untuk],
                ['nom', nominal],
            ];
        }
        this.onResult = () => {
            this.data[`${this.id}`] = this.data.values.no;
            this.data[`${this.id}_TGL`] = this.data.values.tgl;
            this.data[`${this.id}_UNTUK`] = this.data.values.untuk;
            this.data[`${this.id}_NOM`] = this.data.values.nom;
        }
    }
}

module.exports = { SipdVoterNpd, SipdQueryNpd };