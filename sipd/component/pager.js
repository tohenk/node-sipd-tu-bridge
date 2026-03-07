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
const { By, WebElement } = require('selenium-webdriver');

const dtag = 'pager';

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
     * List all visible pages.
     *
     * @param {number} skip Skip page navigation
     * @returns {Promise<[{page: string, el: WebElement}]>}
     */
    listPages(skip = SipdComponentPager.SKIP_ALL) {
        const res = [];
        const skips = [];
        for (const [k, v] of Object.entries({
            previous: SipdComponentPager.SKIP_PREV,
            next: SipdComponentPager.SKIP_NEXT,
            break: SipdComponentPager.SKIP_JUMP,
        })) {
            if ((skip & v) === v) {
                skips.push(k);
            }
        }
        const skipped = skips
            .map(s => `contains(@class,"${s}")`)
            .join(' or ');
        return this.works([
            [w => Promise.reject('Pager is not initialized!'), w => !this._pager],
            [w => this._pager.findElements(By.xpath(`.//ul[@class="${this.PAGINATION_CLASS}"]/li[not (${skipped})]/a`))],
            [w => new Promise((resolve, reject) => {
                const q = new Queue(w.getRes(1), el => {
                    const r = page => {
                        res.push({page, el});
                        q.next();
                    }
                    const f = (attr, cb) => {
                        el.getAttribute(attr)
                            .then(s => cb(s))
                            .catch(err => reject(err));
                    }
                    f('innerText', s => s.match(/^\d+$/) ? r(s) : f('aria-label', r));
                });
                q.once('done', () => resolve(res));
            })],
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
            [w => this.listPages()],
            [w => Promise.resolve(w.getRes(0).map(p => parseInt(p.page)))],
            [w => Promise.resolve(w.getRes(1).length ? Math.max(...w.getRes(1)) : 0)],
        ]);
    }

    /**
     * Go to page number.
     *
     * @param {number} page Page number
     * @returns {Promise<any>}
     */
    gotoPage(page) {
        return new Promise((resolve, reject) => {
            const jumpPage = pages => {
                let idx;
                pages.forEach((p, i) => {
                    if (!p.page.match(/^\d+$/)) {
                        if (parseInt(pages[i - 1].page) < page && parseInt(pages[i + 1].page) > page) {
                            idx = i;
                        }
                    }
                });
                if (idx) {
                    this.parent.debug(dtag)(`Using page ${pages[idx].page} to navigate to page ${page}`);
                }
                return pages[idx]?.el;
            }
            const f = () => {
                this.works([
                    [w => this.listPages(SipdComponentPager.SKIP_PREV | SipdComponentPager.SKIP_NEXT)],
                    [w => Promise.resolve(w.getRes(0).find(p => p.page === page.toString()))],
                    [w => w.getRes(1).el.click(), w => w.getRes(1)],
                    [w => this.onpage(), w => w.getRes(1) && typeof this.onpage === 'function'],
                    [w => Promise.resolve(jumpPage(w.getRes(0))), w => !w.getRes(1)],
                    [w => w.getRes(4).click(), w => !w.getRes(1)],
                    [w => this.setup(), w => !w.getRes(1)],
                    [w => Promise.resolve(w.getRes(1) ? true : false)],
                ])
                .then(res => {
                    if (res) {
                        resolve();
                    } else {
                        f();
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });
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

    static get SKIP_PREV() { return 1 }
    static get SKIP_NEXT() { return 2 }
    static get SKIP_JUMP() { return 4 }
    static get SKIP_ALL() {
        return (
            SipdComponentPager.SKIP_PREV |
            SipdComponentPager.SKIP_NEXT |
            SipdComponentPager.SKIP_JUMP
        );
    }
}

module.exports = SipdComponentPager;