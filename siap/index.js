/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2024 Toha <tohenk@yahoo.com>
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

const util = require('util');
const Queue = require('@ntlab/work/queue');
const WebRobot = require('@ntlab/webrobot');
const { By, error } = require('selenium-webdriver');
const debug = require('debug')('siap:core');

class Siap extends WebRobot {

    LOGIN_FORM = '//div[contains(@class,"auth-box")]/form'

    initialize() {
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.year = this.options.year || new Date().getFullYear();
        super.constructor.expectErr(SiapAnnouncedError);
    }

    // https://stackoverflow.com/questions/642125/encoding-xpath-expressions-with-both-single-and-double-quotes
    escapeStr(s) {
        if (typeof s !== 'string') {
            s = '' + s;
        }
        // does not contain double quote
        if (s.indexOf('"') < 0) {
            return `"${s}"`;
        }
        // does not contain single quote
        if (s.indexOf('\'') < 0) {
            return `'${s}'`;
        }
        // contains both, escape single quote
        return `concat('${s.replace(/'/g, '\', "\'", \'')}')`;
    }

    stop() {
        return this.works([
            [w => this.close()],
            [w => new Promise((resolve, reject) => setTimeout(() => resolve(), this.opdelay))],
        ]);
    }

    isLoggedIn() {
        return this.works([
            [w => this.findElements(By.xpath(this.LOGIN_FORM))],
            [w => Promise.resolve(w.getRes(0).length > 0 ? false : true)],
        ]);
    }

    login(username, password, role) {
        return this.works([
            [w => this.isLoggedIn()],
            [w => this.logout(), w => w.getRes(0)],
            [w => this.waitFor(By.xpath(this.LOGIN_FORM))],
            [w => this.fillInForm([
                    {parent: w.res, target: By.name('tahun'), value: this.year, onfill: (el, value) => this.reactSelect(el, value, 'Tahun anggaran tidak tersedia!')},
                    {parent: w.res, target: By.name('username'), value: username},
                    {parent: w.res, target: By.name('password'), value: password},
                    {parent: w.res, target: By.xpath('.//input[@type="checkbox"]'), value: false, onfill: (el, value) => this.clickCheckbox(el, value)},
                ],
                By.xpath(this.LOGIN_FORM),
                By.xpath('//button[@type="submit"]'))],
            [w => this.waitForProcessing(w.getRes(3), By.xpath('.//svg'))],
            [w => this.selectAccount(role)],
            [w => this.dismissUpdate()],
        ]);
    }

    logout() {
        return this.works([
            [w => this.getDriver().getCurrentUrl()],
            [w => this.dismissUpdate(), w => w.getRes(0).indexOf('login') < 0],
            [w => this.navigate('Keluar'), w => w.getRes(0).indexOf('login') < 0],
        ]);
    }

    selectAccount(role) {
        return this.works([
            [w => this.waitFor(By.xpath('//div[@class="container-account-select"]'))],
            [w => w.getRes(0).findElement(By.xpath(`.//div[@class="account-select-card"]/div/div/h1[text()="${role}"]/../../../button`))],
            [w => w.getRes(1).click()],
            [w => this.waitForProcessing(w.getRes(0), By.xpath('.//div[contains(@class,"chakra-spinner")]'))],
        ]);
    }

    dismissUpdate() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//h1[contains(@class,"css-nwjwe-j2aft") and text()="Pembaruan"]'))],
            [w => this.findElement(By.xpath('//button[text()="Sembunyikan"]')), w => w.getRes(0)],
            [w => w.getRes(1).click(), w => w.getRes(0)],
        ]);
    }

    reactSelect(el, value, message = null) {
        return this.works([
            [w => el.findElement(By.xpath('./../div[contains(@class,"select__control")]'))],
            [w => w.res.click()],
            [w => el.findElements(By.xpath(`./..//div[contains(@class,"select__menu")]/div/div[contains(text(),${this.escapeStr(value)})]`))],
            [w => Promise.reject(SiapAnnouncedError.create(util.format(message ? message : 'Pilihan %s tidak tersedia!', value))), w => !w.getRes(2).length],
            [w => w.getRes(2)[0].click(), w => w.getRes(2).length],
        ]);
    }

    clickCheckbox(el, value) {
        return this.works([
            [w => el.getAttribute('checked')],
            [w => el.findElement(By.xpath('..')), w => w.getRes(0) != value],
            [w => w.getRes(1).click(), w => w.getRes(0) != value],
        ]);
    }

    waitLoader() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//div[@class="container-rendering"]'))],
            [w => this.sleep(this.opdelay)],
        ]);
    }

    waitForProcessing(el, data) {
        return this.works([
            [w => this.sleep(this.opdelay)],
            [w => this.waitForPresence({el: el, data: data})],
        ]);
    }

    /**
     * Wait an element until its presence.
     *
     * @param {object|By} data Element to wait for
     * @param {WebElement} data.el Parent element
     * @param {By} data.data Element selector
     * @param {number} time Wait time
     * @returns {Promise<WebElement>}
     */
    waitForPresence(data, time = null) {
        if (null === time) {
            time = this.wait;
        }
        return new Promise((resolve, reject) => {
            let res, shown = false;
            const t = Date.now();
            const f = () => {
                this.works([
                    [w => this.isStale(data.el), w => data.el],
                    [w => Promise.resolve(false), w => data.el && w.getRes(0)],
                    [w => this.findElements(data), w => !w.getRes(0)],
                    [w => new Promise((resolve, reject) => {
                        let wait = shown ? w.res.length === 0 : true;
                        // is timed out
                        if (wait && Date.now() - t > time) {
                            wait = false;
                        }
                        if (w.res.length) {
                            res = w.res[0];
                        }
                        resolve(wait);
                    }), w => !w.getRes(0)],
                ])
                .then(result => {
                    if (result) {
                        setTimeout(f, 100);
                    } else {
                        resolve(res);
                    }
                })
                .catch(err => {
                    if (err instanceof error.StaleElementReferenceError) {
                        resolve(res);
                    } else {
                        reject(err);
                    }
                });
            }
            f();
        });
    }

    /**
     * Navigate sidebar menus.
     *
     * @param  {...string} menus Menus
     * @returns Promise
     */
    navigate(...menus) {
        return new Promise((resolve, reject) => {
            let restart;
            const dep = (s, n) => Array.from({length: n}, () => s).join('/');
            const f = () => {
                restart = false;
                let res, level = 0, length = menus.length;
                const items = [...menus];
                const q = new Queue(items, menu => {
                    let root, selector, parent = res ? res : this.getDriver(), n = 3;
                    const last = ++level === length;
                    switch (level) {
                        case 1:
                            root = '//div[@class="simplebar-content"]/ul/li';
                            break;
                        case 2:
                            root = './../div[@class="ReactCollapse--collapse"]/div[@class="ReactCollapse--content"]/div/div/div/div';
                            if (!last) {
                                n = 4;
                            }
                            break;
                        case 3:
                            root = './../../../div/div[@class="ReactCollapse--collapse"]/div[@class="ReactCollapse--content"]/div';
                            break;
                        default:
                            root = './../../../../div/div[@class="ReactCollapse--collapse"]/div[@class="ReactCollapse--content"]/div';
                            n = 4;
                            break;
                    }
                    selector = `/a/${dep('*', n)}[text()="${menu}"]`;
                    debug(`Menu: ${level} ${root + selector}`);
                    let clicked = false;
                    this.works([
                        [w => parent.findElement(By.xpath(root + selector))],
                        [w => w.getRes(0).findElement(By.xpath(dep('..', n)))],
                        [w => w.getRes(0).getAttribute('class')],
                        [w => w.getRes(1).getAttribute('class')],
                        [w => Promise.resolve(level > 1 ? w.getRes(2) : w.getRes(3))],
                        [w => w.getRes(1).click(), w => w.getRes(4).indexOf('false') >= 0],
                        [w => Promise.resolve(clicked = true), w => w.getRes(4).indexOf('false') >= 0],
                        [w => Promise.resolve(res = w.getRes(1))],
                    ])
                    .then(() => {
                        if (clicked && !last) {
                            restart = true;
                            q.done();
                        } else {
                            q.next();
                        }
                    })
                    .catch(err => reject(err));
                });
                q.once('done', () => {
                    if (restart) {
                        f();
                    } else {
                        resolve(res)
                    }
                });
            }
            f();
        });
    }
}

class SiapAnnouncedError extends Error {

    toString() {
        return this.message;
    }

    [util.inspect.custom](depth, options, inspect) {
        return this.toString();
    }

    static create(message, queue = null) {
        const err = new SiapAnnouncedError(message);
        if (queue) {
            err._queue = queue;
        }
        return err;
    }
}

module.exports = {Siap, SiapAnnouncedError};