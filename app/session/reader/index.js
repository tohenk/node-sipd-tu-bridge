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
const SipdFn = require('../../sipd/fn');
const { Sipd } = require('../../sipd');
const { By, WebElement } = require('selenium-webdriver');

/**
 * Reads page and extract data information within.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdReader {

    /**
     * @type {Sipd}
     */
    parent = null

    /**
     * @type {SipdReaderBase[]}
     */
    readers = []

    /**
     * Constructor.
     *
     * @param {Sipd} parent The parent
     */
    constructor(parent) {
        this.parent = parent;
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * Add reader.
     *
     * @param {string} reader Reader name
     * @param {string} key Object key
     * @param {object} options Reader options
     * @returns {this}
     */
    addReader(reader, key, options) {
        const readerClass = {
            value: SipdReaderValue,
            keyvalue: SipdReaderKeyValue,
            table: SipdReaderTable,
        }[reader];
        if (readerClass) {
            this.readers.push(new readerClass(this.parent, {key, ...options}));
        }
        return this;
    }

    /**
     * Extract data.
     *
     * @returns {Promise<object>}
     */
    extract() {
        return this.parent.works([
            [w => this.parent.waitForPresence(
                By.xpath('//div[contains(@class,"real-frame-pdf")]/div[@class="cetak"]')
            )],
            [w => this.parent.sleep(this.parent.animdelay), w => w.getRes(0)],
            [w => new Promise((resolve, reject) => {
                const values = {};
                const readers = [...this.readers];
                const q = new Queue(readers, reader => {
                    const elements = [];
                    const works = [];
                    reader.reset();
                    for (const selector of Array.isArray(reader.selector) ? reader.selector : [reader.selector]) {
                        works.push(
                            [x => this.parent.findElements({el: w.getRes(0), data: selector})],
                            [x => Promise.resolve(elements.push(x.res))],
                        );
                    }
                    works.push(
                        [x => Promise.resolve(elements.shift())],
                        [x => reader.read(x.res, elements)],
                    );
                    this.parent.works(works)
                        .then(res => {
                            if (res) {
                                let o = values, k = reader.key;
                                const paths = k.split('.');
                                while (paths.length > 1) {
                                    o = o[paths.shift()];
                                    k = paths[0];
                                }
                                if (o[k] === undefined) {
                                    o[k] = res;
                                } else {
                                    Object.assign(o[k], res);
                                }
                            }
                            q.next();
                        })
                        .catch(err => reject(err));
                });
                q.once('done', () => resolve(values));
            }), w => w.getRes(0)],
        ]);
    }
}

/**
 * Reader page extractor.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdReaderBase {

    constructor(parent, options) {
        this.parent = parent;
        this.options = options;
        this.key = options.key;
        this.readAs = options.readAs || SipdReaderBase.AS_VALUE;
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * Reset previous read.
     */
    reset() {
    }

    /**
     * Read page to extract information.
     *
     * @param {WebElement[]} items
     * @param {[WebElement[]]} elements
     * @returns {Promise<object>}
     */
    read(items, elements) {
        return new Promise((resolve, reject) => {
            if (items.length) {
                const result = [];
                const queues = this.pickItems(items);
                const q = new Queue(queues, item => {
                    this.parent.works([
                        [y => this.canReadValue(item, elements)],
                        [y => this.readValue(item, elements), y => y.getRes(0)],
                    ])
                    .then(res => {
                        if (res) {
                            result.push(res);
                        }
                        q.next();
                    })
                    .catch(err => reject(err));
                });
                q.once('done', () => {
                    resolve(this.normalize(this.pickResult(result)));
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Check if element can be read?
     *
     * @param {WebElement} el
     * @param {[WebElement[]]} elements 
     * @returns {Promise<boolean>}
     */
    canReadValue(el, elements) {
        if (typeof this.options.onReadValue === 'function') {
            return this.options.onReadValue(el, elements);
        } else {
            return Promise.resolve(true);
        }
    }

    /**
     * Read information from element.
     *
     * @param {WebElement} el
     * @param {[WebElement[]]} elements
     * @returns {Promise<object>}
     */
    readValue(el, elements) {
        return Promise.reject('Not impelemented yet!');
    }

    /**
     * Normalize values.
     *
     * @param {any} values
     * @returns {any}
     */
    normalize(values) {
        if (this.options.normalize !== undefined) {
            const f = v => {
                if (typeof v === 'object' && Object.keys(v).length) {
                    const ov = {...v};
                    v = {};
                    for (const [col, opt] of Object.entries(this.options.normalize)) {
                        let value = ov[opt.label];
                        if (value !== undefined && value !== null) {
                            let normalizer = opt.normalizer;
                            if (typeof normalizer === 'string' && typeof SipdFn.normalizers[normalizer] === 'function') {
                                normalizer = SipdFn.normalizers[normalizer];
                            }
                            if (typeof normalizer !== 'function' && typeof SipdFn.normalizers.default === 'function') {
                                normalizer = SipdFn.normalizers.default;
                            }
                            if (typeof normalizer === 'function') {
                                value = normalizer(value);
                            }
                            v[col] = value;
                        }
                    }
                }
                return v;
            }
            if (Array.isArray(values)) {
                values = values.map(f);
            } else {
                values = f(values);
            }
        }
        return values;
    }

    /**
     * Pick item to be passed to reader extractor.
     *
     * @param {WebElement[]} items
     * @returns {WebElement|WebElement[]}
     */
    pickItems(items) {
        if (Array.isArray(items)) {
            switch (this.readAs) {
                case SipdReaderBase.AS_VALUE:
                    return [items[0]];
                case SipdReaderBase.AS_VALUES:
                case SipdReaderBase.AS_COLLECTION:
                    return [...items];
            }
        }
    }

    /**
     * Pick reader extrator result.
     *
     * @param {any[]} result
     * @returns {any}
     */
    pickResult(result) {
        if (Array.isArray(result)) {
            switch (this.readAs) {
                case SipdReaderBase.AS_VALUE:
                case SipdReaderBase.AS_VALUES:
                    return result.shift();
                case SipdReaderBase.AS_COLLECTION:
                    return result;
            }
        }
    }

    static get AS_VALUE() { return 1 }
    static get AS_VALUES() { return 2 }
    static get AS_COLLECTION() { return 3 }
}

/**
 * Reader page value extractor.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdReaderValue extends SipdReaderBase {

    initialize() {
        this.selector = [
            By.xpath(this.options.selector),
        ];
    }

    reset() {
        delete this.pushed;
        delete this.res;
    }

    readValue(el, elements) {
        return new Promise((resolve, reject) => {
            el.getAttribute('innerText')
                .then(value => {
                    if (this.res === undefined) {
                        this.res = {};
                    }
                    this.res[this.options.name] = value;
                    if (this.pushed === undefined) {
                        this.pushed = true;
                        resolve(this.res);
                    } else {
                        resolve();
                    }
                })
                .catch(err => reject(err));
        });
    }
}

/**
 * Reader page key value extractor.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdReaderKeyValue extends SipdReaderBase {

    initialize() {
        this.selector = [
            By.xpath(this.options.rowSelector),
        ];
    }

    reset() {
        delete this.pushed;
        delete this.res;
    }

    readValue(el, elements) {
        return this.parent.works([
            [z => this.parent.getText([
                By.xpath(this.options.keySelector),
                By.xpath(this.options.valueSelector),
            ], el)],
            [z => new Promise((resolve, reject) => {
                if (this.res === undefined) {
                    this.res = {};
                }
                this.res[z.getRes(0)[0]] = z.getRes(0)[1];
                if (this.pushed === undefined) {
                    this.pushed = true;
                    resolve(this.res);
                } else {
                    resolve();
                }
            })],
        ]);
    }
}

/**
 * Reader page table extractor.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdReaderTable extends SipdReaderBase {

    initialize() {
        this.pageIndex = this.options.pageIndex || 1;
        this.dataSelector = this.options.dataSelector || 'tbody/tr';
        this.headerSelector = this.options.headerSelector || 'thead/tr';
        this.valueSelector = this.options.valueSelector || 'td';
        this.selector = [
            By.xpath(`.//div[${this.pageIndex}]/table/${this.dataSelector}`),
            By.xpath(`.//div[${this.pageIndex}]/table/${this.headerSelector}`)
        ];
    }

    reset() {
        delete this.headers;
    }

    readValue(el, elements) {
        return this.parent.works([
            [z => this.getHeaders(elements[0])],
            [z => this.getRowValues(el, this.valueSelector)],
            [z => new Promise((resolve, reject) => {
                let res;
                const values = z.getRes(1);
                if (values.length) {
                    res = {};
                    for (let i = 0; i < this.headers.length; i++) {
                        res[this.headers[i]] = values[i];
                    }
                }
                resolve(res);
            })],
        ]);
    }

    getHeaders(elements) {
        return new Promise((resolve, reject) => {
            if (this.headers === undefined) {
                this.getRowValues(elements[0], this.headerSelector.includes('thead') ? 'th' : 'td')
                    .then(values => {
                        this.headers = values;
                        resolve();
                    })
                    .catch(err => reject(err));
            } else {
                resolve();
            }
        });
    }

    getRowValues(el, selector = 'td') {
        return this.parent.works([
            [z => this.parent.findElements({el, data: By.xpath(`.//${selector}`)})],
            [z => new Promise((resolve, reject) => {
                const values = [];
                const q = new Queue(z.getRes(0), col => {
                    col.getAttribute('innerText')
                        .then(str => {
                            values.push(str);
                            q.next();
                        })
                        .catch(err => reject(err));
                });
                q.once('done', () => resolve(values));
            })],
        ]);
    }
}

module.exports = { SipdReader, SipdReaderBase, SipdReaderValue, SipdReaderKeyValue, SipdReaderTable };