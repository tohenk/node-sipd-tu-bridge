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
const SipdComponent = require('.');
const SipdComponentDataRow = require('./datarow');
const SipdComponentFilter = require('./filter');
const SipdComponentPager = require('./pager');
const { SipdStopError } = require('..');
const { By } = require('selenium-webdriver');

const dtag = 'page';

/**
 * Handles paging, searching, and iterating of data rows.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdComponentPage extends SipdComponent {

    initialize() {
        /** @type {SipdComponentDataRow} */
        this._datarow;
        /** @type {SipdComponentPager} */
        this._pager;
        /** @type {SipdComponentFilter} */
        this._filter;
        this._subComponents.push(SipdComponentDataRow);
        this._subComponents.push(SipdComponentPager);
        this._subComponents.push(SipdComponentFilter);
        this.parent.constructor.expectErr(SipdStopError);
    }

    /**
     * Do setup.
     *
     * @returns {Promise<any>}
     */
    doSetup() {
        delete this.options.wrapper;
        const selector = this.options.selector ?? '//h1[contains(@class,"card-title") and text()="%TITLE%"]/../../..';
        return this.works([
            [w => Promise.reject('Page title not specified!'), w => !this.options.title],
            [w => this.parent.findElement(By.xpath(selector.replace(/%TITLE%/, this.options.title)))],
            [w => Promise.resolve(this.options.wrapper = w.res)],
            [w => Promise.resolve(this._filter.enabled = this.options.filter ? true : false)],
            [w => Promise.resolve(this.setupHandler())],
        ]);
    }

    /**
     * Do post setup.
     *
     * @returns {Promise<any>}
     */
    doPostSetup() {
        return this.parent.dismissStatuses();
    }

    /**
     * Setup page handler.
     */
    setupHandler() {
        // restart setup on filtering
        if (this._filter.onfilter === undefined) {
            this._filter.onfilter = () => this.setup();
        }
        // restart setup on page change
        if (this._pager.onpage === undefined) {
            this._pager.onpage = () => this.setup();
        }
    }

    /**
     * Apply data filtering on page.
     *
     * @param {string|string[]} value Filter value
     * @param {string} key Filter key
     * @returns {Promise<any>}
     */
    filter(value, key = null) {
        if (this._filter.enabled) {
            return this._filter.apply(value, key);
        } else {
            return Promise.reject('Page filtering is not enabled!');
        }
    }

    /**
     * Iterate a function over all rows found on all pages. To stop the
     * iteration, simply throw `SipdStopError`.
     *
     * @param {object} options The options
     * @param {Function} callback The callback to call when iterating rows
     * @returns {Promise<any>}
     */
    each(options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        return this.works([
            [w => this._datarow.getRows()],
            [w => this._pager.getPages(), w => w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                let pages, pageCount = w.getRes(1);
                if (options.states) {
                    if (options.states.pages === undefined) {
                        options.states.pages = pageCount;
                    }
                    if (options.states.page === undefined) {
                        options.states.page = 1;
                    }
                    if (options.states.pages !== pageCount) {
                        pageCount = options.states.pages;
                    }
                    pages = [options.states.page];
                } else {
                    pages = Array.from({length: pageCount}, (x, i) => i + 1);
                }
                const q = new Queue(pages, page => {
                    this.parent.debug(dtag)(`Processing page ${this.options.title}: ${page} of ${pageCount}`);
                    this._pager.each(page, {states: options.states, onrows: () => this._datarow.getRows(), onwork: callback})
                        .then(() => q.next())
                        .catch(err => {
                            if (err instanceof SipdStopError) {
                                q.done();
                            } else {
                                reject(err);
                            }
                        });
                });
                q.once('done', () => resolve());
            }), w => w.getRes(0).length && w.getRes(1)],
        ]);
    }
}

module.exports = SipdComponentPage;