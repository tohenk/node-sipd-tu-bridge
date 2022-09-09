/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022 Toha <tohenk@yahoo.com>
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

const { By } = require('selenium-webdriver');
const Queue = require('@ntlab/work/queue');

class DataTable {

    constructor(owner) {
        this.owner = owner;
        this.owner.constructor.expectErr(DataTableStopError);
    }

    setup(options) {
        return this.owner.works([
            [w => Promise.reject('Data table wrapper element not specified!'), w => !options.wrapper],
            [w => this.owner.findElement(options.wrapper)],
            [w => Promise.resolve(this._wrapper = w.getRes(1))],
            [w => this._wrapper.findElement(options.search), w => options.search],
            [w => Promise.resolve(this._search = w.getRes(3)), w => options.search],
            [w => this._wrapper.findElement(options.pager), w => options.pager],
            [w => Promise.resolve(this._pager = w.getRes(5)), w => options.pager],
            [w => this.waitProcessing()],
        ]);
    }

    isProcessing() {
        return this.owner.works([
            [w => this._wrapper.findElements(By.xpath('.//div[@class="dataTables_processing"]'))],
            [w => Promise.resolve(false), w => w.getRes(0).length == 0],
            [w => w.getRes(0)[0].isDisplayed(), w => w.getRes(0).length > 0],
        ]);
    }

    waitProcessing() {
        return new Promise((resolve, reject) => {
            const f = () => {
                setTimeout(() => {
                    this.isProcessing()
                        .then(processing => {
                            if (processing) {
                                f();
                            } else {
                                resolve();
                            }
                        })
                    ;
                }, 500);
            }
            f();
        });   
    }

    getPage() {
        return this.owner.works([
            [w => Promise.reject('Pager element not specified!'), w => !this._pager],
            [w => this._pager.findElement(By.xpath('.//*[contains(@class,"paginate_button") and (contains(@class,"current") or contains(@class,"active"))]'))],
            [w => w.getRes(1).getAttribute('innerText')],
            [w => Promise.resolve(parseInt(w.getRes(2)))],
        ]);
    }

    getPages() {
        return this.owner.works([
            [w => Promise.reject('Pager element not specified!'), w => !this._pager],
            [w => this._pager.findElements(By.xpath('.//*[contains(@class,"paginate_button") and not (contains(@class,"previous") or contains(@class,"next"))]'))],
            [w => w.getRes(1)[w.getRes(1).length - 1].getAttribute('innerText'), w => w.getRes(1).length],
            [w => Promise.resolve(parseInt(w.getRes(2))), w => w.getRes(1).length],
            [w => Promise.resolve(0), w => w.getRes(1).length == 0],
        ]);
    }

    gotoPage(page) {
        return this.owner.works([
            [w => Promise.reject('Pager element not specified!'), w => !this._pager],
            [w => this._pager.findElement(By.xpath('.//*[contains(@class,"paginate_button") and text()="_X_"]'.replace(/_X_/, page)))],
            [w => w.getRes(1).click()],
            [w => this.waitProcessing()],
        ]);
    }

    eachPage(page, onwork) {
        return this.owner.works([
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
                        this.owner.works(works)
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
        return this._wrapper.findElements(By.xpath('.//table/tbody/tr[@role="row"]'));
    }

    search(term) {
        return this.owner.works([
            [w => Promise.reject('Search element not specified!'), w => !this._search],
            [w => this._search.sendKeys(term)],
            [w => this.owner.sleep(this.owner.opdelay)],
            [w => this.waitProcessing()],
            [w => this.owner.sleep(this.owner.opdelay)],
            [w => this.getRows()],
            [w => Promise.resolve(w.res.length > 0)],
        ]);
    }

    each(callback) {
        return this.owner.works([
            [w => this.getRows()],
            [w => this.getPages(), w => w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                const pages = Array.from({length: w.getRes(1)}, (x, i) => i + 1);
                const q = new Queue(pages, page => {
                    this.eachPage(page, callback)
                        .then(() => q.next())
                        .catch(err => {
                            if (err instanceof DataTableStopError) {
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
        return new DataTableStopError();
    }
}

class DataTableStopError extends Error
{
}

module.exports = DataTable;