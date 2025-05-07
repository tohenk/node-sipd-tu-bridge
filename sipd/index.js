/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
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
const debug = require('debug')('sipd:core');

class Sipd extends WebRobot {

    LOGIN_FORM = '//div[contains(@class,"auth-box")]/form'
    CAPTCHA_MODAL = '//div[contains(@class,"chakra-modal__body")]/h4[contains(text(),"CAPTCHA")]/..'

    state = {}

    initialize() {
        this.safeTextArea = false;
        this.year = this.options.year || new Date().getFullYear();
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.typedelay = this.options.typedelay || 5;
        this.loopdelay = this.options.loopdelay || 25;
        super.constructor.expectErr(SipdAnnouncedError);
        super.constructor.expectErr(SipdRetryError);
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
        return new Promise((resolve, reject) => {
            this.works([
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
                [w => this.waitSidebar()],
                [w => this.dismissUpdate()],
            ])
            .then(() => resolve())
            .catch(err => reject(new SipdRetryError(err instanceof Error ? err.message : err)));
        });
    }

    logout() {
        return this.works([
            [w => this.getDriver().getCurrentUrl()],
            [w => this.dismissUpdate(), w => w.getRes(0).indexOf('login') < 0],
            [w => this.navigate('Keluar'), w => w.getRes(0).indexOf('login') < 0],
        ]);
    }

    handlePageLoad() {
        return this.getDriver().sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
            source: this.getHelperScript(),
        });
    }

    clearMessages() {
        return this.getDriver().executeScript('clearSipdMessages()');
    }

    getLastMessage() {
        return this.getDriver().executeScript('return getSipdLastMessage()');
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
            [w => new Promise((resolve, reject) => {
                const f = () => {
                    w.getRes(0)[0].findElements(By.xpath('.//img'))
                        .then(elements => {
                            if (elements.length) {
                                resolve(elements[0]);
                            } else {
                                setTimeout(f, this.loopdelay);
                            }
                        })
                        .catch(err => reject(err));
                }
                f();
            }), w => w.getRes(0).length],
            [w => w.getRes(1).getAttribute('src'), w => w.getRes(0).length],
        ]);
    }

    solveCaptcha(code) {
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => this.clearMessages(), w => w.getRes(0).length],
            [w => w.getRes(0)[0].findElements(By.xpath('.//input[@data-index]')), w => w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                const q = new Queue(w.getRes(2), el => {
                    this.works([
                        [x => el.getAttribute('data-index')],
                        [x => el.sendKeys(code.substr(parseInt(x.getRes(0)), 1))],
                        [x => this.sleep(this.typedelay)],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            }), w => w.getRes(0).length],
            [w => this.sleep(this.opdelay), w => w.getRes(0).length],
            [w => this.getLastMessage(), w => w.getRes(0).length],
            [w => Promise.resolve(null === w.getRes(5) || !w.getRes(5).includes('invalid') ? true : false), w => w.getRes(0).length],
        ]);
    }

    reloadCaptcha() {
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => w.getRes(0)[0].findElements(By.xpath('.//div[@class="custom-tippy"]')), w => w.getRes(0).length],
            [w => w.getRes(1)[0].click(), w => w.getRes(0).length],
        ]);
    }

    cancelCaptcha() {
        if (this.state.captcha) {
            return this.waitAndClick(By.xpath('//footer/button[2]/span/span[text()="Batalkan"]/../..'));
        } else {
            return Promise.resolve();
        }
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
            [w => this.getDriver().executeScript(this.getHelperScript()), w => w.getRes(1)],
            [w => this.waitPage(), w => w.getRes(1)],
        ]);
    }

    isLoggedIn() {
        return this.works([
            [w => this.waitLoader()],
            [w => this.findElements(By.xpath(this.LOGIN_FORM))],
            [w => Promise.resolve(w.getRes(1).length > 0 ? false : true)],
        ]);
    }

    selectAccount(role) {
        return this.works([
            [w => this.waitFor(By.xpath('//div[@class="container-account-select"]'))],
            [w => w.getRes(0).findElement(By.xpath(`.//div[@class="container-txt-account-list"]/h1[text()="${role}"]/../../../button`))],
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
            [w => this.findElement(By.id(w.getRes(1)))],
            [w => w.getRes(2).findElements(By.xpath(`.//*[contains(.,"${value}")]`))],
            [w => Promise.reject(SipdAnnouncedError.create(util.format(message ? message : 'Pilihan %s tidak tersedia!', value))), w => w.getRes(3).length === 0],
            [w => w.getRes(3)[0].click(), w => w.getRes(3).length],
        ]);
    }

    clickCheckbox(el, value) {
        return this.works([
            [w => el.getAttribute('checked')],
            [w => el.findElement(By.xpath('..')), w => w.getRes(0) != value],
            [w => w.getRes(1).click(), w => w.getRes(0) != value],
        ]);
    }

    clickWait(el) {
        return this.works([
            [w => el.click()],
            [w => this.sleep(this.opdelay)],
        ]);
    }

    clickExpanded(el) {
        let click = true;
        return new Promise((resolve, reject) => {
            const f = () => {
                this.works([
                    [w => this.clickWait(el), w => click],
                    [w => el.getAttribute('aria-expanded')],
                ])
                .then(res => {
                    click = false;
                    if (res === 'true') {
                        resolve();
                    } else {
                        setTimeout(f, this.loopdelay);
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });
    }

    waitPage() {
        return this.waitForPresence(By.id('cw-wwwig-gw'));
    }

    waitSidebar() {
        return this.waitForPresence(By.xpath('//div[@class="simplebar-content"]/ul/div/div[contains(@class,"animate-pulse")]'), false, 0);
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
                        setTimeout(f, this.loopdelay);
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
        return this.works([
            [w => this.waitSidebar()],
            [w => new Promise((resolve, reject) => {
                let restart;
                const dep = (s, n) => Array.from({length: n}, () => s).join('/');
                const f = () => {
                    restart = false;
                    let res, level = 0, length = menus.length;
                    const q = new Queue([...menus], menu => {
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
                                n = 4;
                                break;
                        }
                        let clicked = false;
                        this.works([
                            [w => parent.findElements(By.xpath(root)), w => level === 3],
                            [w => Promise.resolve(--n), w => level === 3 && w.getRes(0).length === 1],
                            [w => Promise.resolve(selector = `/a/${dep('*', n)}[text()="${menu}"]`)],
                            [w => Promise.resolve(debug(`Menu: ${level} ${root + selector}`))],
                            [w => parent.findElement(By.xpath(root + selector))],
                            [w => w.getRes(4).findElement(By.xpath(dep('..', n)))],
                            [w => w.getRes(4).getAttribute('class')],
                            [w => w.getRes(5).getAttribute('class')],
                            [w => Promise.resolve(level > 1 ? w.getRes(6) : w.getRes(7))],
                            [w => w.getRes(5).click(), w => w.getRes(8).indexOf('false') >= 0],
                            [w => Promise.resolve(clicked = true), w => w.getRes(8).indexOf('false') >= 0],
                            [w => Promise.resolve(res = w.getRes(5))],
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
            })],
        ]);
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

    getHelperScript() {
        return `
            if (window._xhelper === undefined) {
                window._xstates = {};
                window._xhelper = [
                    {
                        selector: '.css-af-eg-kw3g21',
                        callback(el) {
                            window._xstates.loading = el ? true : false;
                            return window._xstates.loading;
                        }
                    },
                    {
                        selector: '#_rht_toaster',
                        callback(el) {
                            window._xlog(el);
                            return false;
                        }
                    }
                ];
                window._xobserve = (el, cb) => {
                    const observer = new MutationObserver(mutations => {
                        mutations.forEach(mutation => {
                            if (mutation.type === 'childList' && mutation.target === el) {
                                cb(mutation);
                            }
                        });
                    });
                    observer.observe(el, {attributes: false, childList: true, subtree: true});
                    return observer;
                }
                window._xlog = el => {
                    if (el) {
                        const observer = window._xobserve(el, () => {
                            if (window._xlogs === undefined) {
                                window._xlogs = [];
                            }
                            const status = el.querySelector('div[role="status"]');
                            if (status) {
                                console.log(status.textContent);
                                window._xlogs.push(status.textContent);
                            }
                        });
                    }
                }
                window._xinit = () => {
                    const z = document.getElementById('ZEUS');
                    const o = window._xobserve(z, () => {
                        let idx = 0;
                        while (true) {
                            if (idx === window._xhelper.length) {
                                break;
                            }
                            const xh = window._xhelper[idx];
                            const el = document.querySelector(xh.selector);
                            if (typeof xh.callback === 'function') {
                                const retval = xh.callback(el);
                                if (retval) {
                                    idx++;
                                } else {
                                    window._xhelper.splice(idx, 1);
                                }
                            } else {
                                idx++;
                            }
                        }
                        if (window._xhelper.length === 0) {
                            o.disconnect();
                        }
                    });
                }
                window.isSipdLoading = () => {
                    return window._xstates && window._xstates.loading !== undefined ? window._xstates.loading : true;
                }
                window.getSipdMessages = () => {
                    return window._xlogs ? window._xlogs : [];
                }
                window.getSipdLastMessage = () => {
                    const messages = window.getSipdMessages();
                    return messages.length ? messages[messages.length - 1] : null;
                }
                window.clearSipdMessages = () => {
                    window._xlogs = [];
                }
                addEventListener('load', e => window._xinit());
            }`;
    }
}

class SipdAnnouncedError extends Error {

    toString() {
        return this.message;
    }

    [util.inspect.custom](depth, options, inspect) {
        return this.toString();
    }

    static create(message, queue = null) {
        const err = new SipdAnnouncedError(message);
        if (queue) {
            err._queue = queue;
        }
        return err;
    }
}

class SipdRetryError extends Error {
}

module.exports = {Sipd, SipdAnnouncedError, SipdRetryError};