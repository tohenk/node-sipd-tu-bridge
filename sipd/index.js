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
const SipdLogger = require('./logger');
const SipdUtil = require('./util');
const { By, error, WebElement } = require('selenium-webdriver');

const dtag = 'core';

/**
 * An SIPD automation using Selenium.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Sipd extends WebRobot {

    LOGIN_FORM = '//div[contains(@class,"auth-box")]/form'
    CAPTCHA_MODAL = '//div[contains(@class,"chakra-modal__body")]/h4[contains(text(),"CAPTCHA")]/..'

    SPINNER_CHAKRA = 'chakra-spinner'
    SPINNER_ANIMATE = 'animate-spin'

    state = {}

    initialize() {
        this.year = this.options.year || new Date().getFullYear();
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.typedelay = this.options.typedelay || 5;
        this.loopdelay = this.options.loopdelay || 25;
        super.constructor.expectErr(error.StaleElementReferenceError);
        super.constructor.expectErr(SipdAnnouncedError);
        super.constructor.expectErr(SipdRetryError);
    }

    /**
     * Create debugger.
     *
     * @param {string} tag Debug tag
     * @returns {Function}
     */
    debug(tag) {
        return SipdLogger.logger(tag, this.options.loginfo);
    }

    /**
     * Set states.
     *
     * @param {object} states The states
     */
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

    /**
     * Stop the work.
     *
     * @returns {Promise<any>}
     */
    stop() {
        return this.works([
            [w => this.close()],
            [w => Promise.resolve(this.state = {})],
            [w => new Promise((resolve, reject) => setTimeout(() => resolve(), this.opdelay))],
        ]);
    }

    /**
     * Login to SIPD Penatausahaan.
     *
     * @param {string} username Username
     * @param {string} password Password
     * @param {string} role User role
     * @param {boolean} force True to force re-login
     * @returns {Promise<any>}
     */
    login(username, password, role, force = false) {
        return new Promise((resolve, reject) => {
            this.works([
                [w => this.gotoPenatausahaan()],
                [w => this.isLoggedIn()],
                [w => this.logout(), w => force],
                [w => this.doLogin(username, password, role), w => force || !w.getRes(1)],
                [w => this.waitSidebar()],
                [w => this.dismissStatuses()],
                [w => this.checkMessages()],
                [w => this.dismissUpdate()],
            ])
            .then(() => resolve())
            .catch(err => reject(new SipdRetryError(err instanceof Error ? err.message : err)));
        });
    }

    /**
     * Perform login.
     *
     * @param {string} username Username
     * @param {string} password Password
     * @param {string|Array} role User role
     * @returns {Promise<any>}
     */
    doLogin(username, password, role) {
        return this.works([
            [w => this.formSubmit(
                By.xpath(this.LOGIN_FORM),
                By.xpath('//button[@type="submit"]'),
                [
                    {
                        target: By.xpath('.//label[text()="Tahun"]/../div/div/div/div[2]/input[@role="combobox"]'),
                        value: this.year,
                        onfill: (el, value) => this.reactSelect(el, value, 'Tahun anggaran tidak tersedia!')
                    },
                    {target: By.id('ed_username'), value: username},
                    {target: By.id('ed_password'), value: password},
                ],
                {spinner: true})],
            [w => this.selectAccount(role)],
            [w => this.waitCaptcha()],
            [w => this.waitLoader()],
        ]);
    }

    /**
     * Logout from SIPD Penatausahaan.
     *
     * @returns {Promise<any>}
     */
    logout() {
        return this.works([
            [w => this.driver.getCurrentUrl()],
            [w => this.dismissUpdate(), w => w.getRes(0).indexOf('login') < 0],
            [w => this.navigate('Keluar'), w => w.getRes(0).indexOf('login') < 0],
        ]);
    }

    /**
     * Clear SIPD messages.
     *
     * @returns {Promise<any>}
     */
    clearMessages() {
        return this.driver.executeScript('clearSipdMessages()');
    }

    /**
     * Get SIPD messages.
     *
     * @returns {Promise<string[]>}
     */
    getMessages() {
        return this.driver.executeScript('return getSipdMessages()');
    }

    /**
     * Get SIPD last message.
     *
     * @returns {Promise<string>}
     */
    getLastMessage() {
        return this.driver.executeScript('return getSipdLastMessage()');
    }

    /**
     * Get HTML representation on an element.
     *
     * @param {WebElement} el The element
     * @returns {Promise<string>}
     */
    getHtml(el) {
        return this.driver.executeScript('return arguments[0].outerHTML', el);
    }

    /**
     * Do submit form.
     *
     * @param {By} form Form element selector
     * @param {By} submit Form submit selector
     * @param {Array} values Form values
     * @param {object} options Submit options
     * @param {number} options.wait Wait timeout
     * @param {string|null} options.spinner Spinner class name
     * @param {number} options.retry Number of retry, default to once
     * @returns {Promise<WebElement>}
     */
    formSubmit(form, submit, values, options = null) {
        options = options || {};
        if (options.wait === undefined) {
            options.wait = 0;
        }
        return this.works([
            [w => this.sleep(this.opdelay)],
            [w => this.fillInForm(
                values,
                form,
                () => this.confirmSubmission(submit, options),
                {
                    wait: options.wait,
                    prefillCallback: form => this.waitSpinner(form),
                })],
            [w => this.sleep(this.opdelay)],
            [w => Promise.resolve(w.getRes(1))],
        ]);
    }

    /**
     * Do confirm submission.
     *
     * @param {By} clicker The confirm clicker
     * @param {object} options Submit options
     * @param {string} options.spinner Spinner class name
     * @param {number} options.retry Number of retry, default to once
     * @returns {Promise<WebElement>}
     */
    confirmSubmission(clicker, options = null) {
        options = options || {};
        const success = message => {
            return message === null ||
                message.toLowerCase().includes('berhasil') ||
                message.toLowerCase().includes('dibuat');
        }
        let retry = options.retry || 1;
        return new Promise((resolve, reject) => {
            const f = () => {
                retry--;
                this.works([
                    [w => this.clearMessages()],
                    [w => this.waitAndClick(clicker)],
                    [w => this.waitSpinner(w.getRes(1), typeof options.spinner === 'string' ? options.spinner : null), w => options.spinner],
                    [w => this.sleep(this.opdelay)],
                    [w => this.getLastMessage()],
                    [w => Promise.resolve(this.debug(dtag)('Form submit return', w.getRes(4))), w => w.getRes(4)],
                    [w => Promise.resolve(w.getRes(1)), w => success(w.getRes(4))],
                    [w => Promise.reject(w.getRes(4)), w => !w.getRes(6)],
                ])
                .then(res => resolve(res))
                .catch(err => {
                    if (retry === 0) {
                        reject(err);
                    } else {
                        this.debug(dtag)('Retrying form submit in %d ms...', this.wait);
                        setTimeout(f, this.wait);
                    }
                });
            }
            f();
        });
    }

    /**
     * Wait for captcha until it solved.
     *
     * @returns {Promise<any>}
     */
    waitCaptcha() {
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => this.waitSolvedCaptcha(), w => w.getRes(0).length],
        ]);
    }

    /**
     * Wait for captcha to be solved.
     *
     * @returns {Promise<any>}
     */
    waitSolvedCaptcha() {
        return this.works([
            [w => Promise.resolve(this.debug(dtag)('Awaiting captcha to be solved...'))],
            [w => Promise.resolve(this.setState({captcha: true}))],
            [w => this.waitForPresence(By.xpath(this.CAPTCHA_MODAL), {presence: false, timeout: 0})],
            [w => Promise.resolve(this.setState({captcha: false}))],
        ]);
    }

    /**
     * Get captcha image data.
     *
     * @returns {Promise<string>}
     */
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

    /**
     * Solve the captcha.
     *
     * @param {string} code Resolved captcha code
     * @returns {Promise<boolean>}
     */
    solveCaptcha(code) {
        code = SipdUtil.pickNumber(code);
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => w.getRes(0)[0].findElements(By.xpath('.//input[@data-index]')), w => w.getRes(0).length],
            [w => Promise.resolve(w.getRes(1).length === code.length), w => w.getRes(0).length],
            [w => this.clearMessages(), w => w.getRes(2)],
            [w => new Promise((resolve, reject) => {
                const q = new Queue(w.getRes(1), el => {
                    this.works([
                        [x => el.getAttribute('data-index')],
                        [x => el.sendKeys(code.substr(parseInt(x.getRes(0)), 1))],
                        [x => this.sleep(this.typedelay)],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            }), w => w.getRes(2)],
            [w => this.sleep(this.opdelay), w => w.getRes(2)],
            [w => this.getLastMessage(), w => w.getRes(2)],
            [w => Promise.resolve(null === w.getRes(6) || !w.getRes(6).includes('invalid') ? true : false), w => w.getRes(2)],
        ]);
    }

    /**
     * Reload captcha.
     *
     * @returns {Promise<WebElement>}
     */
    reloadCaptcha() {
        return this.works([
            [w => this.findElements(By.xpath(this.CAPTCHA_MODAL))],
            [w => w.getRes(0)[0].findElements(By.xpath('.//div[@class="custom-tippy"]')), w => w.getRes(0).length],
            [w => w.getRes(1)[0].click(), w => w.getRes(0).length],
        ]);
    }

    /**
     * Dismiss captcha.
     *
     * @returns {Promise<any>}
     */
    cancelCaptcha() {
        if (this.state.captcha) {
            return this.waitAndClick(By.xpath('//footer/button[2]/span/span[text()="Batalkan"]/../..'));
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Navigate to SIPD Penatausahaan main page.
     *
     * @returns {Promise<any>}
     */
    gotoPenatausahaan() {
        return this.works([
            [w => this.driver.getCurrentUrl()],
            [w => Promise.resolve(w.getRes(0).indexOf('landing') > 0)],
            [w => this.waitAndClick(By.xpath('//h1[text()="INFORMASI KEUANGAN DAERAH"]/../button[text()="Selengkapnya"]')), w => w.getRes(1)],
            [w => this.waitAndClick(By.xpath('//div/p[text()="Penatausahaan Keuangan Daerah"]/../../button[text()="Pilih Modul Ini"]')), w => w.getRes(1)],
            [w => this.waitAndClick(By.xpath('//div/p[text()="SIPD RI"]/../../button[text()="Masuk"]')), w => w.getRes(1)],
            [w => this.driver.getWindowHandle(), w => w.getRes(1)],
            [w => this.driver.getAllWindowHandles(), w => w.getRes(1)],
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
            [w => this.driver.switchTo().window(w.getRes(7)), w => w.getRes(1)],
            [w => this.driver.executeScript(this.getPageScript()), w => w.getRes(1)],
            [w => this.waitPage()],
        ]);
    }

    /**
     * Is user currently logged in?
     *
     * @returns {Promise<boolean>}
     */
    isLoggedIn() {
        return this.works([
            [w => this.waitLoader()],
            [w => this.findElements(By.xpath(this.LOGIN_FORM))],
            [w => Promise.resolve(w.getRes(1).length > 0 ? false : true)],
        ]);
    }

    /**
     * Confirm user role.
     *
     * @param {string|Array} role User role
     * @returns {Promise<any>}
     */
    selectAccount(role) {
        const idx = Array.isArray(role) ? role[1] : 0;
        role = Array.isArray(role) ? role[0] : role;
        return this.works([
            [w => this.waitFor(By.xpath('//div[@class="container-account-select"]'))],
            [w => this.findElements({el: w.getRes(0), data: By.xpath(`.//div[@class="container-txt-account-list"]/h1[text()="${role}"]/../../../button`)})],
            [w => w.getRes(1)[idx].click(), w => w.getRes(1).length],
            [w => this.waitSpinner(w.getRes(0)), w => w.getRes(1).length],
            [w => Promise.reject(`Unable to select account ${role}!`), w => !w.getRes(1).length],
        ]);
    }

    /**
     * Check for SIPD unoperational messages.
     *
     * @returns {Promise<any>}
     */
    checkMessages() {
        return this.works([
            [w => this.getMessages()],
            [w => new Promise((resolve, reject) => {
                for (const fail of ['gagal', 'failed']) {
                    for (const msg of w.getRes(0)) {
                        if (msg.includes(fail)) {
                            return reject(`SIPD Penatausahaan mengalami gangguan: ${msg}!`);
                        }
                    }
                }
                resolve();
            }), w => w.getRes(0).length],
        ]);
    }

    /**
     * Dismiss status notification.
     *
     * @returns {Promise<any>}
     */
    dismissStatuses() {
        return new Promise((resolve, reject) => {
            const f = () => {
                this.works([
                    [w => this.findElements(By.xpath('//div[@role="status"]'))],
                    [w => Promise.resolve(w.getRes(0).length ? true : false)],
                ])
                .then(res => {
                    if (res) {
                        setTimeout(f, this.loopdelay);
                    } else {
                        resolve();
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });
    }

    /**
     * Dismiss update notification.
     *
     * @returns {Promise<any>}
     */
    dismissUpdate() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//h1[contains(@class,"css-nwjwe-j2aft") and text()="Pembaruan"]'), {timeout: this.delay})],
            [w => this.findElement(By.xpath('//button[text()="Sembunyikan"]')), w => w.getRes(0)],
            [w => w.getRes(1).click(), w => w.getRes(0)],
        ]);
    }

    /**
     * Set React select value.
     *
     * @param {WebElement} el React select element
     * @param {string} value Selected value
     * @param {string|null} message An error message displayed when the value is unavailable
     * @returns {Promise<WebElement>}
     */
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

    /**
     * Set checkbox value.
     *
     * @param {WebElement} el The element
     * @param {boolean} value Checked state
     * @returns {Promise<WebElement>}
     */
    clickCheckbox(el, value) {
        return this.works([
            [w => el.getAttribute('checked')],
            [w => el.findElement(By.xpath('..')), w => w.getRes(0) != value],
            [w => w.getRes(1).click(), w => w.getRes(0) != value],
        ]);
    }

    /**
     * Click the element and wait for specified `opdelay` ms.
     *
     * @param {WebElement} el The element
     * @returns {Promise<any>}
     */
    clickWait(el) {
        return this.works([
            [w => el.click()],
            [w => this.sleep(this.opdelay)],
        ]);
    }

    /**
     * Click the element and wait until it's expanded.
     *
     * @param {WebElement} el The element
     * @returns {Promise<any>}
     */
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

    /**
     * Wait for SIPD Penatausahaan until the page is loaded.
     *
     * @param {number} reload Force reload page in second
     * @returns {Promise<any>}
     */
    waitPage(reload = 60) {
        return new Promise((resolve, reject) => {
            const f = () => {
                let restart = false;
                this.works([
                    [w => Promise.resolve(this.tmo = setTimeout(() => this.driver.navigate().refresh(), reload * 1000)),
                        w => reload > 0],
                    [w => this.waitForPresence(By.id('cw-wwwig-gw'), {presence: false, timeout: 0})],
                    [w => this.findElements(By.xpath('//button[text()="Muat Ulang Halaman"]'))],
                    [w => w.getRes(2)[0].click(), w => w.getRes(2).length],
                    [w => Promise.resolve(restart = true), w => w.getRes(2).length],
                ])
                .then(() => {
                    if (this.tmo !== undefined) {
                        clearTimeout(this.tmo);
                        delete this.tmo;
                    }
                    if (restart) {
                        setTimeout(f, 0);
                    } else {
                        resolve();
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });
    }

    /**
     * Wait for SIPD Penatausahaan until the sidebar is loaded.
     *
     * @returns {Promise<any>}
     */
    waitSidebar() {
        return this.waitForPresence(By.xpath('//div[@class="simplebar-content"]/ul/div/div[contains(@class,"animate-pulse")]'), {presence: false, timeout: 0});
    }

    /**
     * Wait for SIPD Penatausahaan until the content is loaded.
     *
     * @returns {Promise<any>}
     */
    waitLoader() {
        return this.waitForPresence(By.xpath('//div[@class="container-rendering"]'), {presence: false, timeout: 0});
    }

    /**
     * Wait for SIPD Penatausahaan until the spinner is done.
     *
     * @param {WebElement} el Spinner container element
     * @param {string|null} spinner Spinner class name
     * @returns {Promise<any>}
     */
    waitSpinner(el, spinner = null) {
        return this.waitForPresence({el, data: spinner ?? this.SPINNER_ANIMATE}, {presence: false, timeout: 0});
    }

    /**
     * Wait an element until it's presence or gone.
     *
     * @param {object|By} data Element to wait for
     * @param {WebElement} data.el Parent element
     * @param {By} data.data Element selector
     * @param {object} options The options
     * @param {boolean} options.presence Presence state
     * @param {number} options.timeout Wait time out
     * @returns {Promise<WebElement>}
     */
    waitForPresence(data, options = null) {
        options = options || {};
        if (options.presence === undefined) {
            options.presence = true;
        }
        if (options.timeout === undefined || options.timeout === null) {
            options.timeout = this.timeout;
        }
        // allows to wait for classname
        if (data.el && data.data && typeof data.data === 'string') {
            options.classname = data.data;
            data.data = By.xpath(`.//*[contains(@class,"${options.classname}")]`);
        }
        let target;
        if (data.data instanceof By) {
            target = data.data.value;
        } else if (data instanceof By) {
            target = data.value;
        } else {
            target = data;
        }
        return new Promise((resolve, reject) => {
            const log = `${options.presence ? 'Wait for present' : 'Wait for gone'} ${target}`;
            this.debug(dtag)(log, 'in', options.timeout, 'ms');
            options.t = Date.now();
            const f = () => {
                this.works([
                    [w => this.isStale(data.el), w => data.el],
                    [w => this.observeChildren({data, target, options}), w => !w.getRes(0)],
                    [w => this.isWaiting({data, options}), w => !w.getRes(0)],
                    [w => this.sleep(this.loopdelay), w => !w.getRes(0)],
                    [w => this.getObservedChildren({target, options}), w => !w.getRes(0)],
                    [w => Promise.resolve(w.getRes(0) ? false : (w.getRes(4) !== undefined ? w.getRes(4) : w.getRes(2)))],
                ])
                .then(result => {
                    const delta = Date.now() - options.t;
                    // wait a minimum of delay before resolving on wait for gone
                    if (!result && !options.presence && options.res === undefined && delta < this.opdelay) {
                        result = true;
                    }
                    if (result) {
                        setTimeout(f, this.loopdelay);
                    } else {
                        this.debug(dtag)(log, 'resolved with', options.sres ?? options.res, 'in', delta, 'ms');
                        resolve(options.res);
                    }
                })
                .catch(err => {
                    if (err instanceof error.StaleElementReferenceError) {
                        this.debug(dtag)(log, 'is now stale');
                        resolve(options.res);
                    } else {
                        reject(err);
                    }
                });
            }
            f();
        });
    }

    /**
     * Get the waiting state of selector.
     *
     * @param {object} param0
     * @param {object|By} param0.data Element to wait for
     * @param {object} param0.options The options
     * @param {number} param0.options.timeout Wait timeout, pass 0 for unlimited
     * @returns {Promise<boolean>}
     */
    isWaiting({data, options}) {
        let res;
        return this.works([
            [w => this.findElements(data)],
            [w => new Promise((resolve, reject) => {
                res = options.presence ? w.res.length === 0 : w.res.length > 0;
                // is it timed out?
                if (res && options.timeout > 0 && Date.now() - options.t > options.timeout) {
                    res = false;
                }
                if (w.res.length) {
                    options.res = w.res[0];
                }
                resolve();
            })],
            [w => new Promise((resolve, reject) => {
                this.getHtml(options.res)
                    .then(html => {
                        options.res = html;
                        resolve();
                    })
                    .catch(() => resolve(true));
            }), w => options.res],
            [w => new Promise((resolve, reject) => {
                options.res.getId()
                    .then(id => {
                        options.res = `${options.res.constructor.name} (${id})`;
                        resolve();
                    })
                    .catch(() => resolve());
            }), w => w.getRes(2) === true],
            [w => Promise.resolve(options.sres = this.truncate(options.res)),
                w => typeof options.res === 'string'],
            [w => Promise.resolve(res)],
        ]);
    }

    /**
     * Observes children mutation.
     *
     * @param {object} param0
     * @param {object} param0.data The data
     * @param {WebElement} param0.data.el The element
     * @param {object} param0.options The Options
     * @param {string} param0.options.classname Children classname to observe
     * @returns {Promise<any>}
     */
    observeChildren({data, options}) {
        if (!options.observed && data.el) {
            options.observed = true;
            return this.driver.executeScript('_xchildObserve(arguments[0], arguments[1])', data.el, options.classname);
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Get observed children addition or removal.
     *
     * @returns {Promise<any>}
     */
    getObservedChildren({target, options}) {
        if (options.observed && options.classname) {
            return this.works([
                [w => this.driver.executeScript('return getObservedChildren()')],
                [w => Promise.resolve(w.getRes(0).state && w.getRes(0).state[options.classname])],
                [w => Promise.resolve(this.debug(dtag)(options.presence ? 'Wait for present' : 'Wait for gone', target, 'is now fulfilled')), w => w.getRes(1)],
                [w => Promise.resolve(w.getRes(1) ? false : undefined)],
            ]);
        } else {
            return Promise.resolve();
        }
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
                const f = () => {
                    restart = false;
                    let res, level = 0, length = menus.length;
                    const q = new Queue([...menus], menu => {
                        let root, parent = res ?? this.driver, n = 3;
                        const last = ++level === length;
                        switch (level) {
                            case 1:
                                root = '//div[@class="simplebar-content"]/ul/li';
                                break;
                            case 2:
                                root = './../div[@class="ReactCollapse--collapse"]/div[@class="ReactCollapse--content"]/div/div/div/div';
                                break;
                            case 3:
                                root = './../../../div/div[@class="ReactCollapse--collapse"]/div[@class="ReactCollapse--content"]/div';
                                break;
                        }
                        this.works([
                            [w => this.findMenu(parent, root, menu, level, n)],
                            [w => this.findMenu(parent, root, menu, level, n + 1), w => !w.getRes(0)],
                            [w => Promise.resolve(w.getRes(0) || w.getRes(1))],
                            [w => Promise.reject(`Unable to find menu ${menu}!`), w => !w.getRes(2)],
                        ])
                        .then(state => {
                            res = state.el;
                            if (state.clicked && !last) {
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

    /**
     * Find menu title.
     *
     * @param {WebElement} parent The parent element
     * @param {string} root Root selector
     * @param {string} title Menu title 
     * @param {number} level Menu level
     * @param {number} depth Menu depth
     * @returns {Promise<object|undefined>}
     */
    findMenu(parent, root, title, level, depth) {
        const dep = (s, n) => Array.from({length: n}, () => s).join('/');
        const selector = `${root}/a/${dep('*', depth)}[text()="${title}"]`;
        const upselector = dep('..', depth);
        let res;
        return this.works([
            [w => parent.findElements(By.xpath(selector))],
            [w => w.getRes(0)[0].findElement(By.xpath(upselector)), w => w.getRes(0).length],
            [w => w.getRes(0)[0].getAttribute('class'), w => w.getRes(0).length],
            [w => w.getRes(1).getAttribute('class'), w => w.getRes(0).length],
            [w => Promise.resolve(level > 1 ? w.getRes(2) : w.getRes(3)), w => w.getRes(0).length],
            [w => Promise.resolve(res = {el: w.getRes(1)}), w => w.getRes(0).length],
            [w => w.getRes(1).click(), w => w.getRes(0).length && w.getRes(4).indexOf('false') >= 0],
            [w => Promise.resolve(res.clicked = true), w => w.getRes(0).length && w.getRes(4).indexOf('false') >= 0],
            [w => Promise.resolve(this.debug(dtag)(`Menu level ${level} ${selector}`)), w => res],
            [w => Promise.resolve(res)],
        ]);
    }

    /**
     * Navigate to sub page content.
     *
     * @param  {...any} subs Sub pages
     * @returns {Promise<any>}
     */
    subPageNav(...subs) {
        return new Promise((resolve, reject) => {
            const q = new Queue([...subs], nav => {
                this.works([
                    [w => this.waitAndClick(By.xpath(`//button/p[text()="${nav}"]/..`))],
                    [w => this.waitSpinner(w.getRes(0), this.SPINNER_CHAKRA)],
                ])
                .then(() => q.next())
                .catch(err => reject(err));
            });
            q.once('done', () => resolve());
        });
    }

    /**
     * Go to the top of current page window.
     *
     * @returns {Promise<any>}
     */
    gotoPageTop() {
        return this.driver.executeScript('window.scrollTo(0, 0);');
    }

    /**
     * Get page script part.
     *
     * @returns {string}
     */
    getPageScript1() {
        return (
            'aWYgKHdpbmRvdy5feGhlbHBlciA9PT0gdW5kZWZpbmVkKSB7DQogICAgd2luZG93Ll94c3RhdGVzID0g' +
            'e307DQogICAgd2luZG93Ll94aGVscGVyID0gWw0KICAgICAgICB7DQogICAgICAgICAgICBzZWxlY3Rv' +
            'cjogJy5jc3MtYWYtZWcta3czZzIxJywNCiAgICAgICAgICAgIGNhbGxiYWNrKGVsKSB7DQogICAgICAg' +
            'ICAgICAgICAgd2luZG93Ll94c3RhdGVzLmxvYWRpbmcgPSBlbCA/IHRydWUgOiBmYWxzZTsNCiAgICAg' +
            'ICAgICAgICAgICByZXR1cm4gd2luZG93Ll94c3RhdGVzLmxvYWRpbmc7DQogICAgICAgICAgICB9DQog' +
            'ICAgICAgIH0sDQogICAgICAgIHsNCiAgICAgICAgICAgIHNlbGVjdG9yOiAnW2RhdGEtcmh0LXRvYXN0' +
            'ZXJdJywNCiAgICAgICAgICAgIGNhbGxiYWNrKGVsKSB7DQogICAgICAgICAgICAgICAgd2luZG93Ll94' +
            'bG9nKGVsKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICB9DQogICAg' +
            'ICAgIH0NCiAgICBdOw0KICAgIHdpbmRvdy5feG9ic2VydmUgPSAoZWwsIGNiKSA9PiB7DQogICAgICAg' +
            'IGlmIChlbCBpbnN0YW5jZW9mIE5vZGUpIHsNCiAgICAgICAgICAgIGNvbnN0IG9ic2VydmVyID0gbmV3' +
            'IE11dGF0aW9uT2JzZXJ2ZXIobXV0YXRpb25zID0+IHsNCiAgICAgICAgICAgICAgICBtdXRhdGlvbnMu' +
            'Zm9yRWFjaChtdXRhdGlvbiA9PiB7DQogICAgICAgICAgICAgICAgICAgIGlmIChtdXRhdGlvbi50eXBl' +
            'ID09PSAnY2hpbGRMaXN0JyAmJiBtdXRhdGlvbi50YXJnZXQgPT09IGVsKSB7DQogICAgICAgICAgICAg' +
            'ICAgICAgICAgICBjYihtdXRhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAg' +
            'ICAgICB9KTsNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShlbCwg' +
            'e2F0dHJpYnV0ZXM6IGZhbHNlLCBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWV9KTsNCiAgICAg' +
            'ICAgICAgIHJldHVybiBvYnNlcnZlcjsNCiAgICAgICAgfQ0KICAgIH0NCiAgICB3aW5kb3cuX3hsb2cg' +
            'PSBlbCA9PiB7DQogICAgICAgIGlmIChlbCkgew0KICAgICAgICAgICAgY29uc3Qgb2JzZXJ2ZXIgPSB3' +
            'aW5kb3cuX3hvYnNlcnZlKGVsLCAoKSA9PiB7DQogICAgICAgICAgICAgICAgaWYgKHdpbmRvdy5feGxv' +
            'Z3MgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICB3aW5kb3cuX3hsb2dzID0gW107' +
            'DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGNvbnN0IHN0YXR1cyA9IGVsLnF1ZXJ5' +
            'U2VsZWN0b3IoJ2Rpdltyb2xlPSJzdGF0dXMiXScpOw0KICAgICAgICAgICAgICAgIGlmIChzdGF0dXMp' +
            'IHsNCiAgICAgICAgICAgICAgICAgICAgd2luZG93Ll94bG9ncy5wdXNoKHN0YXR1cy50ZXh0Q29udGVu' +
            'dCk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQogICAgICAgIH0NCiAgICB9DQog' +
            'ICAgd2luZG93Ll94Y2hpbGRPYnNlcnZlID0gKGVsLCBjbGFzc25hbWUpID0+IHsNCiAgICAgICAgaWYg' +
            'KGVsKSB7DQogICAgICAgICAgICB3aW5kb3cuX3hvYnNlcnZlcyA9IHt9Ow0KICAgICAgICAgICAgY29u' +
            'c3Qgb2JzZXJ2ZXIgPSB3aW5kb3cuX3hvYnNlcnZlKGVsLCBtdXRhdGlvbiA9PiB7DQogICAgICAgICAg' +
            'ICAgICAgaWYgKCF3aW5kb3cuX3hvYnNlcnZlcy5zdGF0ZSkgew0KICAgICAgICAgICAgICAgICAgICB3' +
            'aW5kb3cuX3hvYnNlcnZlcy5zdGF0ZSA9IHt9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAg' +
            'ICAgICBpZiAoIXdpbmRvdy5feG9ic2VydmVzLmFkZGVkKSB7DQogICAgICAgICAgICAgICAgICAgIHdp' +
            'bmRvdy5feG9ic2VydmVzLmFkZGVkID0gW107DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAg' +
            'ICAgIGZvciAoY29uc3Qgbm9kZSBvZiBtdXRhdGlvbi5hZGRlZE5vZGVzKSB7DQogICAgICAgICAgICAg' +
            'ICAgICAgIGlmICghd2luZG93Ll94b2JzZXJ2ZXMuYWRkZWQuaW5jbHVkZXMobm9kZS5vdXRlckhUTUwp' +
            'KSB7DQogICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3cuX3hvYnNlcnZlcy5hZGRlZC5wdXNoKG5v' +
            'ZGUub3V0ZXJIVE1MKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBp' +
            'ZiAobm9kZS5jbGFzc0xpc3QpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsYXNzZXMg' +
            'PSBBcnJheS5mcm9tKG5vZGUuY2xhc3NMaXN0KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChj' +
            'bGFzc25hbWUgJiYgY2xhc3Nlcy5pbmNsdWRlcyhjbGFzc25hbWUpKSB7DQogICAgICAgICAgICAgICAg' +
            'ICAgICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZXMuc3RhdGVbY2xhc3NuYW1lXSA9ICdhZGRlZCc7DQog' +
            'ICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAg' +
            'ICAgICB9DQogICAgICAgICAgICAgICAgaWYgKCF3aW5kb3cuX3hvYnNlcnZlcy5yZW1vdmVkKSB7DQog' +
            'ICAgICAgICAgICAgICAgICAgIHdpbmRvdy5feG9ic2VydmVzLnJlbW92ZWQgPSBbXTsNCiAgICAgICAg' +
            'ICAgICAgICB9DQogICAgICAgICAgICAgICAgZm9yIChjb25zdCBub2RlIG9mIG11dGF0aW9uLnJlbW92' +
            'ZWROb2Rlcykgew0KICAgICAgICAgICAgICAgICAgICBpZiAoIXdpbmRvdy5feG9ic2VydmVzLnJlbW92' +
            'ZWQuaW5jbHVkZXMobm9kZS5vdXRlckhUTUwpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB3aW5k' +
            'b3cuX3hvYnNlcnZlcy5yZW1vdmVkLnB1c2gobm9kZS5vdXRlckhUTUwpOw0KICAgICAgICAgICAgICAg' +
            'ICAgICB9DQogICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmNsYXNzTGlzdCkgew0KICAgICAgICAg' +
            'ICAgICAgICAgICAgICAgY29uc3QgY2xhc3NlcyA9IEFycmF5LmZyb20obm9kZS5jbGFzc0xpc3QpOw0K' +
            'ICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNsYXNzbmFtZSAmJiBjbGFzc2VzLmluY2x1ZGVzKGNs' +
            'YXNzbmFtZSkpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3cuX3hvYnNlcnZlcy5z' +
            'dGF0ZVtjbGFzc25hbWVdID0gJ3JlbW92ZWQnOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAg' +
            'ICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQogICAg' +
            'ICAgIH0NCiAgICB9DQogICAgd2luZG93Ll94aW5pdCA9ICgpID0+IHsNCiAgICAgICAgY29uc3QgeiA9' +
            'IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdaRVVTJyk7DQogICAgICAgIGNvbnN0IG8gPSB3aW5kb3cu' +
            'X3hvYnNlcnZlKHosICgpID0+IHsNCiAgICAgICAgICAgIGxldCBpZHggPSAwOw0KICAgICAgICAgICAg' +
            'd2hpbGUgKHRydWUpIHsNCiAgICAgICAgICAgICAgICBpZiAoaWR4ID09PSB3aW5kb3cuX3hoZWxwZXIu' +
            'bGVuZ3RoKSB7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAg' +
            'ICAgICAgICAgICAgICBjb25zdCB4aCA9IHdpbmRvdy5feGhlbHBlcltpZHhdOw0KICAgICAgICAgICAg' +
            'ICAgIGNvbnN0IGVsID0gZG9jdW1lbnQucXVlcnlTZWxlY3Rvcih4aC5zZWxlY3Rvcik7DQogICAgICAg' +
            'ICAgICAgICAgaWYgKHR5cGVvZiB4aC5jYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgew0KICAgICAgICAg' +
            'ICAgICAgICAgICBjb25zdCByZXR2YWwgPSB4aC5jYWxsYmFjayhlbCk7DQogICAgICAgICAgICAgICAg' +
            'ICAgIGlmIChyZXR2YWwpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlkeCsrOw0KICAgICAgICAg' +
            'ICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93Ll94aGVscGVy' +
            'LnNwbGljZShpZHgsIDEpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBl' +
            'bHNlIHsNCiAgICAgICAgICAgICAgICAgICAgaWR4Kys7DQogICAgICAgICAgICAgICAgfQ0KICAgICAg' +
            'ICAgICAgfQ0KICAgICAgICAgICAgaWYgKHdpbmRvdy5feGhlbHBlci5sZW5ndGggPT09IDApIHsNCiAg' +
            'ICAgICAgICAgICAgICBvLmRpc2Nvbm5lY3QoKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSk7DQog' +
            'ICAgfQ0KICAgIHdpbmRvdy5pc1NpcGRMb2FkaW5nID0gKCkgPT4gew0KICAgICAgICByZXR1cm4gd2lu' +
            'ZG93Ll94c3RhdGVzICYmIHdpbmRvdy5feHN0YXRlcy5sb2FkaW5nICE9PSB1bmRlZmluZWQgPyB3aW5k' +
            'b3cuX3hzdGF0ZXMubG9hZGluZyA6IHRydWU7DQogICAgfQ0KICAgIHdpbmRvdy5nZXRTaXBkTWVzc2Fn' +
            'ZXMgPSAoKSA9PiB7DQogICAgICAgIHJldHVybiB3aW5kb3cuX3hsb2dzID8gd2luZG93Ll94bG9ncyA6' +
            'IFtdOw0KICAgIH0NCiAgICB3aW5kb3cuZ2V0U2lwZExhc3RNZXNzYWdlID0gKCkgPT4gew0KICAgICAg' +
            'ICBjb25zdCBtZXNzYWdlcyA9IHdpbmRvdy5nZXRTaXBkTWVzc2FnZXMoKTsNCiAgICAgICAgcmV0dXJu' +
            'IG1lc3NhZ2VzLmxlbmd0aCA/IG1lc3NhZ2VzW21lc3NhZ2VzLmxlbmd0aCAtIDFdIDogbnVsbDsNCiAg' +
            'ICB9DQogICAgd2luZG93LmNsZWFyU2lwZE1lc3NhZ2VzID0gKCkgPT4gew0KICAgICAgICB3aW5kb3cu' +
            'X3hsb2dzID0gW107DQogICAgfQ0KICAgIHdpbmRvdy5nZXRPYnNlcnZlZENoaWxkcmVuID0gKCkgPT4g' +
            'ew0KICAgICAgICByZXR1cm4gd2luZG93Ll94b2JzZXJ2ZXMgPz8ge307DQogICAgfQ0KICAgIGFkZEV2' +
            'ZW50TGlzdGVuZXIoJ2xvYWQnLCBlID0+IHdpbmRvdy5feGluaXQoKSk7DQp9DQo='
        );
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

class SipdCleanAndRetryError extends SipdRetryError {
}

module.exports = {Sipd, SipdAnnouncedError, SipdRetryError, SipdCleanAndRetryError};