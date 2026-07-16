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

const { SipdVoter } = require('.');
const { SipdColumnQuery } = require('../../sipd/query');
const { By } = require('selenium-webdriver');
const SipdUtil = require('../../sipd/util');

/**
 * Handles activity selection.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdVoterActivity extends SipdVoter {

    doInitialize() {
        this.options.title = 'Sub Kegiatan';
        this.pageOptions = {
            tableSelector: './/div[1]',
            paginationSelector: './/div[1]',
            onrow: el => new Promise((resolve, reject) => {
                // accepts only data row which has at least 2 columns
                el.findElements(By.xpath('.//td'))
                    .then(td => {
                        resolve(td.length > 1 ? true : false);
                    });
            }),
        }
        this.defaultColumns = {
            keg: [1, SipdColumnQuery.COL_ICON2],
            action: [2, SipdColumnQuery.COL_ACTION],
        }
        this.diffs = [
            ['keg', this.data.value, SipdUtil.matchKeg],
        ];
    }
}

module.exports = { SipdVoterActivity };