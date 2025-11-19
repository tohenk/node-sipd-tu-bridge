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
        this.doPagerInitialize();
        this.doCreatePager();
    }

    doInitialize() {
    }

    doPreInitialize() {
    }

    doPostInitialize() {
    }

    doPagerInitialize() {
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

    getFilterSelector(placeholder = null) {
        let input;
        placeholder = placeholder ?? this.placeholder;
        if (Array.isArray(placeholder)) {
            input = placeholder.map(placeholder => By.xpath(`//*[contains(@placeholder,"Cari ${placeholder}")]`));
        } else {
            input = By.xpath(`//*[contains(@placeholder,"Cari ${placeholder}")]`);
        }
        return {
            input,
            submit: By.xpath('//button[text()="Cari Sekarang"]'),
            toggler: By.xpath('//button/div/p[text()="Filter Pencarian"]/../..'),
        }
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
        if (col.name.includes('nama')) {
            return 'nama';
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
        this.dialog = true;
    }

    getPagerOptions() {
        return {
            ...(this.dialog ? {
                selector: '//header[text()="%TITLE%"]/../div[contains(@class,"chakra-modal__body")]',
                tableSelector: './/table/..',
            } : {}),
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
        this.placeholder = 'nip';
        this.pagerOptions = {search: this.getFilterSelector()};
        this.defaultColumns = {
            nama: {selector: './td[1]/div/span/div/span[1]'},
            nip: {selector: './td[1]/div/span/div/span[2]'},
            action: {type: SipdColumnQuery.COL_ACTION, selector: './/button'},
        }
        this.search = [this.data.value];
        this.diffs = [
            ['nip', this.data.value],
            ['nama', null, false],
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
        this.search = [this.data.value];
        this.placeholder = this.usaha ? 'perusahaan' : 'nama rekanan';
        if (Array.isArray(this.data.value)) {
            this.placeholder = [this.placeholder, 'nik'];
        }
        this.pagerOptions = {
            selector: '//h1[contains(@class,"card-title")]/h1[text()="%TITLE%"]/../../../..',
            search: this.getFilterSelector(),
        }
        this.defaultColumns = {
            nama: {selector: './td[1]/div/div/div[2]/span[1]'},
            nik: {selector: './td[1]/div/div/div[2]/span[2]'},
            usaha: {selector: './td[2]/div/div/div[2]/span[1]'},
            action: {type: SipdColumnQuery.COL_ACTION, selector: './/button'},
        }
        const rekanan = Array.isArray(this.data.value) ? this.data.value[0] : this.data.value;
        const nik = Array.isArray(this.data.value) ? this.data.value[1] : null;
        this.diffs = [
            [this.usaha ? 'usaha' : 'nama', rekanan],
            nik ? ['nik', nik] : null,
            this.usaha ? ['nama', null, false] : null,
        ].filter(Boolean);
    }

    get jenis() {
        return this.options.jenis ?? this.constructor.REKANAN_USAHA;
    }

    get usaha() {
        return this.jenis === this.constructor.REKANAN_USAHA;
    }

    static get REKANAN_USAHA() { return 'usaha' }
    static get REKANAN_PNS() { return 'pns' }
    static get REKANAN_ORANG() { return 'orang' }
}

/**
 * Handles NPD selection.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoterNpd extends SipdVoter {

    doInitialize() {
        this.options.title = 'Pengajuan | Nota Pencairan Dana';
        if (this.placeholder === undefined) {
            this.placeholder = 'nomor dokumen';
        }
        this.pagerOptions = {search: this.getFilterSelector()};
        this.defaultColumns = {
            no: 1,
            tgl: [1, SipdColumnQuery.COL_ICON2],
            untuk: [2, SipdColumnQuery.COL_SINGLE, true],
            nom: 5,
            status: [4, SipdColumnQuery.COL_PROGRESS],
            action: {type: SipdColumnQuery.COL_ACTION, selector: './/button'},
        }
        const data = this.data.queue ?? this.data;
        this.search = [data[this.data.value]];
        this.diffs = [
            ['no', data[this.data.value]],
        ];
    }

    doPagerInitialize() {
        if (this.dialog) {
            this.pagerOptions.selector = '//h1[text()="%TITLE%"]/../../..';
        }
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
        this.dialog = false;
        this.options.jenis = this.data.getMappedData('info.jenis');
        this.data.value = [
            SipdUtil.getSafeStr(this.data.getMappedData(this.usaha ? 'info.usaha' : 'info.rekanan')),
            this.data.getMappedData('info.nik'),
        ];
    }

    doPostInitialize() {
        this.defaultColumns.action.selector = './td[4]/a';
    }
}


/**
 * Handles NPD data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryNpd extends SipdVoterNpd {

    doPreInitialize() {
        this.actionEnabled = false;
        this.dialog = false;
        const nomor = this.constructor.NPD;
        if (!this.data[nomor]) {
            this.placeholder = 'tujuan pembayaran';
        }
    }

    doPostInitialize() {
        this.dialog = false;
        this.defaultColumns.action = [10, SipdColumnQuery.COL_ACTION];
        const nomor = this.constructor.NPD;
        const no = this.data[nomor];
        if (no) {
            this.search = [no];
            this.diffs = [
                ['no', no]
            ];
        } else {
            const tgl = SipdUtil.getDate(this.data.getMappedData('npd.npd:TGL'));
            const nominal = this.data.getMappedData('npd.npd:NOMINAL');
            const untuk = SipdUtil.getSafeStr(this.data.getMappedData('npd.npd:UNTUK'));
            this.search = [untuk];
            this.diffs = [
                ['tgl', tgl],
                ['untuk', untuk],
                ['nom', nominal],
            ];
        }
        this.onResult = () => {
            this.data[`${nomor}`] = this.data.values.no;
            this.data[`${nomor}_TGL`] = this.data.values.tgl;
            this.data[`${nomor}_UNTUK`] = this.data.values.untuk;
            this.data[`${nomor}_NOM`] = this.data.values.nom;
        }
    }

    static get NPD() { return 'NPD' }
}

/**
 * Handles TBP data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryTbp extends SipdQueryBase {

    doInitialize() {
        this.options.title = 'Tanda Bukti Pembayaran';
        this.placeholder = 'tujuan pembayaran';
        this.pagerOptions = {search: this.getFilterSelector()};
        this.defaultColumns = {
            no: 1,
            tgl: 2,
            untuk: [3, SipdColumnQuery.COL_SINGLE, true],
            nom: 6,
        }
        const nomor = this.constructor.TBP;
        const tgl = SipdUtil.getDate(this.data.getMappedData('npd.npd:TGL'));
        const nominal = this.data.getMappedData('npd.npd:NOMINAL');
        const untuk = SipdUtil.getSafeStr(this.data.getMappedData('npd.npd:UNTUK'));
        this.search = [untuk];
        this.diffs= [
            ['tgl', tgl],
            ['untuk', untuk],
            ['nom', nominal],
        ];
        this.onResult = () => {
            this.data[`${nomor}`] = this.data.values.no;
            this.data[`${nomor}_TGL`] = this.data.values.tgl;
            this.data[`${nomor}_UNTUK`] = this.data.values.untuk;
            this.data[`${nomor}_NOM`] = this.data.values.nom;
        }
    }

    static get TBP() { return 'TBP' }
}

/**
 * Handles SPP data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQuerySpp extends SipdQueryBase {

    doInitialize() {
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
            this.placeholder = 'nomor';
            this.search.push(no);
            this.diffs.push(['no', no]);
        } else {
            if (nomor !== this.constructor.SPP) {
                tgl = this.data.SPP_TGL;
                nominal = this.data.SPP_NOM;
                untuk = this.data.SPP_UNTUK;
            } else {
                tgl = SipdUtil.getDate(this.data.getMappedData('spp.spp:TGL'));
                nominal = this.data.getMappedData('spp.spp:NOMINAL');
                untuk = this.data.getMappedData('spp.spp:UNTUK');
            }
            this.placeholder = 'keterangan';
            this.search.push(untuk);
            if (!this.options.skipDate) {
                this.diffs.push(['tgl', tgl]);
            }
            this.diffs.push(
                ['untuk', SipdUtil.getSafeStr(untuk)],
                ['nom', nominal],
            );
        }
        this.pagerOptions = {search: this.getFilterSelector()};
        this.onResult = () => {
            this.data[`${nomor}`] = this.data.values.no;
            this.data[`${nomor}_TGL`] = this.data.values.tgl;
            this.data[`${nomor}_UNTUK`] = this.data.values.untuk;
            this.data[`${nomor}_NOM`] = this.data.values.nom;
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
    SipdVoterNpd,
    SipdQueryRekanan,
    SipdQueryNpd,
    SipdQueryTbp,
    SipdQuerySpp,
}
