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

const fs = require('fs');
const path = require('path');
const Queue = require('@ntlab/work/queue');
const WebRobot = require('@ntlab/webrobot');
const SipdLogger = require('./logger');
const SipdUtil = require('./util');
const SipdTimer = require('./timer');
const Util = require('@ntlab/ntlib/util');
const { SipdOperationError, SipdRestartError, SipdRetryError, SipdAbortError } = require('./error');
const { By, error, WebElement } = require('selenium-webdriver');
const _ = require('@ntlab/ntlib/translator');

const dtag = 'core';

/**
 * SIPD Penatausahaan automation using Selenium.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Sipd extends WebRobot {

    state = {}

    /**
     * @inheritdoc
     */
    initialize() {
        this.year = this.options.year || new Date().getFullYear();
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.typedelay = this.options.typedelay || 5;
        this.loopdelay = this.options.loopdelay || 25;
        this.animdelay = this.options.animdelay || 1000;
        this.simplebarMenu = Sipd.MENU_PENATAUSAHAAN;
        WebRobot.expectErr(error.StaleElementReferenceError);
        WebRobot.expectErr(SipdRestartError);
        WebRobot.expectErr(SipdRetryError);
        WebRobot.expectErr(SipdAbortError);
    }

    /**
     * Do configure driver options.
     *
     * @param {import('selenium-webdriver/chrome').Options|import('selenium-webdriver/firefox').Options} options Driver options
     */
    onDriverOptions(options) {
        if (this.options.arguments && Array.isArray(this.options.arguments[this.browser])) {
            for (const arg of this.options.arguments[this.browser]) {
                options.addArguments(arg);
            }
        }
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
                [w => this.doPreLogin()],
                [w => this.logout(), w => force],
                [w => this.isLoggedIn(), w => !force],
                [w => this.doLogin(username, password, role), w => username && (force || !w.getRes(2))],
                [w => this.doPostLogin(), w => username],
            ])
            .then(() => resolve())
            .catch(err => reject(SipdRetryError.create(err)));
        });
    }

    /**
     * Perform pre login task.
     *
     * @returns {Promise<any>}
     */
    doPreLogin() {
        return this.works([
            [w => Promise.resolve(this.isSecure = false)],
            [w => this.savePageSnapshot('login-pre')],
            [w => this.isContinueable(null, false)],
            [w => this.gotoPenatausahaan()],
            [w => this.dismissAnnouncement()],
        ]);
    }

    /**
     * Perform post login task.
     *
     * @returns {Promise<any>}
     */
    doPostLogin() {
        return this.works([
            [w => this.dismissStatuses()],
            [w => this.checkMessages()],
            [w => this.dismissUpdate()],
            [w => this.savePageSnapshot('full')],
        ]);
    }

    /**
     * Perform login.
     *
     * @param {string} username Username
     * @param {string} password Password
     * @returns {Promise<any>}
     */
    doLogin(username, password, role) {
        return this.works([
            [w => this.doSubmitLogin(username, password)],
            [w => this.doSelectRole(username, role)],
            [w => this.savePageSnapshot('login-post')],
            [w => this.waitLoader()],
            [w => Promise.resolve(this.isSecure = true)],
        ]);
    }

    /**
     * Perform login.
     *
     * @param {string} username Username
     * @param {string} password Password
     * @returns {Promise<any>}
     */
    doSubmitLogin(username, password) {
        return new Promise((resolve, reject) => {
            const r = (e, s) => (e = (e instanceof Error ? e.message : e).toLowerCase(), e.includes(_(s)));
            const f = () => {
                this.formSubmit(
                    By.xpath(Sipd.LOGIN_FORM),
                    By.xpath('//button[@type="submit"]'),
                    [
                        {
                            target: By.xpath('.//label[text()="Tahun"]/../div/div/div/div[2]/input[@role="combobox"]'),
                            value: this.year,
                            onfill: (el, value) => this.reactSelect(el, value, 'Budgeting %value% is not available'),
                            label: _('Budgeting Year')
                        },
                        {target: By.id('ed_username'), value: username, label: _('Username')},
                        {target: By.id('ed_password'), value: password, label: _('Password')},
                    ],
                    {
                        spinner: true,
                        prefillCallback: () => this.waitCaptcha(),
                        retry: 3,
                        isretryable: err => r(err, 'gagal memproses permintaan'),
                    }
                )
                .then(() => resolve())
                .catch(err => {
                    // retry on invalid captcha
                    if (r(err, 'invalid captcha')) {
                        setTimeout(() => f(), this.loopdelay);
                    } else {
                        reject(err);
                    }
                });
            }
            f();
        });
    }

    /**
     * Pick user role.
     *
     * @param {string} username Username
     * @param {string|Array} role User role
     * @returns {Promise<any>}
     */
    doSelectRole(username, role) {
        const idx = Array.isArray(role) ? role[1] : 0;
        role = Array.isArray(role) ? role[0] : role;
        return this.works([
            [w => this.findElements(By.xpath('//h6[text()="Akun Tidak Ditemukan"]'))],
            [w => this.waitFor(By.xpath('//div[@class="container-account-select"]')),
                w => !w.getRes(0).length],
            [w => this.findElements({el: w.getRes(1), data: By.xpath(`.//div[@class="container-txt-account-list"]/h1[text()="${role}"]/../../../button`)}),
                w => !w.getRes(0).length],
            [w => w.getRes(2)[idx].click(), w => !w.getRes(0).length && w.getRes(2).length],
            [w => this.waitSpinner(w.getRes(1)), w => !w.getRes(0).length && w.getRes(2).length],
            [w => this.findElements({el: w.getRes(1), data: By.xpath('.//div[@class="container-txt-account-list"]/h1')}),
                w => !w.getRes(0).length && !w.getRes(2).length],
            [w => this.getText(w.getRes(5)),
                w => !w.getRes(0).length && !w.getRes(2).length],
            [w => Promise.reject(SipdOperationError.create('User %username% does not have role %role%, but has %roles%',
                {username, role, roles: w.getRes(6).join(', ')})),
                w => !w.getRes(0).length && !w.getRes(2).length],
            [w => Promise.reject(SipdOperationError.create('User %username% is not found', {username})),
                w => w.getRes(0).length],
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
            [w => this.clickWait(this.findElement(By.xpath('//a[contains(@class,"sn-logout")]'))),
                w => w.getRes(0).indexOf('login') < 0],
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
     * Get HTML representation of an element.
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
     * @param {Function} options.prefillCallback Form pre fill callback
     * @param {Function} options.postfillCallback Form post fill callback
     * @param {Function} options.onerror Form submission error callback
     * @returns {Promise<WebElement>}
     */
    formSubmit(form, submit, values, options = null) {
        options = options || {};
        if (options.wait === undefined) {
            options.wait = 0;
        }
        const prefillCallback = form => {
            return this.works([
                [x => this.waitSpinner(form)],
                [x => options.prefillCallback(form), x => typeof options.prefillCallback === 'function'],
            ]);
        }
        const postfillCallback = options.postfillCallback;
        return this.works([
            [w => this.sleep(this.opdelay)],
            [w => this.fillInForm(
                values,
                form,
                () => this.confirmSubmission(submit, options),
                {
                    wait: options.wait,
                    prefillCallback,
                    postfillCallback,
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
     * @param {Function} options.onerror Callback when error occured on form submission
     * @param {Function} options.isretryable Callback when a retry should be performed if an error occured
     * @returns {Promise<WebElement>}
     */
    confirmSubmission(clicker, options = null) {
        options = options || {};
        const success = message => {
            return message === null ||
                message.toLowerCase().includes('berhasil') ||
                message.toLowerCase().includes('dibuat');
        }
        const errmsg = message => typeof options.onerror === 'function' ? options.onerror(message) : message;
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
                    [w => Promise.resolve(this.debug(dtag)(_('Form submit return %message%', {message: w.getRes(4)}))), w => w.getRes(4)],
                    [w => Promise.resolve(w.getRes(1)), w => success(w.getRes(4))],
                    [w => Promise.reject(SipdOperationError.create(errmsg(w.getRes(4)))), w => !w.getRes(6)],
                ])
                .then(res => resolve(res))
                .catch(err => {
                    let retryable = true;
                    if (retry > 0 && typeof options.isretryable === 'function') {
                        retryable = options.isretryable(err);
                    }
                    if (retry === 0 || !retryable) {
                        reject(err);
                    } else {
                        this.debug(dtag)(_('Retrying form submit in %delay% ms...', {delay: this.wait}));
                        setTimeout(() => f(), this.wait);
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
            [w => this.findElements(By.xpath(Sipd.CAPTCHA_CONTAINER))],
            [w => this.waitSolvedCaptcha(w.getRes(0)[0]), w => w.getRes(0).length],
        ]);
    }

    /**
     * Wait for captcha to be solved.
     *
     * @param {WebElement} container Captcha container
     * @returns {Promise<any>}
     */
    waitSolvedCaptcha(container) {
        return this.works([
            [w => Promise.resolve(this.debug(dtag)(_('Awaiting captcha to be solved...')))],
            [w => Promise.resolve(this.setState({captcha: true}))],
            [w => new Promise((resolve, reject) => {
                const f = () => {
                    this.works([
                        [x => container.findElements(By.xpath('.//input[@data-index]'))],
                        [x => new Promise((resolve, reject) => {
                            let fulfilled = true;
                            const q = new Queue(x.getRes(0), digit => {
                                digit.getAttribute('value')
                                    .then(val => {
                                        if (!val) {
                                            fulfilled = false;
                                            q.done();
                                        } else {
                                            q.next();
                                        }
                                    })
                                    .catch(err => reject(err));
                            });
                            q.once('done', () => resolve(fulfilled));
                        })]
                    ])
                    .then(res => {
                        if (res) {
                            resolve();
                        } else {
                            setTimeout(() => f(), this.loopdelay);
                        }
                    })
                    .catch(err => reject(err));
                }
                f();
            })],
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
            [w => this.findElements(By.xpath(Sipd.CAPTCHA_CONTAINER))],
            [w => new Promise((resolve, reject) => {
                const f = () => {
                    w.getRes(0)[0].findElements(By.xpath('.//img'))
                        .then(elements => {
                            if (elements.length) {
                                resolve(elements[0]);
                            } else {
                                setTimeout(() => f(), this.loopdelay);
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
     * @returns {Promise<any>}
     */
    solveCaptcha(code) {
        code = SipdUtil.pickNumber(code);
        return this.works([
            [w => this.findElements(By.xpath(Sipd.CAPTCHA_CONTAINER))],
            [w => w.getRes(0)[0].findElements(By.xpath('.//input[@data-index]')), w => w.getRes(0).length],
            [w => Promise.resolve(w.getRes(1).length === code.length), w => w.getRes(0).length],
            [w => Promise.resolve(this.debug(dtag)(_('Solving captcha using %code%...', {code}))),
                w => w.getRes(2)],
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
        ]);
    }

    /**
     * Reload captcha.
     *
     * @returns {Promise<WebElement>}
     */
    reloadCaptcha() {
        return this.works([
            [w => this.findElements(By.xpath(Sipd.CAPTCHA_CONTAINER))],
            [w => w.getRes(0)[0].findElements(By.xpath('.//div[@class="custom-tippy"]')), w => w.getRes(0).length],
            [w => w.getRes(1)[0].click(), w => w.getRes(0).length],
        ]);
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
                    reject(SipdOperationError.create('No opened window'));
                }
            }), w => w.getRes(1)],
            [w => this.driver.switchTo().window(w.getRes(7)), w => w.getRes(1)],
            [w => this.driver.executeScript(this.getPageScript()), w => w.getRes(1)],
            [w => this.waitPage()],
        ]);
    }

    /**
     * Check if SIPD Penatausahaan is hit with reverse proxy error?
     *
     * @returns {Promise<undefined>}
     */
    isWafError() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//div[@id="cf-error-details"]/header/h1'), {timeout: this.delay})],
            [w => this.getText([By.xpath('.//span[@class="inline-block"]'), By.xpath('.//span[@class="code-label"]')], w.getRes(0)), w => w.getRes(0)],
            [w => Promise.reject(SipdOperationError.create('Cloudflare: %status% (%message%)',
                {status: w.getRes(1)[0], message: w.getRes(1)[1]})), w => w.getRes(0)],
        ]);
    }

    /**
     * Check if in maintenance mode?
     *
     * @returns {Promise<any>}
     */
    isInMaintenance() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//h1[contains(@class,"css-n-ca-jf-qawac") and text()="Maintenance"]'), {timeout: this.delay})],
            [w => this.waitForPresence(By.xpath('//div[contains(@class,"chakra-modal__body")]/*/*[contains(text(),"Pemeliharaan")]'), {timeout: this.delay})],
            [w => Promise.reject(SipdOperationError.create('SIPD Penatausahaan is in maintenance')), w => w.getRes(0) || w.getRes(1)],
        ]);
    }

    /**
     * Check if operation is continueable?
     *
     * @param {Error} err Error object
     * @param {boolean} secured Is require secure context
     * @returns {Promise<any>}
     */
    isContinueable(err, secured = true) {
        return this.works([
            [w => Promise.reject(SipdOperationError.create('Window has been closed')),
                w => err && (err instanceof error.NoSuchWindowError || err instanceof error.NoSuchSessionError)],
            [w => this.isWafError()],
            [w => this.isInMaintenance()],
            [w => this.isLoggedIn(false), w => secured],
            [w => Promise.reject(SipdOperationError.create('Not logged in')), w => secured && !w.getRes(3)],
        ]);
    }

    /**
     * Is user currently logged in?
     *
     * @returns {Promise<boolean>}
     */
    isLoggedIn(wait = true) {
        return this.works([
            [w => this.waitLoader(), w => wait],
            [w => this.findElements(By.xpath(Sipd.LOGIN_FORM))],
            [w => Promise.resolve(w.getRes(1).length > 0 ? false : true)],
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
                let error;
                /** @type {string[]} */
                const messages = w.getRes(0);
                for (const message of messages) {
                    this.debug(dtag)(_('Message: %message%', {message}));
                    if (error === undefined && message.match(/(gagal|failed)/)) {
                        error = message;
                    }
                }
                if (error) {
                    return reject(SipdOperationError.create('SIPD Penatausahaan is experiencing problem: %error%', {error}));
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
            const timer = new SipdTimer({delta: 60});
            const f = () => {
                this.works([
                    [w => this.findElements(By.xpath('//div[@role="status"]'))],
                    [w => Promise.resolve(w.getRes(0).length ? true : false)],
                ])
                .then(res => {
                    if (res) {
                        timer.check(t => this.debug(dtag)(_('Still waiting status dismissing after %duration%...',
                            {duration: t.elapsedTime})));
                        setTimeout(() => f(), this.loopdelay);
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
     * Dismiss announcement.
     *
     * @returns {Promise<any>}
     */
    dismissAnnouncement() {
        return this.doDismiss([
                By.xpath('//img[contains(@src,"pengumuman")]'),
                By.xpath('//div[text()="PENGUMUMAN"]'),
            ],
            By.xpath('//button[contains(@class,"chakra-modal__close-btn")]'));
    }

    /**
     * Dismiss update notification.
     *
     * @returns {Promise<any>}
     */
    dismissUpdate() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//section[contains(@class,"chakra-modal__content")]'))],
            [w => this.doDismiss(By.xpath('//h1[contains(@class,"css-nwjwe-j2aft") and text()="Pembaruan"]'),
                By.xpath('//button[text()="Sembunyikan"]')), w => w.getRes(0)],
            [w => this.sleep(this.opdelay), w => w.getRes(0)],
        ]);
    }

    /**
     * Do dismiss.
     *
     * @param {By|By[]} elements Dismissable elements
     * @param {By} clicker Dismiss clicker
     * @returns {Promise<any>}
     */
    doDismiss(elements, clicker) {
        return new Promise((resolve, reject) => {
            const q = new Queue([...(Array.isArray(elements) ? elements : [elements])], el => {
                this.works([
                    [w => this.waitForPresence(el, {timeout: this.delay})],
                    [w => this.click(clicker), w => w.getRes(0)],
                ])
                .then(res => res ? q.done() : q.next())
                .catch(err => reject(err));
            });
            q.once('done', () => resolve());
        });
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
            [w => Promise.reject(SipdOperationError.create(message ? message : 'Select choice %value% is unavailable', {value})),
                w => w.getRes(3).length === 0],
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
     * @param {string|boolean} state Expected state
     * @returns {Promise<any>}
     */
    clickExpanded(el, state = true) {
        let click = true;
        if (typeof state === 'boolean') {
            state = true === state ? 'true' : 'false';
        }
        return new Promise((resolve, reject) => {
            const f = () => {
                this.works([
                    [w => this.clickWait(el), w => click],
                    [w => el.getAttribute('aria-expanded')],
                ])
                .then(res => {
                    click = false;
                    if (res === state) {
                        resolve();
                    } else {
                        setTimeout(() => f(), this.loopdelay);
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });
    }

    /**
     * Wait for SIPD Penatausahaan page to be fully loaded.
     *
     * @param {number} reload Force reload page in second
     * @param {number} restartCount Number of page restart to try before throwing error
     * @returns {Promise<any>}
     */
    waitPage(reload = 60, restartCount = 10) {
        return new Promise((resolve, reject) => {
            let count = 0;
            const f = () => {
                let restart = false;
                this.works([
                    [w => Promise.reject(SipdOperationError.create('Browser session has been closed while opening SIPD Penatausahaan')),
                        w => reload > 0 && !this.driver],
                    [w => Promise.resolve(this.tmo = setTimeout(() => this.driver.navigate().refresh(), reload * 1000)),
                        w => reload > 0],
                    [w => this.waitForPresence(By.id('cw-wwwig-gw'), {presence: false, timeout: 0})],
                    [w => this.waitForPresence(By.xpath('//div[@class="css-fnE_f8jr-4g"]'), {timeout: this.delay})],
                    [w => this.findElements(By.xpath('//button[text()="Muat Ulang Halaman"]')), w => w.getRes(3)],
                    [w => w.getRes(4)[0].click(), w => w.getRes(3) && w.getRes(4).length],
                    [w => Promise.resolve(count++), w => w.getRes(3) && w.getRes(4).length],
                    [w => Promise.resolve(restart = true), w => w.getRes(3) && w.getRes(4).length],
                ])
                .then(() => {
                    if (this.tmo !== undefined) {
                        clearTimeout(this.tmo);
                        delete this.tmo;
                    }
                    if (restart) {
                        if (count > restartCount) {
                            reject(SipdOperationError.create('Too many retry while opening SIPD Penatausahaan'));
                        } else {
                            setTimeout(() => f(), this.delay);
                        }
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
     * Wait for SIPD Penatausahaan sidebar to be fully loaded.
     *
     * @returns {Promise<any>}
     */
    waitSidebar() {
        return this.waitForPresence(By.xpath('//div[@class="sn-card"]/div[@class="sn-skel"]'), {presence: false, timeout: 0});
    }

    /**
     * Wait for SIPD Penatausahaan content to be fully loaded,
     * indicated by page loader is gone.
     *
     * @returns {Promise<any>}
     */
    waitLoader() {
        return this.waitForPresence(By.xpath('//div[@class="container-rendering"]'), {presence: false, timeout: 0});
    }

    /**
     * Wait for content to be fully loaded.
     *
     * @returns {Promise<any>}
     */
    waitContent() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//div/span[text()="Pusat Pengaduan"]'), {timeout: 0})],
            [w => this.sleep(this.animdelay)],
        ]);
    }

    /**
     * Wait for SIPD Penatausahaan spinner to be gone.
     *
     * @param {WebElement} el Spinner container element
     * @param {string|null} spinner Spinner class name
     * @returns {Promise<any>}
     */
    waitSpinner(el, spinner = null) {
        return this.waitForPresence({el, data: spinner ?? Sipd.SPINNER_ANIMATE}, {presence: false, timeout: 0});
    }

    /**
     * Wait an element until it's presence or gone.
     *
     * @param {object|By} data Element to wait for
     * @param {WebElement} data.el Parent element
     * @param {By} data.data Element selector
     * @param {object} options The options
     * @param {boolean} options.presence Presence state
     * @param {boolean} options.secured Check for login form to allow break on wait
     * @param {number} options.timeout Wait time out
     * @returns {Promise<WebElement>}
     */
    waitForPresence(data, options = null) {
        options = options || {};
        if (options.presence === undefined) {
            options.presence = true;
        }
        if (options.secured === undefined && this.isSecure) {
            options.secured = true;
        }
        if (options.timeout === undefined || options.timeout === null) {
            options.timeout = this.timeout;
        }
        // allows to wait for classname
        if (data.el && data.data && typeof data.data === 'string') {
            options.classname = data.data;
            data.data = By.xpath(`.//*[contains(@class,"${options.classname}")]`);
        }
        const target = this.getTargetForDisplay(data);
        return new Promise((resolve, reject) => {
            const state = _(options.presence ? 'present' : 'gone');
            this.debug(dtag)(_('Wait for %state% %target% in %time% ms',
                {state, target, time: options.timeout > 0 ? options.timeout : '∞'}));
            options.t = Date.now();
            const f = () => {
                this.works([
                    [w => this.isStale(data.el), w => data.el],
                    [w => this.observeChildren({data, options}), w => !w.getRes(0)],
                    [w => this.isWaiting({data, target, options}), w => !w.getRes(0)],
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
                        setTimeout(() => f(), this.loopdelay);
                    } else {
                        this.debug(dtag)(_('Wait for %state% %target% resolved with %res% in %duration% ms',
                            {state, target, res: options.sres ?? options.res, duration: delta}));
                        resolve(options.res);
                    }
                })
                .catch(err => {
                    if (err instanceof error.StaleElementReferenceError) {
                        this.debug(dtag)(_('Wait for %state% %target% is now stale',
                            {state, target}));
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
     * @param {string} param0.target Element as display
     * @param {object} param0.options The options
     * @param {boolean} param0.options.secured Check for login form
     * @param {number} param0.options.timeout Wait timeout, pass 0 for unlimited
     * @returns {Promise<boolean>}
     */
    isWaiting({data, target, options}) {
        let res;
        return this.works([
            [w => this.findElements(data)],
            [w => this.isLoggedIn(false), w => options.secured],
            [w => new Promise((resolve, reject) => {
                const found = w.getRes(0);
                res = options.presence ? found.length === 0 : found.length > 0;
                // is it timed out?
                if (res && options.timeout > 0 && Date.now() - options.t > options.timeout) {
                    res = false;
                }
                if (found.length) {
                    options.res = found[0];
                }
                resolve();
            })],
            [w => new Promise((resolve, reject) => {
                this.getHtml(options.res)
                    .then(html => {
                        options.sres = html;
                        resolve();
                    })
                    .catch(() => resolve(true));
            }), w => options.res],
            [w => new Promise((resolve, reject) => {
                options.res.getId()
                    .then(id => {
                        options.sres = `${options.res.constructor.name} (${id})`;
                        resolve();
                    })
                    .catch(() => resolve());
            }), w => w.getRes(3) === true],
            [w => Promise.resolve(options.sres = this.truncate(options.sres)),
                w => typeof options.sres === 'string'],
            [w => Promise.reject(SipdOperationError.create('Expecting %target% to be %state%, but got login form instead',
                {target, state: _(options.presence ? 'present' : 'gone')})),
                w => res && options.secured && !w.getRes(1)],
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
            const state = _(options.presence ? 'present' : 'gone');
            return this.works([
                [w => this.driver.executeScript('return getObservedChildren()')],
                [w => Promise.resolve(w.getRes(0).state && w.getRes(0).state[options.classname])],
                [w => Promise.resolve(this.debug(dtag)(_('Wait for %state% %target% is now fulfilled', {state, target}))),
                    w => w.getRes(1)],
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
                const levels = [];
                const f = () => {
                    restart = false;
                    let res, level = 0, length = menus.length;
                    const q = new Queue([...menus], menu => {
                        let root, parent = res ?? this.driver;
                        const last = ++level === length;
                        switch (level) {
                            case 1:
                                root = `//nav[@class="sn-card" and @aria-label="${this.simplebarMenu}"]/ul/li`;
                                break;
                            default:
                                root = './../div[@class="ReactCollapse--collapse"]/div[@class="ReactCollapse--content"]/ul/li';
                                break;
                        }
                        const logged = !levels.includes(level);
                        if (logged) {
                            levels.push(level);
                        }
                        this.works([
                            [w => this.findMenu(parent, root, menu, level, logged)],
                            [w => this.isLoggedIn(false), w => !w.getRes(0)],
                            [w => Promise.reject(SipdOperationError.create('Unable to find menu %menu%', {menu})),
                                w => !w.getRes(0) && w.getRes(1)],
                            [w => Promise.reject(SipdOperationError.create('Unable to find menu %menu%, session logged-out', {menu})),
                                w => !w.getRes(0)],
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
     * @param {boolean} logged Enable logging
     * @returns {Promise<object|undefined>}
     */
    findMenu(parent, root, title, level, logged) {
        const selector = `${root}/*/span[@class="sn-item-title" and text()="${title}"]/..`;
        let res;
        return new Promise((resolve, reject) => {
            this.works([
                [w => parent.findElements(By.xpath(selector))],
                [w => w.getRes(0)[0].getAttribute('aria-expanded'), w => w.getRes(0).length],
                [w => w.getRes(0)[0].click(), w => w.getRes(0).length && w.getRes(1) !== 'true'],
                [w => this.sleep(this.opdelay), w => w.getRes(0).length && w.getRes(1) !== 'true'],
                [w => Promise.resolve(res = {el: w.getRes(0)[0]}), w => w.getRes(0).length],
                [w => Promise.resolve(this.debug(dtag)(_('Menu level %level% %selector%', {level, selector}))), w => res && logged],
            ])
            .then(() => resolve(res))
            .catch(err => reject(SipdOperationError.create('Unable to navigate to menu %menu%: %message%',
                {menu: title, message: err instanceof Error ? err.message : err})));
        });
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
                    [w => this.findElements(By.xpath(`//button/p[text()="${nav}"]/..`))],
                    [w => w.getRes(0)[0].click(), w => w.getRes(0).length],
                    [w => this.sleep(this.loopdelay), w => w.getRes(0).length],
                    [w => new Promise((resolve, reject) => {
                        const el = w.getRes(0)[0];
                        const f = () => {
                            el.getAttribute('disabled')
                                .then(res => {
                                    if (res) {
                                        setTimeout(() => f(), this.loopdelay);
                                    } else {
                                        resolve();
                                    }
                                })
                                .catch(err => reject(err));
                        }
                        f();
                    }), w => w.getRes(0).length],
                    [w => this.isLoggedIn(false), w => w.getRes(0).length === 0],
                    [w => Promise.reject(_('session logged-out')), w => w.getRes(0).length === 0 && !w.getRes(3)],
                ])
                .then(() => q.next())
                .catch(err => reject(SipdOperationError.create('Unable to navigate to sub page %page%: %message%',
                    {page: nav, message: err instanceof Error ? err.message : err})));
            });
            q.once('done', () => {
                this.debug(dtag)(_('Done navigating to sub page %subpage%', {subpage: subs.join('->')}));
                resolve();
            });
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
     * Do works in new tab.
     *
     * @param {string} url Url to open
     * @param {array} works Works data
     * @returns {Promise<any>}
     */
    doOpenInNewTab(url, works) {
        return this.works([
            [w => this.openInNewTab(url)],
            ...works,
        ], {
            onDone: (w, err) => this.closeTab(),
        });
    }

    /**
     * Save current page source snapshot.
     *
     * @param {string} name Snapshot name
     * @returns {Promise<string|undefined>}
     */
    savePageSnapshot(name) {
        if (this.options.snapshotdir) {
            return this.works([
                [w => this.driver.getPageSource()],
                [w => Promise.resolve(this.saveFile(this.genFilename(this.options.snapshotdir,
                    `${name ? name + '-' : ''}${Util.formatDate(new Date(), 'yyyyMMddHHmmsszzz')}.html`), w.getRes(0)))],
            ]);
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Get target element for display.
     *
     * @param {object|By} data Source data
     * @returns {string}
     */
    getTargetForDisplay(data) {
        let res;
        if (data.data instanceof By) {
            res = data.data.value;
        } else if (data instanceof By) {
            res = data.value;
        } else {
            res = data;
        }
        return res;
    }

    /**
     * Generate a filename relative to the working directory.
     *
     * @param {string} dir Directory name
     * @param {string} filename File name
     * @returns {string}
     */
    genFilename(dir, filename) {
        return path.join(this.options.workdir, dir, filename);
    }

    /**
     * Write content to file.
     *
     * @param {string} filepath File path
     * @param {Buffer|string} content File content
     * @returns {string}
     */
    saveFile(filepath, content) {
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        if (fs.existsSync(dir)) {
            fs.writeFileSync(filepath, content);
        }
        return filepath;
    }

    /**
     * Get page script part.
     *
     * @returns {string}
     */
    getPageScript1() {
        return (
            'aWYgKGRvY3VtZW50Ll9jcmVhdGVFbGVtZW50ID09PSB1bmRlZmluZWQpIHsNCiAgICBkb2N1bWVudC5f' +
            'Y3JlYXRlRWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQ7DQogICAgZG9jdW1lbnQuY3JlYXRl' +
            'RWxlbWVudCA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHsNCiAgICAgICAgaWYgKGFyZ3NbMF0gPT09ICdpZnJh' +
            'bWUnKSB7DQogICAgICAgICAgICByZXR1cm47DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGRvY3Vt' +
            'ZW50Ll9jcmVhdGVFbGVtZW50KC4uLmFyZ3MpOw0KICAgIH0NCn0NCmlmICh3aW5kb3cuX3hoZWxwZXIg' +
            'PT09IHVuZGVmaW5lZCkgew0KICAgIHdpbmRvdy5feHN0YXRlcyA9IHt9Ow0KICAgIHdpbmRvdy5feGhl' +
            'bHBlciA9IFsNCiAgICAgICAgew0KICAgICAgICAgICAgc2VsZWN0b3I6ICcuY3NzLWFmLWVnLWt3M2cy' +
            'MScsDQogICAgICAgICAgICBjYWxsYmFjayhlbCkgew0KICAgICAgICAgICAgICAgIHdpbmRvdy5feHN0' +
            'YXRlcy5sb2FkaW5nID0gZWwgPyB0cnVlIDogZmFsc2U7DQogICAgICAgICAgICAgICAgcmV0dXJuIHdp' +
            'bmRvdy5feHN0YXRlcy5sb2FkaW5nOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9LA0KICAgICAgICB7' +
            'DQogICAgICAgICAgICBzZWxlY3RvcjogJ1tkYXRhLXJodC10b2FzdGVyXScsDQogICAgICAgICAgICBj' +
            'YWxsYmFjayhlbCkgew0KICAgICAgICAgICAgICAgIHdpbmRvdy5feGxvZ01lc3NhZ2UoZWwpOw0KICAg' +
            'ICAgICAgICAgICAgIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIF07' +
            'DQogICAgd2luZG93Ll94b2JzZXJ2ZSA9IChlbCwgY2IpID0+IHsNCiAgICAgICAgaWYgKGVsIGluc3Rh' +
            'bmNlb2YgTm9kZSkgew0KICAgICAgICAgICAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNl' +
            'cnZlcihtdXRhdGlvbnMgPT4gew0KICAgICAgICAgICAgICAgIG11dGF0aW9ucy5mb3JFYWNoKG11dGF0' +
            'aW9uID0+IHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKG11dGF0aW9uLnR5cGUgPT09ICdjaGlsZExp' +
            'c3QnICYmIG11dGF0aW9uLnRhcmdldCA9PT0gZWwpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNi' +
            'KG11dGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0pOw0KICAg' +
            'ICAgICAgICAgfSk7DQogICAgICAgICAgICBvYnNlcnZlci5vYnNlcnZlKGVsLCB7YXR0cmlidXRlczog' +
            'ZmFsc2UsIGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZX0pOw0KICAgICAgICAgICAgcmV0dXJu' +
            'IG9ic2VydmVyOw0KICAgICAgICB9DQogICAgfQ0KICAgIHdpbmRvdy5feGxvZ01lc3NhZ2UgPSBlbCA9' +
            'PiB7DQogICAgICAgIGlmIChlbCkgew0KICAgICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZShlbCwgKCkg' +
            'PT4gew0KICAgICAgICAgICAgICAgIGlmICh3aW5kb3cuX3htZXNzYWdlcyA9PT0gdW5kZWZpbmVkKSB7' +
            'DQogICAgICAgICAgICAgICAgICAgIHdpbmRvdy5feG1lc3NhZ2VzID0gW107DQogICAgICAgICAgICAg' +
            'ICAgfQ0KICAgICAgICAgICAgICAgIGNvbnN0IHN0YXR1cyA9IGVsLnF1ZXJ5U2VsZWN0b3IoJ2Rpdlty' +
            'b2xlPSJzdGF0dXMiXScpOw0KICAgICAgICAgICAgICAgIGlmIChzdGF0dXMpIHsNCiAgICAgICAgICAg' +
            'ICAgICAgICAgd2luZG93Ll94bWVzc2FnZXMucHVzaChzdGF0dXMudGV4dENvbnRlbnQpOw0KICAgICAg' +
            'ICAgICAgICAgICAgICBlbC5yZW1vdmUoKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9' +
            'KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICB3aW5kb3cuX3hsb2cgPSBlbCA9PiB7DQogICAgICAgIGlm' +
            'IChlbCkgew0KICAgICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZShlbCwgKCkgPT4gY29uc29sZS5sb2co' +
            'ZWwpKTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICB3aW5kb3cuX3hjaGlsZE9ic2VydmUgPSAoZWwsIGNs' +
            'YXNzbmFtZSkgPT4gew0KICAgICAgICBpZiAoZWwpIHsNCiAgICAgICAgICAgIHdpbmRvdy5feG9ic2Vy' +
            'dmVzID0ge307DQogICAgICAgICAgICB3aW5kb3cuX3hvYnNlcnZlKGVsLCBtdXRhdGlvbiA9PiB7DQog' +
            'ICAgICAgICAgICAgICAgaWYgKCF3aW5kb3cuX3hvYnNlcnZlcy5zdGF0ZSkgew0KICAgICAgICAgICAg' +
            'ICAgICAgICB3aW5kb3cuX3hvYnNlcnZlcy5zdGF0ZSA9IHt9Ow0KICAgICAgICAgICAgICAgIH0NCiAg' +
            'ICAgICAgICAgICAgICBpZiAoIXdpbmRvdy5feG9ic2VydmVzLmFkZGVkKSB7DQogICAgICAgICAgICAg' +
            'ICAgICAgIHdpbmRvdy5feG9ic2VydmVzLmFkZGVkID0gW107DQogICAgICAgICAgICAgICAgfQ0KICAg' +
            'ICAgICAgICAgICAgIGZvciAoY29uc3Qgbm9kZSBvZiBtdXRhdGlvbi5hZGRlZE5vZGVzKSB7DQogICAg' +
            'ICAgICAgICAgICAgICAgIGlmICghd2luZG93Ll94b2JzZXJ2ZXMuYWRkZWQuaW5jbHVkZXMobm9kZS5v' +
            'dXRlckhUTUwpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3cuX3hvYnNlcnZlcy5hZGRl' +
            'ZC5wdXNoKG5vZGUub3V0ZXJIVE1MKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAg' +
            'ICAgICAgICBpZiAobm9kZS5jbGFzc0xpc3QgJiYgY2xhc3NuYW1lKSB7DQogICAgICAgICAgICAgICAg' +
            'ICAgICAgICBjb25zdCBjbGFzc2VzID0gQXJyYXkuZnJvbShub2RlLmNsYXNzTGlzdCk7DQogICAgICAg' +
            'ICAgICAgICAgICAgICAgICBpZiAoY2xhc3Nlcy5pbmNsdWRlcyhjbGFzc25hbWUpKSB7DQogICAgICAg' +
            'ICAgICAgICAgICAgICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZXMuc3RhdGVbY2xhc3NuYW1lXSA9ICdh' +
            'ZGRlZCc7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAg' +
            'ICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgaWYgKCF3aW5kb3cuX3hvYnNlcnZlcy5yZW1v' +
            'dmVkKSB7DQogICAgICAgICAgICAgICAgICAgIHdpbmRvdy5feG9ic2VydmVzLnJlbW92ZWQgPSBbXTsN' +
            'CiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgZm9yIChjb25zdCBub2RlIG9mIG11dGF0' +
            'aW9uLnJlbW92ZWROb2Rlcykgew0KICAgICAgICAgICAgICAgICAgICBpZiAoIXdpbmRvdy5feG9ic2Vy' +
            'dmVzLnJlbW92ZWQuaW5jbHVkZXMobm9kZS5vdXRlckhUTUwpKSB7DQogICAgICAgICAgICAgICAgICAg' +
            'ICAgICB3aW5kb3cuX3hvYnNlcnZlcy5yZW1vdmVkLnB1c2gobm9kZS5vdXRlckhUTUwpOw0KICAgICAg' +
            'ICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmNsYXNzTGlzdCAmJiBj' +
            'bGFzc25hbWUpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsYXNzZXMgPSBBcnJheS5m' +
            'cm9tKG5vZGUuY2xhc3NMaXN0KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjbGFzc2VzLmlu' +
            'Y2x1ZGVzKGNsYXNzbmFtZSkpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3cuX3hv' +
            'YnNlcnZlcy5zdGF0ZVtjbGFzc25hbWVdID0gJ3JlbW92ZWQnOw0KICAgICAgICAgICAgICAgICAgICAg' +
            'ICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAg' +
            'fSk7DQogICAgICAgIH0NCiAgICB9DQogICAgd2luZG93Ll94aW5pdCA9ICgpID0+IHsNCiAgICAgICAg' +
            'Y29uc3QgeiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdaRVVTJyk7DQogICAgICAgIGNvbnN0IG8g' +
            'PSB3aW5kb3cuX3hvYnNlcnZlKHosICgpID0+IHsNCiAgICAgICAgICAgIGxldCBpZHggPSAwOw0KICAg' +
            'ICAgICAgICAgd2hpbGUgKHRydWUpIHsNCiAgICAgICAgICAgICAgICBpZiAoaWR4ID09PSB3aW5kb3cu' +
            'X3hoZWxwZXIubGVuZ3RoKSB7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAg' +
            'ICAgIH0NCiAgICAgICAgICAgICAgICBjb25zdCB4aCA9IHdpbmRvdy5feGhlbHBlcltpZHhdOw0KICAg' +
            'ICAgICAgICAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQucXVlcnlTZWxlY3Rvcih4aC5zZWxlY3Rvcik7' +
            'DQogICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB4aC5jYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgew0K' +
            'ICAgICAgICAgICAgICAgICAgICBjb25zdCByZXR2YWwgPSB4aC5jYWxsYmFjayhlbCk7DQogICAgICAg' +
            'ICAgICAgICAgICAgIGlmIChyZXR2YWwpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlkeCsrOw0K' +
            'ICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93' +
            'Ll94aGVscGVyLnNwbGljZShpZHgsIDEpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAg' +
            'ICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgaWR4Kys7DQogICAgICAgICAgICAgICAg' +
            'fQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHdpbmRvdy5feGhlbHBlci5sZW5ndGggPT09' +
            'IDApIHsNCiAgICAgICAgICAgICAgICBvLmRpc2Nvbm5lY3QoKTsNCiAgICAgICAgICAgIH0NCiAgICAg' +
            'ICAgfSk7DQogICAgfQ0KICAgIHdpbmRvdy5pc1NpcGRMb2FkaW5nID0gKCkgPT4gew0KICAgICAgICBy' +
            'ZXR1cm4gd2luZG93Ll94c3RhdGVzICYmIHdpbmRvdy5feHN0YXRlcy5sb2FkaW5nICE9PSB1bmRlZmlu' +
            'ZWQgPyB3aW5kb3cuX3hzdGF0ZXMubG9hZGluZyA6IHRydWU7DQogICAgfQ0KICAgIHdpbmRvdy5nZXRT' +
            'aXBkTWVzc2FnZXMgPSAoKSA9PiB7DQogICAgICAgIHJldHVybiB3aW5kb3cuX3htZXNzYWdlcyA/IHdp' +
            'bmRvdy5feG1lc3NhZ2VzIDogW107DQogICAgfQ0KICAgIHdpbmRvdy5nZXRTaXBkTGFzdE1lc3NhZ2Ug' +
            'PSAoKSA9PiB7DQogICAgICAgIGNvbnN0IG1lc3NhZ2VzID0gd2luZG93LmdldFNpcGRNZXNzYWdlcygp' +
            'Ow0KICAgICAgICByZXR1cm4gbWVzc2FnZXMubGVuZ3RoID8gbWVzc2FnZXNbbWVzc2FnZXMubGVuZ3Ro' +
            'IC0gMV0gOiBudWxsOw0KICAgIH0NCiAgICB3aW5kb3cuY2xlYXJTaXBkTWVzc2FnZXMgPSAoKSA9PiB7' +
            'DQogICAgICAgIHdpbmRvdy5feG1lc3NhZ2VzID0gW107DQogICAgfQ0KICAgIHdpbmRvdy5nZXRPYnNl' +
            'cnZlZENoaWxkcmVuID0gKCkgPT4gew0KICAgICAgICByZXR1cm4gd2luZG93Ll94b2JzZXJ2ZXMgPz8g' +
            'e307DQogICAgfQ0KICAgIGFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBlID0+IHdpbmRvdy5feGluaXQo' +
            'KSk7DQp9DQo='
        );
    }

    static get LOGIN_FORM() { return '//div[contains(@class,"auth-box")]/div/form' }
    static get CAPTCHA_CONTAINER() { return '//div[contains(@class,"css-S-k-eg4wgs")]' }
    static get SPINNER_CHAKRA() { return 'chakra-spinner' }
    static get SPINNER_ANIMATE() { return 'animate-spin' }
    static get MENU_UTAMA() { return 'Menu Utama' }
    static get MENU_PENATAUSAHAAN() { return 'Penatausahaan' }
    static get MENU_LAPORAN() { return 'Laporan' }
    static get MENU_BANTUAN() { return 'bantuan' }
}

module.exports = Sipd;