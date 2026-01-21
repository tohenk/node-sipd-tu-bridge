/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025-2026 Toha <tohenk@yahoo.com>
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

class SipdActivitySelector {

    constructor() {
        /** @type {By} */
        this.clicker;
        /** @type {By} */
        this.listSelector;
        /** @type {By} */
        this.chooseSelector = By.xpath('../../../../div[2]/button');
        /** @type {By} */
        this.loadingSelector = By.xpath('//div[@class="animate-pulse"]');
        this.initialize();
    }

    initialize() {
    }
}

class SipdSppActivitySelector extends SipdActivitySelector {

    initialize() {
        this.clicker = By.xpath('//div[@class="css-j-3jq-af-a2fa"]');
        this.listSelector = By.xpath('//div[@class="css-j03r-a-cf3fa"]/div/span/div/span[2]');
    }
}

class SipdNpdKegActivitySelector extends SipdActivitySelector {

    initialize() {
        this.listSelector = By.xpath('//div[contains(@class,"css-Sj-ej-fe3f0j")]/div/span/div/span[2]');
    }
}

class SipdNpdSubKegActivitySelector extends SipdActivitySelector {

    initialize() {
        this.listSelector = By.xpath('//td[contains(@class,"table-td")]/div/span/div/span[2]');
        this.chooseSelector = By.xpath('../../../../../td[2]/div/button');
    }
}

module.exports = {
    SipdActivitySelector,
    SipdSppActivitySelector,
    SipdNpdKegActivitySelector,
    SipdNpdSubKegActivitySelector,
}
