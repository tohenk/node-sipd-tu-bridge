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

/**
 * SIPD data row component.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdComponentDataRow extends SipdComponent {

    initialize() {
        this._title = this.getTitle();
    }

    /**
     * Do setup.
     *
     * @returns {Promise<any>}
     */
    doSetup() {
        this
            .reset()
            .setPart(SipdComponentDataRow.ROWS, this.options.tableSelector ??
                './/div[contains(@class,"css-table-responsive")]', SipdComponent.REQUIRED)
            .setPart(SipdComponentDataRow.EMPTY, this.options.emptySelector ??
                './/div[@class="container-no-data-access-modal"]', SipdComponent.REQUIRED)
            .setWrapper();
        return this.queryParts();
    }

    /**
     * Get data rows on page.
     *
     * @returns {Promise<WebElement[]>}
     */
    getRows() {
        return this.works([
            [w => this._rows.findElements(By.xpath('.//table/tbody/tr')), w => this._rows],
            [w => new Promise((resolve, reject) => {
                const rows = [];
                const q = new Queue([...w.res], el => {
                    this.isRow(el)
                        .then(res => {
                            if (res) {
                                rows.push(el);
                            }
                            q.next();
                        })
                        .catch(err => reject(err));
                });
                q.once('done', () => resolve(rows));
            }), w => this._rows],
            [w => Promise.resolve([]), w => !this._rows],
        ]);
    }

    /**
     * Perform row check, return true to accept it, or false to ignore it.
     *
     * @param {WebElement} el Row element
     * @returns {Promise<boolean>}
     */
    isRow(el) {
        return this.works([
            [w => el.isDisplayed()],
            [w => this.options.onrow(el), w => w.getRes(0) && typeof this.options.onrow === 'function'],
        ]);
    }

    /**
     * Is data row empty?
     *
     * @returns {boolean}
     */
    isEmpty() {
        return !this._rows && this._empty !== undefined;
    }

    static get ROWS() { return 'ROWS' }
    static get EMPTY() { return 'EMPTY' }
}

module.exports = SipdComponentDataRow;