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
    CAPTCHA_MODAL = '//div[contains(@class,"chakra-modal__body")]/h4[contains(text(),"CAPTCHA")]/..'

    state = {}

    initialize() {
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.year = this.options.year || new Date().getFullYear();
        super.constructor.expectErr(SiapAnnouncedError);
    }

    setState(states) {
        let updated = false;
        Object.keys(states).forEach(s => {
            const nval = states[s];
            const oval = this.state[s];
            if (nval !== oval) {
                this.state[s] = nval;
                if (!updated) {
                    updated = true;
                }
            }
        });
        if (updated && typeof this.onState === 'function') {
            this.onState(this);
        }
    }

    stop() {
        return this.works([
            [w => this.close()],
            [w => Promise.resolve(this.state = {})],
            [w => new Promise((resolve, reject) => setTimeout(() => resolve(), this.opdelay))],
        ]);
    }

    login(username, password, role, force = false) {
        return this.works([
            [w => this.gotoPenatausahaan()],
            [w => this.isLoggedIn()],
            [w => this.logout(), w => force],
            [w => this.waitFor(By.xpath(this.LOGIN_FORM)), w => force || !w.getRes(1)],
            [w => this.fillInForm([
                    {parent: w.res, target: By.xpath('.//label[text()="Tahun"]/../div/div/div/div[2]/input[@role="combobox"]'), value: this.year, onfill: (el, value) => this.reactSelect(el, value, 'Tahun anggaran tidak tersedia!')},
                    {parent: w.res, target: By.id('ed_username'), value: username},
                    {parent: w.res, target: By.id('ed_password'), value: password},
                ],
                By.xpath(this.LOGIN_FORM),
                By.xpath('//button[@type="submit"]')), w => force || !w.getRes(1)],
            [w => this.waitForProcessing(w.getRes(4), By.xpath('.//svg')), w => force || !w.getRes(1)],
            [w => this.selectAccount(role), w => force || !w.getRes(1)],
            [w => this.waitCaptcha(), w => force || !w.getRes(1)],
            [w => this.waitLoader(), w => force || !w.getRes(1)],
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

    waitCaptcha() {
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => this.waitSolvedCaptcha(), w => w.getRes(0).length],
        ]);
    }

    waitSolvedCaptcha() {
        return this.works([
            [w => Promise.resolve(console.log('Awaiting captcha to be solved...'))],
            [w => Promise.resolve(this.setState({captcha: true}))],
            [w => this.waitForPresence(By.xpath(this.CAPTCHA_MODAL), false, 0)],
            [w => this.waitSpinner(w.getRes(2))],
            [w => Promise.resolve(this.setState({captcha: false}))],
        ]);
    }

    captchaImage() {
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => w.getRes(0)[0].findElement(By.xpath('.//img')), w => w.getRes(0).length],
            [w => w.getRes(1).getAttribute('src'), w => w.getRes(0).length],
        ]);
    }

    solveCaptcha(code) {
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => w.getRes(0)[0].findElements(By.xpath('.//input[@data-index]')), w => w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                const q = new Queue(w.getRes(1), el => {
                    this.works([
                        [x => el.getAttribute('data-index')],
                        [x => el.sendKeys(code.substr(parseInt(x.getRes(0)), 1))],
                        [x => this.sleep(10)],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            }), w => w.getRes(0).length],
        ]);
    }

    gotoPenatausahaan() {
        return this.works([
            [w => this.getDriver().getCurrentUrl()],
            [w => Promise.resolve(w.getRes(0).indexOf('landing') > 0)],
            [w => this.waitAndClick(By.xpath('//h1[text()="INFORMASI KEUANGAN DAERAH"]/../button[text()="Selengkapnya"]')), w => w.getRes(1)],
            [w => this.waitAndClick(By.xpath('//div/p[text()="Penatausahaan Keuangan Daerah"]/../../button[text()="Pilih Modul Ini"]')), w => w.getRes(1)],
            [w => this.waitAndClick(By.xpath('//div/p[text()="SIPD RI"]/../../button[text()="Masuk"]')), w => w.getRes(1)],
            [w => this.getDriver().getWindowHandle(), w => w.getRes(1)],
            [w => this.getDriver().getAllWindowHandles(), w => w.getRes(1)],
            [w => new Promise((resolve, reject) => {
                const handle = w.getRes(5);
                const handles = w.getRes(6);
                if (handles.indexOf(handle) >= 0) {
                    handles.splice(handles.indexOf(handle), 1);
                }
                if (handles.length) {
                    resolve(handles[0]);
                } else {
                    reject('No opened window');
                }
            }), w => w.getRes(1)],
            [w => this.getDriver().switchTo().window(w.getRes(7)), w => w.getRes(1)],
        ]);
    }

    isLoggedIn() {
        return this.works([
            [w => this.getDriver().getCurrentUrl()],
            [w => Promise.resolve(w.getRes(0).indexOf('login') > 0)],
            [w => this.waitLoader(), w => w.getRes(1)],
            [w => this.findElements(By.xpath(this.LOGIN_FORM)), w => w.getRes(1)],
            [w => Promise.resolve(w.getRes(1) && w.getRes(3).length > 0 ? false : true)],
        ]);
    }

    selectAccount(role) {
        return this.works([
            [w => this.waitFor(By.xpath('//div[@class="container-account-select"]'))],
            [w => w.getRes(0).findElement(By.xpath(`.//div[@class="account-select-card"]/div/div/h1[text()="${role}"]/../../../button`))],
            [w => w.getRes(1).click()],
            [w => this.waitSpinner(w.getRes(0))],
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
            [w => el.click()],
            [w => el.getAttribute('aria-controls')],
            [w => this.findElements(By.xpath(`//*[@id="${w.getRes(1)}"]/div[contains(text(),"${value}")]`))],
            [w => Promise.reject(SiapAnnouncedError.create(util.format(message ? message : 'Pilihan %s tidak tersedia!', value))), w => w.getRes(2).length === 0],
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
        return this.waitForPresence(By.xpath('//div[@class="container-rendering"]'));
    }

    waitSpinner(el) {
        return this.waitForProcessing(el, By.xpath('.//div[contains(@class,"chakra-spinner")]'));
    }

    waitForProcessing(el, data) {
        return this.waitForPresence({el: el, data: data});
    }

    /**
     * Wait an element until its presence or gone.
     *
     * @param {object|By} data Element to wait for
     * @param {WebElement} data.el Parent element
     * @param {By} data.data Element selector
     * @param {boolean} presence Presence state
     * @param {number} time Wait time
     * @returns {Promise<WebElement>}
     */
    waitForPresence(data, presence = true, time = null) {
        if (null === time) {
            time = this.wait;
        }
        return new Promise((resolve, reject) => {
            let res;
            const t = Date.now();
            const f = () => {
                this.works([
                    [w => this.isStale(data.el), w => data.el],
                    [w => Promise.resolve(false), w => data.el && w.getRes(0)],
                    [w => this.findElements(data), w => !w.getRes(0)],
                    [w => new Promise((resolve, reject) => {
                        let wait = presence ? w.res.length === 0 : w.res.length > 0;
                        // is it timed out?
                        if (wait && time > 0 && Date.now() - t > time) {
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
                        setTimeout(() => resolve(res), this.opdelay);
                    }
                });
            }
            f();
        });
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