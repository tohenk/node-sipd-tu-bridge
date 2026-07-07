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

const SipdQueue = require('../app/queue');
const SipdSession = require('.');
const { SipdQueryRekanan } = require('./query/rekanan');
const { By } = require('selenium-webdriver');

/**
 * Provides Rekanan functionality.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRekananSession extends SipdSession {

    /**
     * Create partner.
     *
     * @param {SipdQueue} queue Queue
     * @param {boolean} forceEdit 
     * @returns {Promise<any>}
     */
    createRekanan(queue, forceEdit = false) {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.doQuery(new SipdQueryRekanan(this.sipd, queue, {navigates: ['Pengeluaran', 'Daftar Rekanan']}))],
            [w => this.sipd.gotoPageTop(), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//button[text()="Tambah Rekanan"]')), w => !w.getRes(0) && allowChange],
            [w => queue.values.action.click(), w => w.getRes(0) && forceEdit && allowChange],
            [w => this.fillForm(queue, 'rekanan',
                By.xpath('//h1/span[text()="Tambah Rekanan"]/../../../..'),
                By.xpath('//button[text()="Konfirmasi"]')), w => (!w.getRes(0) || forceEdit) && allowChange],
            [w => this.sipd.confirmSubmission(By.xpath('//section/footer/button[1]'), {spinner: true}), w => (!w.getRes(0) || forceEdit) && allowChange],
        ]);
    }

    /**
     * List partner.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<object[]>}
     */
    listRekanan(queue) {
        const query = new SipdQueryRekanan(this.sipd, queue, {navigates: ['Pengeluaran', 'Daftar Rekanan']});
        const f = (el, values, result) => {
            queue.values = {};
            const actionCol = query.columns.find(column => column.type === SipdColumnQuery.COL_ACTION);
            return this.works([
                [w => values[actionCol.name].getAttribute('href')],
                [w => this.sipd.doOpenInNewTab(w.getRes(0), [
                    [x => this.fillForm(queue, 'rekanan',
                        By.xpath('//h1/span[text()="Tambah Rekanan"]/../../../..'),
                        By.xpath('//button[text()="Kembali"]'))],
                    [x => Promise.resolve(queue.values)],
                ])],
            ], {alwaysResolved: true});
        }
        query.actionEnabled = true;
        return this.doQuery(query, f);
    }
}

module.exports = SipdRekananSession;