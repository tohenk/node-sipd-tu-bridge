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

const SipdComponent = require('.');
const { By } = require('selenium-webdriver');

const dtag = 'datarow';

/**
 * SIPD data row component.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdComponentDataRow extends SipdComponent {

    /**
     * Do setup.
     *
     * @returns {Promise<any>}
     */
    doSetup() {
        this._title = this.options.title;
        this._wrapper = this.options.wrapper;
        return this.setupDataRow();
    }

    /**
     * Setup data row result either with data table or empty one.
     *
     * @returns {Promise<any>}
     */
    setupDataRow() {
        return new Promise((resolve, reject) => {
            let lastTime;
            const startTime = new Date().getTime();
            const f = () => {
                this.works([
                    [w => this.findRows()],
                    [w => this.findEmpty(), w => !this._rows],
                    [w => Promise.resolve(this._rows || this._empty)],
                ])
                .then(res => {
                    if (res) {
                        this.parent.getHtml(res)
                            .then(html => {
                                this.parent.debug(dtag)(`Data row ${this._title} result is ${this.parent.truncate(html)}`);
                                resolve();
                            })
                            .catch(err => reject(err));
                    } else {
                        const deltaTime = Math.floor((new Date().getTime() - startTime) / 1000);
                        if (deltaTime > 0 && deltaTime % 10 === 0 && (lastTime === undefined || lastTime < deltaTime)) {
                            lastTime = deltaTime;
                            this.parent.debug(dtag)(`Still waiting data row ${this._title} result after ${deltaTime}s...`);
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
     * Find if page is empty.
     *
     * @returns {Promise<any>}
     */
    findEmpty() {
        const selector = this.options.emptySelector ?? './/div[@class="container-no-data-access-modal"]';
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
    findRows() {
        const selector = this.options.tableSelector ?? './/div[contains(@class,"css-table-responsive")]';
        return this.works([
            [w => Promise.reject('Wrapper is required!'), w => !this._wrapper],
            [w => this._wrapper.findElements(By.xpath(selector))],
            [w => Promise.resolve(this._rows = w.res[0]), w => w.getRes(1).length],
            [w => Promise.resolve(delete this._rows), w => !w.getRes(1).length],
        ]);
    }

    /**
     * Get data rows on page.
     *
     * @returns {Promise<WebElement[]>}
     */
    getRows() {
        return this.works([
            [w => this._rows.findElements(By.xpath('.//table/tbody/tr')), w => this._rows],
            [w => Promise.resolve([]), w => !this._rows],
        ]);
    }
}

module.exports = SipdComponentDataRow;