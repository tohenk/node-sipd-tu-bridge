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

const Queue = require('@ntlab/work/queue');
const SipdUtil = require('../../sipd/util');
const { Sipd } = require('../../sipd');
const { SipdVoterActivity } = require('./query');
const { By } = require('selenium-webdriver');

const dtag = 'activity';

/**
 * Activity selector helper.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdActivitySelector {

    /**
     * @type {Sipd}
     */
    parent = null

    constructor(parent) {
        this.parent = parent;
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

    select(value) {
        let fulfilled = false;
        return this.parent.works([
            [w => this.parent.waitForPresence(this.loadingSelector, {presence: false, timeout: 0})],
            [w => this.parent.waitAndClick(this.clicker), w => this.clicker],
            [w => this.parent.findElements(this.listSelector)],
            [w => new Promise((resolve, reject) => {
                const items = w.res;
                const q = new Queue(items, item => {
                    let itemText;
                    this.parent.works([
                        [x => item.getAttribute('innerText')],
                        [x => Promise.resolve(SipdUtil.pickKeg(x.getRes(0)))],
                        [x => Promise.resolve(SipdUtil.matchKeg(x.getRes(1), value))],
                        [x => item.findElement(this.chooseSelector), x => x.getRes(2)],
                        [x => x.getRes(3).click(), x => x.getRes(2)],
                        [x => Promise.resolve(fulfilled = true), x => x.getRes(2)],
                        [x => Promise.resolve(itemText = x.getRes(1))],
                    ])
                    .then(() => {
                        this.parent.debug(dtag)(`Fill activity: ${itemText}, done = ${fulfilled ? 'yes' : 'no'}`);
                        if (fulfilled) {
                            q.done();
                        } else {
                            q.next();
                        }
                    })
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
            [w => Promise.reject(`Unable to fill activity ${value}!`), w => !fulfilled],
            [w => this.parent.sleep(this.parent.opdelay), w => fulfilled],
        ]);
    }
}

/**
 * Activity selector for SPP.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdSppActivitySelector extends SipdActivitySelector {

    initialize() {
        this.clicker = By.xpath('//div[@class="css-j-3jq-af-a2fa"]');
        this.listSelector = By.xpath('//div[@class="css-j03r-a-cf3fa"]/div/span/div/span[2]');
    }
}

/**
 * Activity selector for NPD Keg.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdNpdKegActivitySelector extends SipdActivitySelector {

    initialize() {
        this.listSelector = By.xpath('//div[contains(@class,"css-Sj-ej-fe3f0j")]/div/span/div/span[2]');
    }
}

/**
 * Activity selector for NPD Sub Keg.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdNpdSubKegActivitySelector extends SipdActivitySelector {

    select(value) {
        const voter = new SipdVoterActivity(this.parent, {value});
        return voter.walk();
    }
}

module.exports = {
    SipdActivitySelector,
    SipdSppActivitySelector,
    SipdNpdKegActivitySelector,
    SipdNpdSubKegActivitySelector,
}
