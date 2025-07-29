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

const SipdPage = require('../../sipd/page');
const SipdUtil = require('../../sipd/util');
const { SipdQuery, SipdColumnQuery } = require('../../sipd/query');
const { By } = require('selenium-webdriver');

/**
 * Provides initialization mechanism for data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryBase extends SipdQuery {

    initialize() {
        this.actionEnabled = false;
        this.doPreInitialize();
        this.doInitialize();
        this.doPostInitialize();
        this.doCreatePager();
    }

    doInitialize() {
    }

    doPreInitialize() {
    }

    doPostInitialize() {
    }

    doCreatePager() {
        this.page = new SipdPage(this.parent, {
            title: this.options.title,
            ...this.getPagerOptions(),
        });
    }

    getPagerOptions() {
        return this.pagerOptions || {};
    }

    isActionEnabled() {
        return this.actionEnabled;
    }

    /**
     * Get column normalizer function.
     *
     * @param {SipdColumnQuery} col The column
     * @returns {string}
     */
    getNormalizer(col) {
        if (col.name.includes('tgl')) {
            return 'tgl';
        }
        if (col.name.includes('nom')) {
            return 'nom';
        }
        if (col.name.includes('nik')) {
            return 'nr';
        }
        return 'default';
    }

    /**
     * Get column stringable function.
     *
     * @param {SipdColumnQuery} col The column
     * @returns {string}
     */
    getStringable(col) {
        if (col.name.includes('tgl')) {
            return 'tgl';
        }
        if (col.name.includes('nom')) {
            return 'nom';
        }
        return 'default';
    }
}

/**
 * Provides a voter mechanism of data paging in modal dialog.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoter extends SipdQueryBase {

    doPreInitialize() {
        this.actionEnabled = true;
    }

    getPagerOptions() {
        return {
            selector: '//header[text()="%TITLE%"]/../div[contains(@class,"chakra-modal__body")]',
            tableSelector: './/table/..',
            pageSelector: 'li/a[text()="%PAGE%"]',
            ...(this.pagerOptions || {}),
        }
    }
}

/**
 * Handles employee selection.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoterPegawai extends SipdVoter {

    doInitialize() {
        this.options.title = 'Pilih Pegawai';
        this.defaultColumns = {
            nama: {selector: './td[1]/div/span/div/span[1]'},
            action: {type: SipdColumnQuery.COL_ACTION, selector: './/button'},
        }
        this.diffs = [
            ['nama', this.data.value],
        ];
    }
}

/**
 * Handles partner selection.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoterRekanan extends SipdVoter {

    doInitialize() {
        this.options.title = 'Daftar Rekanan';
        this.pagerOptions = {
            selector: '//h1[contains(@class,"card-title")]/h1[text()="%TITLE%"]/../../../..',
            search: {
                input: By.xpath(`//input[contains(@placeholder,"Cari perusahaan")]`),
                submit: By.xpath('//button[text()="Cari Sekarang"]'),
                toggler: By.xpath('//button/div/p[text()="Filter Pencarian"]/../..'),
            }
        }
        this.defaultColumns = {
            nama: {selector: './td[2]/div/div/div[2]/span[1]'},
            nik: {selector: './td[1]/div/div/div[2]/span[2]'},
            action: {type: SipdColumnQuery.COL_ACTION, selector: './/button'},
        }
        const rekanan = Array.isArray(this.data.value) ? this.data.value[0] : this.data.value;
        const nik = Array.isArray(this.data.value) ? this.data.value[1] : null;
        this.search = [rekanan];
        this.diffs = [
            ['nama', rekanan],
            nik ? ['nik', nik] : null,
        ].filter(Boolean);
    }
}

/**
 * Handles partner data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryRekanan extends SipdVoterRekanan {

    doPreInitialize() {
        this.actionEnabled = false;
        this.data.value = [
            SipdUtil.getSafeStr(this.data.getMappedData('info.rekanan')),
            this.data.getMappedData('info.nik'),
        ];
    }

    doPostInitialize() {
        this.defaultColumns.action.selector = './td[4]/a';
    }
}

/**
 * Handles SPP data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQuerySpp extends SipdQueryBase {

    doInitialize() {
        this.pagerOptions = {
            search: {
                filter: By.xpath('//div[@class="container-form-filter-table"]/*/*/*/*[1]/div/button'),
                input: By.xpath('//div[@class="container-form-filter-table"]/*/*/*/*[2]/div/input'),
                submit: By.xpath('//div[@class="container-form-filter-table"]/*/*/*/*[3]/div/div'),
            }
        }
        const nomor = this.options.nomor || this.constructor.SPP;
        this.defaultColumns = this.constructor.getColumns(nomor);
        this.search = [];
        this.diffs = [];
        this.group = this.options.jenis;
        let no, tgl, nominal, untuk;
        if (nomor === this.constructor.SPP) {
            no = this.data.getMappedData('info.check');
        }
        if (no) {
            this.search.push(no, 'Nomor');
            this.diffs.push(['no', no]);
        } else {
            if (nomor !== this.constructor.SPP) {
                tgl = this.data.SPP_TGL;
                nominal = this.data.SPP_NOM;
                untuk = this.data.SPP_UNTUK;
            } else {
                tgl = SipdUtil.getDate(this.data.getMappedData('spp.spp:TGL'));
                nominal = this.data.getMappedData('spp.spp:NOMINAL');
                untuk = SipdUtil.getSafeStr(this.data.getMappedData('spp.spp:UNTUK'));
            }
            this.search.push(untuk, 'Keterangan');
            if (!this.options.skipDate) {
                this.diffs.push(['tgl', tgl]);
            }
            this.diffs.push(
                ['untuk', untuk],
                ['nom', nominal],
            );
        }
        this.onResult = () => {
            this.data[`${nomor}`] = this.data.values.no;
            this.data[`${nomor}_TGL`] = this.data.values.tgl;
            this.data[`${nomor}_UNTUK`] = this.data.values.untuk;
            this.data[`${nomor}_NOM`] = this.data.values.nom;
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
                action: [7, SipdColumnQuery.COL_ACTION],
            },
            [this.SPM]: {
                no: [1, SipdColumnQuery.COL_TIPPY],
                tgl: 3,
                untuk: [6, SipdColumnQuery.COL_SINGLE, true],
                nom: 7,
                status: {index: 4, type: SipdColumnQuery.COL_STATUS, selector: '*/*/p'},
                action: [9, SipdColumnQuery.COL_ACTION],
            },
            [this.SP2D]: {
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

module.exports = {
    SipdQueryBase,
    SipdVoterPegawai,
    SipdVoterRekanan,
    SipdQueryRekanan,
    SipdQuerySpp,
}
