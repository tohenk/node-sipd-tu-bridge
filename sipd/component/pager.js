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
const { By } = require('selenium-webdriver');

/**
 * SIPD data pagination component.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdComponentPager extends SipdComponent {

    PAGINATION_CLASS = 'pagination-custom'

    /**
     * Do setup.
     *
     * @returns {Promise<any>}
     */
    doSetup() {
        this._title = this.options.title;
        this._wrapper = this.options.wrapper;
        return this.setupPagination();
    }

    /**
     * Setup page pagination element.
     *
     * @returns {Promise<any>}
     */
    setupPagination() {
        const selector = this.options.paginationSelector ?? './/div[@class="container-pagination-table-list"]';
        return this.works([
            [w => Promise.reject('Wrapper is required!'), w => !this._wrapper],
            [w => this._wrapper.findElements(By.xpath(selector))],
            [w => Promise.resolve(this._pager = w.res[0]), w => w.getRes(1).length],
            [w => Promise.resolve(delete this._pager), w => !w.getRes(1).length],
        ]);
    }

    /**
     * Get current page.
     *
     * @returns {Promise<number>}
     */
    getPage() {
        return this.works([
            [w => Promise.reject('Pager is not initialized!'), w => !this._pager],
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
            [w => Promise.reject('Pager is not initialized!'), w => !this._pager],
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
            [w => Promise.reject('Pager is not initialized!'), w => !this._pager],
            [w => this._pager.findElements(By.xpath(xpath))],
            [w => new Promise((resolve, reject) => {
                if (w.getRes(1).length) {
                    resolve(w.getRes(1)[0]);
                } else {
                    reject(`Unable to locate page ${page} element using ${xpath}!`);
                }
            })],
            [w => w.res.click()],
            [w => this.onpage(), w => typeof this.onpage === 'function'],
        ]);
    }

    /**
     * Iterate a function over data found on page.
     *
     * @param {number} page Page number
     * @param {object} options Page iterate options
     * @param {Function} options.onrows A callback to get data rows on page
     * @param {Function} options.onwork A callback to iterate data found on page
     * @returns {Promise<any>}
     */
    each(page, options = {}) {
        let onrows, onwork;
        if (typeof options.onrows === 'function') {
            onrows = options.onrows;
        }
        if (typeof options.onwork === 'function') {
            onwork = options.onwork;
        }
        if (typeof onrows !== 'function') {
            throw new Error('Each page requires onrows handler!');
        }
        if (typeof onwork !== 'function') {
            throw new Error('Each page requires onwork handler!');
        }
        return this.works([
            // get current page
            [w => this.getPage()],
            // activate page if not current
            [w => this.gotoPage(page), w => w.getRes(0) !== page],
            // get page data rows
            [w => onrows()],
            // process rows
            [w => new Promise((resolve, reject) => {
                /** @type {WebElement[]} */
                let rows = w.getRes(2);
                if (options.states) {
                    options.states.rows = rows.length;
                    if (options.states.row === undefined) {
                        options.states.row = 1;
                    }
                    rows = rows.slice(options.states.row - 1, options.states.row);
                }
                const q = new Queue(rows, row => {
                    try {
                        const works = onwork(row);
                        this.works(works)
                            .then(() => q.next())
                            .catch(err => reject(err));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
                q.once('done', () => resolve());
            })],
        ]);
    }
}

module.exports = SipdComponentPager;