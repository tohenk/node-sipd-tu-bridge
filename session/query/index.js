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

const Queue = require('@ntlab/work/queue');
const SipdPage = require('../../sipd/component/page');
const { SipdAnnouncedError, SipdRestartError, SipdStopError } = require('../../sipd');
const { SipdQuery, SipdColumnQuery } = require('../../sipd/query');
const { By, WebElement } = require('selenium-webdriver');

const dtag = 'query';

/**
 * Provides initialization mechanism for data paging.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueryBase extends SipdQuery {

    initialize() {
        this.mode = SipdQueryBase.MODE_MATCH;
        this.actionEnabled = false;
        this.restartOnIterate = false;
        this.progressInitialValue = 'Baru';
        this.doPreInitialize();
        this.doInitialize();
        this.doPostInitialize();
        this.doPageInitialize();
        this.doCreatePage();
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
            title: this.options.title,
            ...this.getPageOptions(),
        });
    }

    getPageOptions() {
        return this.pageOptions || {};
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
     * @param {SipdColumnQuery[]} columns Columns data
     * @param {WebElement} el The Element
     * @returns {Promise<object>}
     */
    getRowData(columns, el) {
        return new Promise((resolve, reject) => {
            const res = {};
            const q = new Queue([...columns], col => {
                const works = [];
                switch (col.type) {
                    case SipdColumnQuery.COL_ACTION:
                    case SipdColumnQuery.COL_ACTION_URL:
                        works.push(...[
                            [w => this.parent.findElement({el, data: col.xpath})],
                            [w => w.res.getAttribute('href'), w => w.res && col.type === SipdColumnQuery.COL_ACTION_URL],
                        ]);
                        break;
                    case SipdColumnQuery.COL_PROGRESS:
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
            const result = {};
            const dbg = (l, s) => `${l} (${s ? '✓' : '✗'})`;
            const f = (...args) => {
                const res = {
                    states: [],
                    info: [],
                }
                for (const arg of args) {
                    if (arg[2]) {
                        let okay;
                        if (typeof arg[2] === 'function') {
                            // 0 -> ref value
                            // 1 -> row value
                            okay = arg[2](arg[1], arg[0]);
                        } else if (typeof arg[0] === 'string' && typeof arg[1] === 'string') {
                            okay = arg[0].toLowerCase() === arg[1].toLowerCase();
                        } else {
                            okay = arg[0] == arg[1];
                        }
                        res.states.push(okay);
                        res.info.push(dbg(arg[1], okay));
                    } else {
                        res.info.push(arg[1]);
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
            const compares = [];
            for (const [col, value, opt] of this.diffs) {
                const column = this.columns.find(column => column.name === col);
                if (column) {
                    const cmpFnOrRequired = opt !== undefined ? opt : true;
                    const cmpRef = typeof cmpFnOrRequired === 'function' ? value : column.asString(value);
                    const cmpVal = typeof cmpFnOrRequired === 'function' ? values[col] : column.asString(values[col]);
                    compares.push([cmpRef, cmpVal, cmpFnOrRequired]);
                }
            }
            result.expectedValue = compares
                .filter(v => v[2])
                .map(v => v[0])
                .join('-');
            result.statusCol = this.columns.find(column => [SipdColumnQuery.COL_STATUS, SipdColumnQuery.COL_PROGRESS]
                .includes(column.type));
            result.actionCol = this.columns.find(column => column.type === SipdColumnQuery.COL_ACTION);
            if (result.statusCol) {
                result.status = values[result.statusCol.name];
            }
            const states = f(...compares);
            const rowstate = `[${states.okay ? '✓' : '✗'}]`;
            if (result.status !== undefined) {
                this.parent.debug(dtag)('Row state:', rowstate, `<${result.status}>`, ...states.info);
            } else {
                this.parent.debug(dtag)('Row state:', rowstate, ...states.info);
            }
            resolve(states.okay ? result : undefined);
        });
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
                        if (this.isActionEnabled() && result.actionCol) {
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
                const actionCol = this.columns.find(column => column.type === SipdColumnQuery.COL_ACTION);
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
        let result = {};
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
            switch (this.mode) {
                case SipdQueryBase.MODE_MATCH:
                    return [
                        [x => this.getRowData(this.columns, el)],
                        [x => this.doMatch(el, x.getRes(0), result)],
                    ];
                case SipdQueryBase.MODE_ITERATE:
                    return [
                        [x => this.getRowData(this.columns, el)],
                        [x => this.doIterate(el, x.getRes(0), result)],
                    ];
            }
        }
        const resolver = res => {
            return new Promise((resolve, reject) => {
                switch (this.mode) {
                    case SipdQueryBase.MODE_MATCH:
                        if (!this.actionEnabled) {
                            if (typeof this.onAction === 'function') {
                                this.onAction(res)
                                    .then(() => resolve(res.retval))
                                    .catch(err => reject(err));
                            } else {
                                resolve(res.retval);
                            }
                        } else if (res.clicker) {
                            res.clicker.click()
                                .then(() => resolve())
                                .catch(err => reject(err));
                        } else {
                            reject(new SipdAnnouncedError(`${this.options.title}: ${res.expectedValue} not found!`));
                        }
                        break;
                    case SipdQueryBase.MODE_ITERATE:
                        resolve(res.retval || []);
                        break;
                }
            });
        }
        return this.parent.works([
            [w => this.parent.navigate(...this.navigates), w => this.navigates],
            [w => this.parent.waitLoader()],
            [w => new Promise((resolve, reject) => {
                const options = {};
                if (this.mode === SipdQueryBase.MODE_ITERATE && this.restartOnIterate) {
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
                            setTimeout(f, 0);
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

    static get MODE_MATCH() { return 1 }
    static get MODE_ITERATE() { return 2 }
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

module.exports = { SipdQueryBase, SipdVoter };