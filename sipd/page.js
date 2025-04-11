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
const { By } = require('selenium-webdriver');

class SipdPage {

    PAGE_SIZE = 10
    PAGINATION_CLASS = 'pagination-custom'

    /**
     * Constructor.
     *
     * @param {Sipd} parent Parent
     * @param {object} options Options
     */
    constructor(parent, options) {
        this.parent = parent;
        this.parent.constructor.expectErr(SipdStopError);
        this.works = this.parent.works;
        this.options = options;
    }

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

    findResult() {
        return new Promise((resolve, reject) => {
            const f = () => {
                this.works([
                    [w => this.findTable()],
                    [w => this.findEmpty(), w => !this._table],
                    [w => Promise.resolve(this._table || this._empty)],
                ])
                .then(res => {
                    if (res) {
                        resolve();
                    } else {
                        setTimeout(f, this.parent.loopdelay);
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });   
    }

    getPage() {
        return this.works([
            [w => Promise.reject('Pager not initialized!'), w => !this._pager],
            [w => this._pager.findElement(By.xpath(`.//ul[@class="${this.PAGINATION_CLASS}"]/li[@class="selected"]`))],
            [w => w.getRes(1).getAttribute('innerText')],
            [w => Promise.resolve(parseInt(w.getRes(2)))],
        ]);
    }

    getPages() {
        return this.works([
            [w => Promise.reject('Pager not initialized!'), w => !this._pager],
            [w => this._pager.findElements(By.xpath(`.//ul[@class="${this.PAGINATION_CLASS}"]/li[not (contains(@class,"previous") or contains(@class,"next"))]`))],
            [w => w.getRes(1)[w.getRes(1).length - 1].getAttribute('innerText'), w => w.getRes(1).length],
            [w => Promise.resolve(parseInt(w.getRes(2))), w => w.getRes(1).length],
            [w => Promise.resolve(0), w => w.getRes(1).length == 0],
        ]);
    }

    gotoPage(page) {
        const selector = this.options.pageSelector ? this.options.pageSelector :
            'li[text()="%PAGE%"]';
        return this.works([
            [w => Promise.reject('Pager not initialized!'), w => !this._pager],
            [w => this._pager.findElements(By.xpath(`.//ul[@class="${this.PAGINATION_CLASS}"]/${selector.replace(/%PAGE%/, page)}`))],
            [w => new Promise((resolve, reject) => {
                if (w.getRes(1).length) {
                    resolve(w.getRes(1)[0]);
                } else {
                    reject(`Unable to locate page ${page} element!`);
                }
            })],
            [w => w.res.click()],
            [w => this.parent.sleep(this.parent.opdelay)],
            [w => this.setup()],
        ]);
    }

    eachPage(page, onwork) {
        return this.works([
            // get current page
            [w => this.getPage()],
            // activate page if not current
            [w => this.gotoPage(page), w => w.getRes(0) != page],
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

    getRows() {
        return this.works([
            [w => this._table.findElements(By.xpath('.//table/tbody/tr')), w => this._table],
            [w => Promise.resolve([]), w => !this._table],
        ]);
    }

    search(term, key = null) {
        return this.works([
            [w => Promise.reject('Search not initialized!'), w => !this._search],
            [w => this.parent.clickExpanded(this._search_toggler), w => this._search_toggler],
            [w => this._search_filter.click(), w => this._search_filter && key],
            [w => this._search_filter.findElements(By.xpath(`./../*/*/button/span/p[text()="${key}"]/../..`)), w => this._search_filter && key],
            [w => Promise.reject(`No filter key found for ${key}!`), w => this._search_filter && key && !w.getRes(3).length],
            [w => w.getRes(3)[0].click(), w => this._search_filter && key && w.getRes(3).length],
            [w => this.parent.fillInput(this._search, term, this.parent.options.clearUsingKey)],
            [w => this._search_submit.click(), w => this._search_submit],
            [w => this.parent.sleep(this.parent.opdelay)],
            [w => this.setup()],
        ]);
    }

    each(options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        return this.works([
            [w => this.getRows()],
            [w => this.getPages(), w => w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                const p = options.filtered && w.getRes(0).length < this.PAGE_SIZE ? 1 : w.getRes(1);
                const pages = Array.from({length: p}, (x, i) => i + 1);
                const q = new Queue(pages, page => {
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

class SipdStopError extends Error
{
}

module.exports = SipdPage;