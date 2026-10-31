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

const Queue = require('@ntlab/work/queue');
const SipdPage = require('../../sipd/component/page');
const SipdUtil = require('../../sipd/util');
const { SipdRestartError, SipdStopError, SipdOperationError } = require('../../sipd/error');
const { SipdQuery, SipdQueryColumn } = require('../../sipd/query');
const { By, WebElement } = require('selenium-webdriver');
const _ = require('@ntlab/ntlib/translator');

const dtag = 'query';

/**
 * Provides initialization mechanism for data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryBase extends SipdQuery {

    setup() {
        /** @type {string} */
        this.id;
        /** @type {string} */
        this.title;
        /** @type {string} */
        this.pageTitle;
        this.mode = SipdQueryBase.MATCH;
        this.restartOnIterate = false;
        this.progressInitialValue = 'Baru';
        this.doPreSetup();
        this.doSetup();
        this.doPostSetup();
        this.doSetupColumns();
    }

    initialize() {
        this.doPreInitialize();
        this.doInitialize();
        this.doPostInitialize();
        this.doPageInitialize();
        this.doCreatePage();
        this.queryState = new SipdQueryState(this.columns, this.diffs);
    }

    doSetup() {
    }

    doPreSetup() {
    }

    doPostSetup() {
    }

    doSetupColumns() {
        if (SipdQueryBase.cmaps === undefined && this.parent?.options?.cmaps) {
            SipdQueryBase.cmaps = SipdColumnsMap.create(this.parent.options.cmaps);
        }
        if (SipdQueryBase.cmaps) {
            this.defaultColumns = SipdQueryBase.cmaps.get(this.id);
        }
    }

    doInitialize() {
    }

    doPreInitialize() {
    }

    doPostInitialize() {
    }

    doPageInitialize() {
    }

    doCreatePage() {
        this.page = new SipdPage(this.parent, {
            name: this.title || this.name,
            title: this.options.title || this.pageTitle || this.title,
            ...this.getPageOptions(),
        });
    }

    getPageOptions() {
        return this.pageOptions || {};
    }

    getFilterSelector(placeholder = null) {
        let input, label;
        /**
         * @param {string} name Column name
         * @returns {[string, string]}
         */
        const f = name => {
            let placeholder = name, title = name;
            const col = this.columns.find(a => a.name === name);
            if (col) {
                if (col.label) {
                    title = col.label;
                }
                if (col.placeholder) {
                    placeholder = col.placeholder;
                }
            }
            return [title, `//*[contains(@placeholder,"Cari ${placeholder}")]`];
        }
        placeholder = placeholder ?? this.placeholder;
        if (Array.isArray(placeholder)) {
            placeholder = placeholder.map(placeholder => f(placeholder));
            label = placeholder.map(a => a[0]);
            input = placeholder.map(a => a[1]);
        } else {
            [label, input] = f(placeholder);
        }
        return {
            input,
            submit: '//button[text()="Cari Sekarang"]',
            toggler: '//button/div/p[text()="Filter Pencarian"]/../..',
            label,
        }
    }

    /**
     * Get column normalizer function.
     *
     * @param {SipdQueryColumn} col The column
     * @returns {string}
     */
    getNormalizer(col) {
        if (col.name.includes('tgl')) {
            return 'tgl';
        }
        if (col.name.includes('nom')) {
            return 'nom';
        }
        if (col.name.includes('nik') || col.name.includes('keg')) {
            return 'nr';
        }
        if (col.name.includes('nama')) {
            return 'nama';
        }
        if (col.name.includes('ref')) {
            return 'ref';
        }
        return 'default';
    }

    /**
     * Get column stringable function.
     *
     * @param {SipdQueryColumn} col The column
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

    /**
     * Get tippy text content.
     *
     * @param {WebElement} el Tippy element
     * @returns {Promise<string>}
     */
    getTippy(el) {
        return this.parent.driver.executeScript(
            function(el) {
                if (el._tippy && el._tippy.popper) {
                    return el._tippy.popper.innerText;
                }
            }, el);
    }

    /**
     * Get progress value.
     *
     * @param {WebElement} el Progress element
     * @returns {Promise<string>}
     */
    getProgress(el, selector) {
        let res;
        return this.parent.works([
            [w => el.findElements(selector)],
            [w => new Promise((resolve, reject) => {
                const q = new Queue([...w.getRes(0).reverse()], p => {
                    if (!res) {
                        this.parent.works([
                            [x => p.getAttribute('innerHTML')],
                            [x => p.findElement(By.xpath('../*[@class="stepProgressBar__step__button__label"]'))],
                            [x => x.getRes(1).getAttribute('innerText')],
                            [x => Promise.resolve(res = x.getRes(2)), x => x.getRes(0)],
                        ])
                        .then(() => q.next())
                        .catch(err => reject(err));
                    } else {
                        q.next();
                    }
                });
                q.once('done', () => resolve(res ?? (w.getRes(0).length ? this.progressInitialValue : null)));
            })],
        ]);
    }

    /**
     * Get row data for data paging colums.
     *
     * @param {SipdQueryColumn[]} columns Columns data
     * @param {WebElement} el The Element
     * @returns {Promise<object>}
     */
    getRowData(columns, el) {
        return new Promise((resolve, reject) => {
            const res = {};
            const q = new Queue([...columns], col => {
                const works = [];
                switch (col.type) {
                    case SipdQueryColumn.COL_ACTION:
                        works.push(...[
                            [w => this.parent.findElement({el, data: col.xpath})],
                        ]);
                        break;
                    case SipdQueryColumn.COL_ACTION_URL:
                        works.push(...[
                            [w => this.parent.findElement({el, data: col.xpath})],
                            [w => w.res.getAttribute('href')],
                        ]);
                        break;
                    case SipdQueryColumn.COL_PROGRESS:
                        works.push(...[
                            [w => this.getProgress(el, col.xpath)],
                        ]);
                        break;
                    default:
                        const tippy = col.tippyXpath;
                        if (tippy) {
                            works.push(...[
                                [w => el.findElements(tippy)],
                                [w => this.getTippy(w.res[0]), w => w.res.length],
                            ]);
                        } else {
                            works.push(...[
                                [w => this.parent.getText([col.xpath], el)],
                                [w => Promise.resolve(w.res[0])],
                            ]);
                        }
                        break;
                }
                this.parent.works([
                    ...works,
                    [w => Promise.resolve(res[col.name] = typeof w.res === 'string' ? col.normalize(w.res) : w.res)],
                ])
                .then(() => q.next())
                .catch(err => reject(err));
            });
            q.once('done', () => resolve(res));
        });
    }

    /**
     * Evaluate if row values matches data sought.
     *
     * @param {object} values Row values
     * @returns {Promise<object|undefined>}
     */
    getRowState(values) {
        return new Promise((resolve, reject) => {
            const [state, rowstate, res] = this.queryState.check(values);
            if (res.status !== undefined) {
                this.parent.debug(dtag)(_('Row state: %rowstate% <%status%> %info%',
                    {rowstate, status: res.status, info: state.info.join(' ')}));
            } else {
                this.parent.debug(dtag)(_('Row state: %rowstate% %info%',
                    {rowstate, info: state.info.join(' ')}));
            }
            resolve(state.okay ? res : undefined);
        });
    }

    /**
     * Check for mode and optionally its sub mode.
     *
     * @param {number} mode Mode major to check
     * @param {*} submode Mode minor to check
     * @returns {boolean}
     */
    isMode(mode, submode = null) {
        if ((this.mode & mode) !== mode) {
            return false;
        }
        if (submode !== null && (this.mode & submode) !== submode) {
            return false;
        }
        return true;
    }

    /**
     * Perform row data match.
     *
     * @param {WebElement} el Row element
     * @param {object} values Row values
     * @param {object} result Match result
     * @returns {Promise<any>}
     */
    doMatch(el, values, result) {
        return new Promise((resolve, reject) => {
            this.getRowState(values)
                .then(res => {
                    if (res) {
                        Object.assign(result, res);
                        result.values = values;
                        result.retval = el;
                        if (this.isMode(SipdQueryBase.MATCH, SipdQueryBase.MATCH_ACTION) && result.actionCol) {
                            result.clicker = values[result.actionCol.name];
                        }
                        if (result.status !== undefined) {
                            this.data.STATUS = result.status;
                        }
                        this.data.values = values;
                        if (typeof this.onResult === 'function') {
                            this.onResult();
                        }
                        reject(new SipdStopError());
                    } else {
                        resolve();
                    }
                })
                .catch(err => reject(err));
        });
    }

    /**
     * Perform row data iteration.
     *
     * @param {WebElement} el Row element
     * @param {object} values Row values
     * @param {object} result Match result
     * @returns {Promise<any>}
     */
    doIterate(el, values, result) {
        return new Promise((resolve, reject) => {
            if (result.retval === undefined) {
                result.retval = [];
            }
            if (typeof this.onIterate === 'function') {
                this.onIterate(el, values, result)
                    .then(res => {
                        if (res) {
                            result.retval.push(res);
                        }
                        if (this.restartOnIterate) {
                            reject(new SipdRestartError());
                        } else {
                            resolve();
                        }
                    })
                    .catch(err => reject(err));
            } else {
                const actionCol = this.columns.find(column => column.type === SipdQueryColumn.COL_ACTION);
                if (actionCol) {
                    delete values[actionCol.name];
                }
                result.retval.push(values);
                resolve();
            }
        });
    }

    /**
     * Walk through the data rows and perform matching or iteration.
     *
     * @returns {Promise<any>}
     */
    walk() {
        const result = {};
        const filterable = value => {
            if (value) {
                if (Array.isArray(value)) {
                    return value
                        .filter(a => a !== undefined && a !== null)
                        .length ? true : false;
                }
                return true;
            }
            return false;
        }
        const iterator = el => {
            switch (true) {
                case this.isMode(SipdQueryBase.ITERATE):
                    return [
                        [x => this.getRowData(this.columns, el)],
                        [x => this.doIterate(el, x.getRes(0), result)],
                    ];
                case this.isMode(SipdQueryBase.MATCH):
                    return [
                        [x => this.getRowData(this.columns, el)],
                        [x => this.doMatch(el, x.getRes(0), result)],
                    ];
            }
        }
        const resolver = res => {
            return new Promise((resolve, reject) => {
                switch (true) {
                    case this.isMode(SipdQueryBase.ITERATE):
                        resolve(res.retval || []);
                        break;
                    case this.isMode(SipdQueryBase.MATCH):
                        let resolved;
                        if (resolved === undefined && this.isMode(SipdQueryBase.MATCH_CUSTOM)) {
                            resolved = true;
                            if (typeof this.onAction === 'function') {
                                this.onAction(res)
                                    .then(() => resolve(res.retval))
                                    .catch(err => reject(err));
                            } else {
                                resolve(res.retval);
                            }
                        }
                        if (resolved === undefined && this.isMode(SipdQueryBase.MATCH_ACTION)) {
                            resolved = res.clicker ? true : false;
                            if (resolved) {
                                res.clicker.click()
                                    .then(() => resolve())
                                    .catch(err => reject(err));
                            }
                        }
                        if (resolved === undefined && this.isMode(SipdQueryBase.MATCH_EXIST)) {
                            resolved = res.retval ? true : false;
                            if (resolved) {
                                resolve(res.retval);
                            }
                        }
                        if (resolved === undefined) {
                            resolved = true;
                            resolve(res.retval);
                        }
                        if (!resolved) {
                            reject(SipdOperationError.create('%title%: %value% not found',
                                {title: this.page.getTitle(), value: this.queryState.expectedValue}));
                        }
                        break;
                }
            });
        }
        return this.parent.works([
            [w => this.parent.navigate(...this.navigates), w => this.navigates],
            [w => this.parent.waitLoader()],
            [w => this.parent.waitContent()],
            [w => new Promise((resolve, reject) => {
                const options = {};
                if (this.isMode(SipdQueryBase.ITERATE) && this.restartOnIterate) {
                    options.states = {};
                }
                const f = () => {
                    this.parent.works([
                        [x => this.parent.gotoPageTop(), x => this.group],
                        [x => this.parent.subPageNav(...(Array.isArray(this.group) ? this.group : [this.group])), x => this.group],
                        [x => this.page.setup()],
                        [x => this.page.filter(...(Array.isArray(this.filter) ? this.filter : [this.filter])), x => filterable(this.filter)],
                        [x => this.page.each(options, iterator)],
                    ])
                    .then(() => resolve())
                    .catch(err => {
                        if (err instanceof SipdRestartError) {
                            options.states.row++;
                            if (options.states.row > options.states.rows) {
                                options.states.row = 1;
                                options.states.page++;
                                if (options.states.page > options.states.pages) {
                                    return resolve();
                                }
                            }
                            setTimeout(() => f(), 0);
                        } else {
                            reject(err);
                        }
                    });
                }
                f();
            })],
            [w => resolver(result)],
        ]);
    }

    static get ITERATE() { return 0x100 }
    static get MATCH() { return 0x200 }
    static get MATCH_EXIST() { return 0x01 }
    static get MATCH_ACTION() { return 0x02 }
    static get MATCH_CUSTOM() { return 0x04 }
}

/**
 * Provides a voter mechanism of data paging in modal dialog.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoter extends SipdQueryBase {

    doPreInitialize() {
        this.mode = SipdQueryBase.MATCH | SipdQueryBase.MATCH_ACTION;
        this.dialog = true;
    }

    getPageOptions() {
        return {
            ...(this.dialog ? {
                selector: '//header[text()="%TITLE%"]/../div[contains(@class,"chakra-modal__body")]',
                tableSelector: './/table/..',
            } : {}),
            ...(this.pageOptions || {}),
        }
    }
}

/**
 * Holds query column mappings.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdColumnsMap {

    /**
     * Get columns mapping.
     *
     * @param {string} key Column map key
     * @returns {object[]}
     */
    get(key) {
        return this.maps[key];
    }

    /**
     * Create columns map.
     *
     * @param {object} maps Columns map
     * @returns {SipdColumnsMap}
     */
    static create(maps) {
        const res = new this();
        /**
         * @param {string} k Map key
         * @returns {object[]}
         */
        const f = k => {
            let key = k;
            const res = [];
            if (k.includes(':')) {
                const [id, parent] = k.split(':');
                key = id;
                res.push(...f(parent)[1]);
            }
            if (Array.isArray(maps[k])) {
                for (const map of maps[k]) {
                    const idx = res.findIndex(a => a.name === map.name);
                    if (idx < 0) {
                        res.push(map);
                    } else {
                        res[idx] = map;
                    }
                }
            }
            return [key, res];
        }
        res.maps = {};
        for (const k of Object.keys(maps)) {
            const [key, mappings] = f(k);
            res.maps[key] = mappings;
        }
        return res;
    }
}

/**
 * Compares between expected and sought values.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryState {

    constructor(columns, diffs) {
        this.states = [];
        for (const [col, value, opt, op] of diffs) {
            const column = columns.find(column => column.name === col);
            if (column) {
                const cmpFnOrRequired = opt !== undefined ? opt : true;
                const cmpRef = typeof cmpFnOrRequired === 'function' ? value : column.asString(value);
                this.states.push({column, ref: cmpRef, fnOrReq: cmpFnOrRequired, op: op ?? SipdUtil.EQ});
            }
        }
        /** @type {SipdQueryColumn} */
        this.statusCol = columns.find(column => [SipdQueryColumn.COL_STATUS, SipdQueryColumn.COL_PROGRESS]
            .includes(column.type));
        /** @type {SipdQueryColumn} */
        this.actionCol = columns.find(column => column.type === SipdQueryColumn.COL_ACTION);
        /** @type {string} */
        this.expectedValue = SipdUtil.kvStr(this.states
            .filter(v => v.fnOrReq)
            .map(v => [v.column.label ?? v.column.name, v.ref]));
    }

    dbg(l, s) {
        return `${l} (${s ? '✓' : '✗'})`;
    }

    test(values) {
        const res = {states: [], info: []};
        for (const state of this.states) {
            const val = typeof state.fnOrReq === 'function' ?
                values[state.column.name] : state.column.asString(values[state.column.name]);
            if (state.fnOrReq) {
                let okay;
                if (typeof state.fnOrReq === 'function') {
                    okay = state.fnOrReq(val, state.ref, state.op);
                } else {
                    okay = SipdUtil.cmp(state.op, val, state.ref);
                }
                res.states.push(okay);
                res.info.push(this.dbg(val, okay));
            } else {
                res.info.push(val);
            }
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

    check(values) {
        const res = {};
        const state = this.test(values);
        const rowstate = `[${state.okay ? '✓' : '✗'}]`;
        if (this.actionCol) {
            res.actionCol = this.actionCol;
        }
        if (this.statusCol) {
            res.statusCol = this.statusCol;
        }
        if (res.statusCol) {
            res.status = values[res.statusCol.name];
        }
        return [state, rowstate, res];
    }
}

module.exports = { SipdQueryBase, SipdVoter };