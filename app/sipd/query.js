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

const Sipd = require('.');
const SipdFn = require('./fn');
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
     * @type {import('./component/page')}
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
        this.setup();
        this.initialize();
    }

    /**
     * Do setup.
     */
    setup() {
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * @returns {SipdQueryColumn[]}
     */
    get columns() {
        if (this._columns === undefined) {
            this._columns = [];
            const tselectors = {
                [SipdQueryColumn.COL_ACTION]: 'div/button',
                [SipdQueryColumn.COL_ACTION_URL]: 'div/a',
                [SipdQueryColumn.COL_STATUS]: '*/*/*/p',
                [SipdQueryColumn.COL_PROGRESS]: '*/ol/li/*/*[@class="stepProgressBar__step__button__indicator"]',
                [SipdQueryColumn.COL_ICON]: '*/*/*[2]/*[1]',
                [SipdQueryColumn.COL_ICON2]: '*/*/*[2]/*[2]',
                [SipdQueryColumn.COL_SINGLE]: '*/*/span',
                [SipdQueryColumn.COL_TIPPY]: 'div[@class="custom-tippy"]/div/div/div/div[2]/span[1]',
                [SipdQueryColumn.COL_TWOLINE]: 'span[2]',
            }
            const defaultColumns = this.defaultColumns || {};
            // index, withIcon, withTippy
            const columns = {...defaultColumns, ...(this.options.columns || [])};
            for (const [k, v] of Object.entries(columns)) {
                const name = isNaN(k) ? k : (v.name !== undefined ? v.name : null);
                const idx = Array.isArray(v) ? v[0] : (v.col !== undefined ? v.col : (typeof v === 'number' ? v : null));
                const colType = Array.isArray(v) ? v[1] : (v.type !== undefined ? SipdQueryColumn.getType(v.type) : SipdQueryColumn.COL_ICON);
                const withTippy = Array.isArray(v) ? v[2] : (v.tippy !== undefined ? v.tippy : false);
                const selector = typeof v === 'object' && v.selector ? v.selector : tselectors[colType];
                const label = typeof v === 'object' && v.label ? v.label : null;
                const placeholder = typeof v === 'object' && v.placeholder ? v.placeholder : null;
                if (name) {
                    const column = new SipdQueryColumn(name, label ?? name, idx, colType, selector, withTippy, placeholder);
                    if (typeof this.getNormalizer === 'function') {
                        column.setNormalizer(this.getNormalizer(column));
                    }
                    if (typeof this.getStringable === 'function') {
                        column.setStringable(this.getStringable(column));
                    }
                    this._columns.push(column);
                }
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
class SipdQueryColumn {

    /**
     * Constructor.
     *
     * @param {string} name Column name
     * @param {string} label Column label
     * @param {int} idx Column index
     * @param {number} type Column type
     * @param {string} selector Column value element selector
     * @param {boolean} tippy Is tippy column
     * @param {string} placeholder Column filter element placeholder
     */
    constructor(name, label, idx, type, selector, tippy, placeholder) {
        this.name = name;
        this.label = label;
        this.idx = idx;
        this.type = type;
        this.selector = selector;
        this.placeholder = placeholder;
        this.tippy = tippy;
    }

    /**
     * Set value normalizer function.
     *
     * @param {Function|string} fn Normalizer function
     * @returns {SipdQueryColumn}
     */
    setNormalizer(fn) {
        if (typeof fn === 'function') {
            this.normalizer = fn;
        }
        if (typeof fn === 'string' && typeof SipdFn.normalizers[fn] === 'function') {
            this.normalizer = SipdFn.normalizers[fn];
        }
        if (this.normalizer === undefined && SipdFn.normalizers.default) {
            this.normalizer = SipdFn.normalizers.default;
        }
        return this;
    }

    /**
     * Set value normalizer function.
     *
     * @param {Function|string} fn Normalizer function
     * @returns {SipdQueryColumn}
     */
    setStringable(fn) {
        if (typeof fn === 'function') {
            this.toStr = fn;
        }
        if (typeof fn === 'string' && typeof SipdFn.stringables[fn] === 'function') {
            this.toStr = SipdFn.stringables[fn];
        }
        if (this.toStr === undefined && SipdFn.stringables.default) {
            this.toStr = SipdFn.stringables.default;
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
     * Translate column type from string to number.
     *
     * @param {string|number} type Column type
     * @returns {number}
     */
    static getType(type) {
        if (typeof type === 'string') {
            const types = {
                'action': SipdQueryColumn.COL_ACTION,
                'url': SipdQueryColumn.COL_ACTION_URL,
                'status': SipdQueryColumn.COL_STATUS,
                'progress': SipdQueryColumn.COL_PROGRESS,
                'icon': SipdQueryColumn.COL_ICON,
                'icon2': SipdQueryColumn.COL_ICON2,
                'single': SipdQueryColumn.COL_SINGLE,
                'tippy': SipdQueryColumn.COL_TIPPY,
                'twoline': SipdQueryColumn.COL_TWOLINE,
            }
            if (types[type.toLowerCase()] !== undefined) {
                type = types[type.toLowerCase()];
            }
        }
        return type;
    }

    static get COL_ACTION() { return 1 }
    static get COL_ACTION_URL() { return 2 }
    static get COL_STATUS() { return 3 }
    static get COL_PROGRESS() { return 4 }
    static get COL_ICON() { return 5 }
    static get COL_ICON2() { return 6 }
    static get COL_SINGLE() { return 7 }
    static get COL_TIPPY() { return 8 }
    static get COL_TWOLINE() { return 9 }
}

module.exports = {
    SipdQuery,
    SipdQueryColumn,
}