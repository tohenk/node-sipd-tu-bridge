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

const { Sipd } = require('.');
const { By } = require('selenium-webdriver');

/**
 * A metadata to perform operation for in-page data rows.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQuery {

    /**
     * @type {Sipd}
     */
    parent = null

    /**
     * @type {string[]}
     */
    navigates = []

    /**
     * @type {string}
     */
    group = null

    /**
     * @type {import('./page')}
     */
    page = null

    /**
     * Constructor.
     *
     * @param {Sipd} parent The parent
     * @param {object} data The data
     * @param {object} options The options
     */
    constructor(parent, data, options) {
        this.parent = parent;
        this.data = data;
        this.options = options || {};
        if (this.options.navigates !== undefined) {
            this.navigates = this.options.navigates;
        }
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * @returns {SipdColumnQuery[]}
     */
    get columns() {
        if (this._columns === undefined) {
            this._columns = [];
            const tselectors = {
                [SipdColumnQuery.COL_STATUS]: '*/*/*/p',
                [SipdColumnQuery.COL_PROGRESS]: '*/ol/li/*/*[@class="stepProgressBar__step__button__indicator"]',
                [SipdColumnQuery.COL_ACTION]: 'div/button',
                [SipdColumnQuery.COL_ICON]: '*/*/*[2]/*[1]',
                [SipdColumnQuery.COL_ICON2]: '*/*/*[2]/*[2]',
                [SipdColumnQuery.COL_SINGLE]: '*/*/span',
                [SipdColumnQuery.COL_TIPPY]: 'div[@class="custom-tippy"]/div/div/div/div[2]/span[1]',
                [SipdColumnQuery.COL_TWOLINE]: 'span[2]',
            }
            const defaultColumns = this.defaultColumns || {};
            // index, withIcon, withTippy
            const columns = {
                ...defaultColumns,
                ...(this.options.columns || {}),
            }
            for (const [k, v] of Object.entries(columns)) {
                const idx = Array.isArray(v) ? v[0] : (v.index !== undefined ? v.index : (typeof v === 'number' ? v : null));
                const colType = Array.isArray(v) ? v[1] : (v.type !== undefined ? v.type : SipdColumnQuery.COL_ICON);
                const withTippy = Array.isArray(v) ? v[2] : (v.tippy !== undefined ? v.tippy : false);
                const selector = typeof v === 'object' && v.selector ? v.selector : tselectors[colType];
                const column = new SipdColumnQuery(colType, k, idx, withTippy, selector);
                if (typeof this.getNormalizer === 'function') {
                    column.setNormalizer(this.getNormalizer(column));
                }
                if (typeof this.getStringable === 'function') {
                    column.setStringable(this.getStringable(column));
                }
                this._columns.push(column);
            }
        }
        return this._columns;
    }
}

/**
 * Data row colum model.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdColumnQuery {

    /**
     * Constructor.
     *
     * @param {number} type Column type
     * @param {string} name Column name
     * @param {int} idx Column index
     * @param {boolean} tippy Is tippy column
     * @param {string} selector Column value element selector
     */
    constructor(type, name, idx, tippy, selector) {
        this.type = type;
        this.name = name;
        this.idx = idx;
        this.tippy = tippy;
        this.selector = selector;
    }

    /**
     * Set value normalizer function.
     *
     * @param {Function|string} fn Normalizer function
     * @returns {SipdColumnQuery}
     */
    setNormalizer(fn) {
        if (typeof fn === 'function') {
            this.normalizer = fn;
        }
        if (typeof fn === 'string' && typeof this.constructor.normalizers[fn] === 'function') {
            this.normalizer = this.constructor.normalizers[fn];
        }
        if (this.normalizer === undefined && this.constructor.normalizers.default) {
            this.normalizer = this.constructor.normalizers.default;
        }
        return this;
    }

    /**
     * Set value normalizer function.
     *
     * @param {Function|string} fn Normalizer function
     * @returns {SipdColumnQuery}
     */
    setStringable(fn) {
        if (typeof fn === 'function') {
            this.toStr = fn;
        }
        if (typeof fn === 'string' && typeof this.constructor.stringables[fn] === 'function') {
            this.toStr = this.constructor.stringables[fn];
        }
        if (this.toStr === undefined && this.constructor.stringables.default) {
            this.toStr = this.constructor.stringables.default;
        }
        return this;
    }

    /**
     * Normalize the value.
     *
     * @param {string} value The input value
     * @returns {any}
     */
    normalize(value) {
        if (typeof this.normalizer === 'function') {
            value = this.normalizer(value);
        }
        return value;
    }

    /**
     * Get string representation of value.
     *
     * @param {any} value The input value.
     * @returns {string}
     */
    asString(value) {
        if (value !== undefined && value !== null) {
            if (typeof this.toStr === 'function') {
                value = this.toStr(value);
            }
            if (typeof value === 'string' && value.includes('\n')) {
                value = value.split('\n').join(' ');
            }
        }
        return value;
    }

    /**
     * Get the xpath for value selector.
     *
     * @returns {By}
     */
    get xpath() {
        return this.idx !== undefined && this.idx !== null ?
            By.xpath(`./td[${this.idx}]/${this.selector}`) : By.xpath(this.selector);
    }

    /**
     * Get the xpath for tippy selector.
     *
     * @returns {By}
     */
    get tippyXpath() {
        return this.tippy ? By.xpath(`./td[${this.idx}]/div[@class="custom-tippy"]/div`) : null;
    }

    /**
     * Column value normalizer functions.
     *
     * @returns {object}
     */
    static get normalizers() {
        if (this._normalizers === undefined) {
            this._normalizers = {};
        }
        return this._normalizers;
    }

    /**
     * Column value string representation functions.
     *
     * @returns {object}
     */
    static get stringables() {
        if (this._stringables === undefined) {
            this._stringables = {};
        }
        return this._stringables;
    }

    static get COL_ACTION() { return 0 }
    static get COL_STATUS() { return 1 }
    static get COL_PROGRESS() { return 2 }
    static get COL_ICON() { return 3 }
    static get COL_ICON2() { return 4 }
    static get COL_SINGLE() { return 5 }
    static get COL_TIPPY() { return 6 }
    static get COL_TWOLINE() { return 7 }
}

module.exports = {
    SipdQuery,
    SipdColumnQuery,
}