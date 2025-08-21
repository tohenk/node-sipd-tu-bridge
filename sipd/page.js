/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
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
const { Sipd } = require('.');
const { By, WebElement } = require('selenium-webdriver');

const dtag = 'page';

/**
 * Handles paging, searching, and iterating of data rows.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdPage {

    PAGINATION_CLASS = 'pagination-custom'

    /**
     * Constructor.
     *
     * @param {Sipd} parent Parent
     * @param {object} options Options
     */
    constructor(parent, options) {
        /** @type {Sipd} */
        this.parent = parent;
        this.parent.constructor.expectErr(SipdStopError);
        this.works = this.parent.works;
        this.options = options;
    }

    /**
     * Do page setup to look for the page elements.
     *
     * @returns {Promise<any>}
     */
    setup() {
        const selector = this.options.selector ? this.options.selector :
            '//h1[contains(@class,"card-title") and text()="%TITLE%"]/../../..';
        return this.works([
            [w => Promise.reject('Page title not specified!'), w => !this.options.title],
            [w => this.parent.findElement(By.xpath(selector.replace(/%TITLE%/, this.options.title)))],
            [w => Promise.resolve(this._wrapper = w.res)],
            [w => this.parent.sleep(this.parent.opdelay)],
            [w => this.findResult()],
            [w => this.findPagination()],
            [w => this.findSearch(this.options.search), w => this.options.search],
        ]);
    }

    /**
     * Find if page is empty.
     *
     * @returns {Promise<any>}
     */
    findEmpty() {
        const selector = this.options.emptySelector ? this.options.emptySelector :
            './/div[@class="container-no-data-access-modal"]';
        return this.works([
            [w => Promise.reject('Wrapper is required!'), w => !this._wrapper],
            [w => this._wrapper.findElements(By.xpath(selector))],
            [w => Promise.resolve(this._empty = w.res[0]), w => w.getRes(1).length],
            [w => Promise.resolve(delete this._empty), w => !w.getRes(1).length],
        ]);
    }

    /**
     * Find page data table.
     *
     * @returns {Promise<any>}
     */
    findTable() {
        const selector = this.options.tableSelector ? this.options.tableSelector :
            './/div[contains(@class,"css-table-responsive")]';
        return this.works([
            [w => Promise.reject('Wrapper is required!'), w => !this._wrapper],
            [w => this._wrapper.findElements(By.xpath(selector))],
            [w => Promise.resolve(this._table = w.res[0]), w => w.getRes(1).length],
            [w => Promise.resolve(delete this._table), w => !w.getRes(1).length],
        ]);
    }

    /**
     * Find page pagination element.
     *
     * @returns {Promise<any>}
     */
    findPagination() {
        const selector = this.options.paginationSelector ? this.options.paginationSelector :
            './/div[@class="container-pagination-table-list"]';
        return this.works([
            [w => Promise.reject('Wrapper is required!'), w => !this._wrapper],
            [w => this._wrapper.findElements(By.xpath(selector))],
            [w => Promise.resolve(this._pager = w.res[0]), w => w.getRes(1).length],
            [w => Promise.resolve(delete this._pager), w => !w.getRes(1).length],
        ]);
    }

    /**
     * Find page search form element.
     *
     * @param {object} data Search model object
     * @param {By} data.toggler Toggler element to expand the search form
     * @param {By} data.input Text input element
     * @param {By} data.filter Filter choices element
     * @param {By} data.submit Form submit element
     * @returns {Promise<any>}
     */
    findSearch(data) {
        return this.works([
            [w => Promise.reject('Wrapper is required!'), w => !this._wrapper],
            [w => this._wrapper.findElement(data.input), w => data.input],
            [w => Promise.resolve(this._search = w.res), w => data.input],
            [w => this._wrapper.findElement(data.toggler), w => data.toggler],
            [w => Promise.resolve(this._search_toggler = w.res), w => data.toggler],
            [w => this._wrapper.findElement(data.filter), w => data.filter],
            [w => Promise.resolve(this._search_filter = w.res), w => data.filter],
            [w => this._wrapper.findElement(data.submit), w => data.submit],
            [w => Promise.resolve(this._search_submit = w.res), w => data.submit],
        ]);
    }

    /**
     * Find page result either with page data table or empty page.
     *
     * @returns {Promise<any>}
     */
    findResult() {
        return new Promise((resolve, reject) => {
            let lastTime;
            const startTime = new Date().getTime();
            const f = () => {
                this.works([
                    [w => this.findTable()],
                    [w => this.findEmpty(), w => !this._table],
                    [w => Promise.resolve(this._table || this._empty)],
                ])
                .then(res => {
                    if (res) {
                        this.parent.getHtml(res)
                            .then(html => {
                                this.parent.debug(dtag)(`Page result is ${this.parent.trunc(html)}`);
                                resolve();
                            })
                            .catch(err => reject(err));
                    } else {
                        const deltaTime = Math.floor((new Date().getTime() - startTime) / 1000);
                        if (deltaTime > 0 && deltaTime % 10 === 0 && (lastTime === undefined || lastTime < deltaTime)) {
                            lastTime = deltaTime;
                            this.parent.debug(dtag)(`Still waiting page result after ${deltaTime}s...`);
                        }
                        setTimeout(f, this.parent.loopdelay);
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });   
    }

    /**
     * Get current page.
     *
     * @returns {Promise<number>}
     */
    getPage() {
        return this.works([
            [w => Promise.reject('Pager not initialized!'), w => !this._pager],
            [w => this._pager.findElement(By.xpath(`.//ul[@class="${this.PAGINATION_CLASS}"]/li[@class="selected"]`))],
            [w => w.getRes(1).getAttribute('innerText')],
            [w => Promise.resolve(parseInt(w.getRes(2)))],
        ]);
    }

    /**
     * Get total pages.
     *
     * @returns {Promise<number>}
     */
    getPages() {
        return this.works([
            [w => Promise.reject('Pager not initialized!'), w => !this._pager],
            [w => this._pager.findElements(By.xpath(`.//ul[@class="${this.PAGINATION_CLASS}"]/li[not (contains(@class,"previous") or contains(@class,"next"))]`))],
            [w => w.getRes(1)[w.getRes(1).length - 1].getAttribute('innerText'), w => w.getRes(1).length],
            [w => Promise.resolve(parseInt(w.getRes(2))), w => w.getRes(1).length],
            [w => Promise.resolve(0), w => w.getRes(1).length === 0],
        ]);
    }

    /**
     * Go to page number.
     *
     * @param {number} page Page number
     * @returns {Promise<any>}
     */
    gotoPage(page) {
        const selector = this.options.pageSelector ?? 'li/a[text()="%PAGE%"]';
        const xpath = `.//ul[@class="${this.PAGINATION_CLASS}"]/${selector.replace(/%PAGE%/, page)}`;
        return this.works([
            [w => Promise.reject('Pager not initialized!'), w => !this._pager],
            [w => this._pager.findElements(By.xpath(xpath))],
            [w => new Promise((resolve, reject) => {
                if (w.getRes(1).length) {
                    resolve(w.getRes(1)[0]);
                } else {
                    reject(`Unable to locate page ${page} element using ${xpath}!`);
                }
            })],
            [w => w.res.click()],
            [w => this.parent.sleep(this.parent.opdelay)],
            [w => this.setup()],
        ]);
    }

    /**
     * Iterate a function over data found on page.
     *
     * @param {number} page Page number
     * @param {Function} onwork A callback to iterate data found on page
     * @returns {Promise<any>}
     */
    eachPage(page, onwork) {
        return this.works([
            // get current page
            [w => this.getPage()],
            // activate page if not current
            [w => this.gotoPage(page), w => w.getRes(0) !== page],
            // find table rows
            [w => this.getRows()],
            // process rows
            [w => new Promise((resolve, reject) => {
                const q = new Queue(w.getRes(2), row => {
                    const works = onwork(row);
                    try {
                        this.works(works)
                            .then(() => q.next())
                            .catch(err => reject(err));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
                q.once('done', () => resolve())
            })],
        ]);
    }

    /**
     * Get data rows on page.
     *
     * @returns {Promise<WebElement[]>}
     */
    getRows() {
        return this.works([
            [w => this._table.findElements(By.xpath('.//table/tbody/tr')), w => this._table],
            [w => Promise.resolve([]), w => !this._table],
        ]);
    }

    /**
     * Perform search on page.
     *
     * @param {string} term Search term
     * @param {string} key Filter key
     * @returns {Promise<any>}
     */
    search(term, key = null) {
        return this.works([
            [w => Promise.reject('Search not initialized!'), w => !this._search],
            [w => this._search_toggler.getAttribute('aria-expanded'), w => this._search_toggler],
            [w => this.parent.clickExpanded(this._search_toggler), w => this._search_toggler && w.getRes(1) === 'false'],
            [w => this._search_filter.click(), w => this._search_filter && key],
            [w => this._search_filter.findElements(By.xpath(`./../*/*/button/span/p[text()="${key}"]/../..`)), w => this._search_filter && key],
            [w => Promise.reject(`No filter key found for ${key}!`), w => this._search_filter && key && !w.getRes(4).length],
            [w => w.getRes(4)[0].click(), w => this._search_filter && key && w.getRes(4).length],
            [w => this.parent.fillInput(this._search, typeof term === 'string' ? term.replace(/'/g, '\'\'') : term, this.parent.options.clearUsingKey)],
            [w => this._search_submit.click(), w => this._search_submit],
            [w => this.parent.sleep(this.parent.opdelay)],
            [w => this.setup()],
        ]);
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
            [w => this.getRows()],
            [w => this.getPages(), w => w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                const pageCount = w.getRes(1);
                const pages = Array.from({length: pageCount}, (x, i) => i + 1);
                const q = new Queue(pages, page => {
                    this.parent.debug(dtag)(`Processing page ${page} of ${pageCount}`);
                    this.eachPage(page, callback)
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

    static stop() {
        return new SipdStopError();
    }
}

/**
 * An error to indicate a stop operation when iterating data rows.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdStopError extends Error
{
}

module.exports = SipdPage;