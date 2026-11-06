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
        return this.driver.executeScript('SipdBridge?.clearMessages()');
    }

    /**
     * Get SIPD messages.
     *
     * @returns {Promise<string[]>}
     */
    getMessages() {
        return this.driver.executeScript('return SipdBridge?.getMessages()');
    }

    /**
     * Get SIPD last message.
     *
     * @returns {Promise<string>}
     */
    getLastMessage() {
        return this.driver.executeScript('return SipdBridge?.getLastMessage()');
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
            [w => this.waitForPresence(By.xpath('//div[@id="cf-error-details"]/header/h1'), {timeout: this.wait})],
            [w => this.getText([By.xpath('.//span[@class="inline-block"]'), By.xpath('.//span[@class="code-label"]')], w.getRes(0)), w => w.getRes(0)],
            [w => Promise.reject(SipdOperationError.create('Cloudflare: %status% (%message%)',
                {status: w.getRes(1)[0], message: w.getRes(1)[1]})), w => w.getRes(0)],
        ]);
    }

    /**
     * Check if SIPD Penatausahaan is hit with rate limiting?
     *
     * @returns {Promise<undefined>}
     */
    isRateLimited() {
        return this.works([
            [w => this.driver.getTitle()],
            [w => this.getText([By.id('ip')]), w => w.getRes(0)?.includes('RateLimit')],
            [w => Promise.reject(SipdOperationError.create('RateLimit: %ip% is hit by rate limiting',
                {ip: w.getRes(1)[0]?.substr(w.getRes(1)[0]?.indexOf(':'))})),
                w => w.getRes(0)?.includes('RateLimit')],
        ]);
    }

    /**
     * Check if page is need reloading?
     *
     * @param {number} restartCount  Number of restart try
     * @returns {Promise<any>}
     */
    isNeedReloading(restartCount = 10) {
        return new Promise((resolve, reject) => {
            let count = 0;
            const f = () => {
                let restart = false;
                this.works([
                    [w => this.waitForPresence(By.xpath('//div[@class="css-fnE_f8jr-4g"]'), {timeout: this.wait})],
                    [w => this.findElements(By.xpath('//button[text()="Muat Ulang Halaman"]')), w => w.getRes(0)],
                    [w => w.getRes(1)[0].click(), w => w.getRes(0) && w.getRes(1).length],
                    [w => Promise.resolve(count++), w => w.getRes(0) && w.getRes(1).length],
                    [w => Promise.resolve(restart = true), w => w.getRes(0) && w.getRes(1).length],
                ])
                .then(() => {
                    if (restart) {
                        if (count > restartCount) {
                            reject(SipdOperationError.create('Too many retry while opening SIPD Penatausahaan'));
                        } else {
                            setTimeout(() => f(), this.opdelay);
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
     * Check if in maintenance mode?
     *
     * @returns {Promise<any>}
     */
    isInMaintenance() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//h1[contains(@class,"css-n-ca-jf-qawac") and text()="Maintenance"]'), {timeout: this.wait})],
            [w => this.waitForPresence(By.xpath('//div[contains(@class,"chakra-modal__body")]/*/*[contains(text(),"Pemeliharaan")]'), {timeout: this.wait})],
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
            [w => this.isRateLimited()],
            [w => this.isNeedReloading()],
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
                    [w => this.waitForPresence(el, {timeout: this.wait})],
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
            [w => this.clickWait(el)],
            [w => el.getAttribute('aria-controls')],
            [w => this.findElement(By.id(w.getRes(1))), w => w.getRes(1)],
            [w => w.getRes(2).findElements(By.xpath(`.//*[contains(.,"${value}")]`)), w => w.getRes(1)],
            [w => Promise.reject(SipdOperationError.create(message ? message : 'Select choice %value% is unavailable', {value})),
                w => w.getRes(1) && w.getRes(3).length === 0],
            [w => w.getRes(3)[0].click(), w => w.getRes(1) && w.getRes(3).length],
            [w => this.getHtml(el), w => !w.getRes(1)],
            [w => Promise.reject(SipdOperationError.create('Select %select% has no option', {select: this.truncate(w.getRes(6))})),
                w => !w.getRes(1)],
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
        if (typeof state === 'boolean') {
            state = true === state ? 'true' : 'false';
        }
        return new Promise((resolve, reject) => {
            const f = () => {
                this.works([
                    [w => el.getAttribute('aria-expanded')],
                    [w => this.waitEnabled(el), w => w.getRes(0) !== state],
                    [w => this.clickWait(el), w => w.getRes(0) !== state],
                    [w => el.getAttribute('aria-expanded'), w => w.getRes(0) !== state],
                ])
                .then(res => {
                    if (res === state || res === null) {
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
     * Wait an element for enabled state.
     *
     * @param {WebElement} el Element
     * @returns {Promise<undefined>}
     */
    waitEnabled(el) {
        return new Promise((resolve, reject) => {
            const f = () => {
                el.isEnabled()
                    .then(enabled => {
                        if (!enabled) {
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
     * Wait for SIPD Penatausahaan page for initial page load to complete.
     *
     * @returns {Promise<any>}
     */
    waitPage() {
        return this.waitForPresence(By.id('cw-wwwig-gw'), {presence: false, timeout: 0});
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
     * Wait for page to be fully loaded.
     *
     * @returns {Promise<any>}
     */
    waitPageLoad() {
        return this.waitForPresence(By.xpath(`//div[@class="${Sipd.ANIMATE_PULSE}"]`), {presence: false, timeout: 0});
    }

    /**
     * Wait for SIPD Penatausahaan spinner to be gone.
     *
     * @param {WebElement} el Spinner container element
     * @param {string|null} spinner Spinner class name
     * @returns {Promise<any>}
     */
    waitSpinner(el, spinner = null) {
        return this.waitForPresence({el, data: spinner ?? Sipd.ANIMATE_SPIN}, {presence: false, timeout: 0});
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
            return this.driver.executeScript('SipdBridge?.observeChild(arguments[0], arguments[1])', data.el, options.classname);
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
                [w => this.driver.executeScript('return SipdBridge?.getObservedChildren()')],
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
                [w => this.waitEnabled(w.getRes(0)[0]), w => w.getRes(0).length],
                [w => this.clickExpanded(w.getRes(0)[0]), w => w.getRes(0).length],
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
        return this.works([
            [w => new Promise((resolve, reject) => {
                const q = new Queue([...subs], nav => {
                    this.findSubPageMenu(nav)
                        .then(() => q.next())
                        .catch(err => reject(err));
                });
                q.once('done', () => {
                    this.debug(dtag)(_('Done navigating to sub page %subpage%', {subpage: subs.join('->')}));
                    resolve();
                });
            })],
            [w => this.waitPageLoad()],
        ]);
    }

    /**
     * Find sub page menu.
     *
     * @param {string} nav Sub page title
     * @returns {Promise<WebElement>}
     */
    findSubPageMenu(nav) {
        const selector = `//button/p[text()="${nav}"]/..`;
        let res;
        return new Promise((resolve, reject) => {
            this.works([
                [w => this.findElements(By.xpath(selector))],
                [w => this.waitEnabled(w.getRes(0)[0]), w => w.getRes(0).length],
                [w => this.clickWait(w.getRes(0)[0]), w => w.getRes(0).length],
                [w => this.isLoggedIn(false), w => w.getRes(0).length === 0],
                [w => Promise.resolve(res = w.getRes(0)[0]), w => w.getRes(0).length && w.getRes(3)],
                [w => Promise.reject(_('session logged-out')), w => w.getRes(0).length === 0 && !w.getRes(3)],
            ])
            .then(() => resolve(res))
            .catch(err => reject(SipdOperationError.create('Unable to navigate to sub page %page%: %message%',
                {page: nav, message: err instanceof Error ? err.message : err})));
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
            'ZW50Ll9jcmVhdGVFbGVtZW50KC4uLmFyZ3MpOw0KICAgIH0NCn0NCmNvbnN0IHIgPSB3aW5kb3cgfHwg' +
            'Z2xvYmFsLCBuID0gJ1NpcGRCcmlkZ2UnLCBnID0gcltuXSAhPT0gdW5kZWZpbmVkID8gcltuXSA6IHJb' +
            'bl0gPSB7DQogICAgc3RhdGVzOiB7aW5pdDogdHJ1ZX0sDQogICAgZGF0YTogWw0KICAgICAgICB7DQog' +
            'ICAgICAgICAgICBzZWxlY3RvcjogJy5jc3MtZm5FX2Y4anItNGcnLA0KICAgICAgICAgICAgY2FsbGJh' +
            'Y2soZWwpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5zZXRTdGF0ZSgnZXJyb3InLCBlbCk7' +
            'DQogICAgICAgICAgICB9DQogICAgICAgIH0sDQogICAgICAgIHsNCiAgICAgICAgICAgIHNlbGVjdG9y' +
            'OiAnLmNzcy1hZi1lZy1rdzNnMjEnLA0KICAgICAgICAgICAgY2FsbGJhY2soZWwpIHsNCiAgICAgICAg' +
            'ICAgICAgICByZXR1cm4gdGhpcy5zZXRTdGF0ZSgnbG9hZGluZycsIGVsKTsNCiAgICAgICAgICAgIH0N' +
            'CiAgICAgICAgfSwNCiAgICAgICAgew0KICAgICAgICAgICAgc2VsZWN0b3I6ICdbZGF0YS1yaHQtdG9h' +
            'c3Rlcl0nLA0KICAgICAgICAgICAgY2FsbGJhY2soZWwpIHsNCiAgICAgICAgICAgICAgICB0aGlzLmxv' +
            'Z01lc3NhZ2UoZWwpOw0KICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIH0N' +
            'CiAgICAgICAgfQ0KICAgIF0sDQogICAgc2V0U3RhdGUoc3RhdGUsIHZhbHVlKSB7DQogICAgICAgIHRo' +
            'aXMuc3RhdGVzW3N0YXRlXSA9IHZhbHVlOw0KICAgICAgICByZXR1cm4gdmFsdWU7DQogICAgfSwNCiAg' +
            'ICBvYnNlcnZlKGVsLCBjYikgew0KICAgICAgICBpZiAoZWwgaW5zdGFuY2VvZiBOb2RlKSB7DQogICAg' +
            'ICAgICAgICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKG11dGF0aW9ucyA9PiB7' +
            'DQogICAgICAgICAgICAgICAgbXV0YXRpb25zLmZvckVhY2gobXV0YXRpb24gPT4gew0KICAgICAgICAg' +
            'ICAgICAgICAgICBpZiAobXV0YXRpb24udHlwZSA9PT0gJ2NoaWxkTGlzdCcgJiYgbXV0YXRpb24udGFy' +
            'Z2V0ID09PSBlbCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY2IobXV0YXRpb24pOw0KICAgICAg' +
            'ICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICB9KTsNCiAgICAg' +
            'ICAgICAgIG9ic2VydmVyLm9ic2VydmUoZWwsIHthdHRyaWJ1dGVzOiBmYWxzZSwgY2hpbGRMaXN0OiB0' +
            'cnVlLCBzdWJ0cmVlOiB0cnVlfSk7DQogICAgICAgICAgICByZXR1cm4gb2JzZXJ2ZXI7DQogICAgICAg' +
            'IH0NCiAgICB9LA0KICAgIGxvZ01lc3NhZ2UoZWwpIHsNCiAgICAgICAgaWYgKGVsKSB7DQogICAgICAg' +
            'ICAgICB0aGlzLm9ic2VydmUoZWwsICgpID0+IHsNCiAgICAgICAgICAgICAgICBpZiAodGhpcy5tZXNz' +
            'YWdlcyA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgIHRoaXMubWVzc2FnZXMgPSBb' +
            'XTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgY29uc3Qgc3RhdHVzID0gZWwucXVl' +
            'cnlTZWxlY3RvcignZGl2W3JvbGU9InN0YXR1cyJdJyk7DQogICAgICAgICAgICAgICAgaWYgKHN0YXR1' +
            'cykgew0KICAgICAgICAgICAgICAgICAgICB0aGlzLm1lc3NhZ2VzLnB1c2goc3RhdHVzLnRleHRDb250' +
            'ZW50KTsNCiAgICAgICAgICAgICAgICAgICAgZWwucmVtb3ZlKCk7DQogICAgICAgICAgICAgICAgfQ0K' +
            'ICAgICAgICAgICAgfSk7DQogICAgICAgIH0NCiAgICB9LA0KICAgIGxvZyhlbCkgew0KICAgICAgICBp' +
            'ZiAoZWwpIHsNCiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZShlbCwgKCkgPT4gY29uc29sZS5sb2coZWwp' +
            'KTsNCiAgICAgICAgfQ0KICAgIH0sDQogICAgb2JzZXJ2ZUNoaWxkKGVsLCBjbGFzc25hbWUpIHsNCiAg' +
            'ICAgICAgaWYgKGVsKSB7DQogICAgICAgICAgICB0aGlzLm9ic2VydmVzID0ge307DQogICAgICAgICAg' +
            'ICB0aGlzLm9ic2VydmUoZWwsIG11dGF0aW9uID0+IHsNCiAgICAgICAgICAgICAgICBpZiAoIXRoaXMu' +
            'b2JzZXJ2ZXMuc3RhdGUpIHsNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5vYnNlcnZlcy5zdGF0ZSA9' +
            'IHt9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBpZiAoIXRoaXMub2JzZXJ2ZXMu' +
            'YWRkZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5vYnNlcnZlcy5hZGRlZCA9IFtdOw0KICAg' +
            'ICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG5vZGUgb2YgbXV0YXRpb24u' +
            'YWRkZWROb2Rlcykgew0KICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMub2JzZXJ2ZXMuYWRkZWQu' +
            'aW5jbHVkZXMobm9kZS5vdXRlckhUTUwpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm9i' +
            'c2VydmVzLmFkZGVkLnB1c2gobm9kZS5vdXRlckhUTUwpOw0KICAgICAgICAgICAgICAgICAgICB9DQog' +
            'ICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmNsYXNzTGlzdCAmJiBjbGFzc25hbWUpIHsNCiAgICAg' +
            'ICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsYXNzZXMgPSBBcnJheS5mcm9tKG5vZGUuY2xhc3NMaXN0' +
            'KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjbGFzc2VzLmluY2x1ZGVzKGNsYXNzbmFtZSkp' +
            'IHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm9ic2VydmVzLnN0YXRlW2NsYXNzbmFt' +
            'ZV0gPSAnYWRkZWQnOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAg' +
            'ICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGlmICghdGhpcy5vYnNlcnZlcy5y' +
            'ZW1vdmVkKSB7DQogICAgICAgICAgICAgICAgICAgIHRoaXMub2JzZXJ2ZXMucmVtb3ZlZCA9IFtdOw0K' +
            'ICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG5vZGUgb2YgbXV0YXRp' +
            'b24ucmVtb3ZlZE5vZGVzKSB7DQogICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5vYnNlcnZlcy5y' +
            'ZW1vdmVkLmluY2x1ZGVzKG5vZGUub3V0ZXJIVE1MKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAg' +
            'dGhpcy5vYnNlcnZlcy5yZW1vdmVkLnB1c2gobm9kZS5vdXRlckhUTUwpOw0KICAgICAgICAgICAgICAg' +
            'ICAgICB9DQogICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmNsYXNzTGlzdCAmJiBjbGFzc25hbWUp' +
            'IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsYXNzZXMgPSBBcnJheS5mcm9tKG5vZGUu' +
            'Y2xhc3NMaXN0KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjbGFzc2VzLmluY2x1ZGVzKGNs' +
            'YXNzbmFtZSkpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm9ic2VydmVzLnN0YXRl' +
            'W2NsYXNzbmFtZV0gPSAncmVtb3ZlZCc7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAg' +
            'ICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCiAgICAgICAg' +
            'fQ0KICAgIH0sDQogICAgaW5pdCgpIHsNCiAgICAgICAgY29uc3QgeiA9IGRvY3VtZW50LmdldEVsZW1l' +
            'bnRCeUlkKCdaRVVTJyk7DQogICAgICAgIGlmICh6KSB7DQogICAgICAgICAgICBjb25zdCBvID0gdGhp' +
            'cy5vYnNlcnZlKHosICgpID0+IHsNCiAgICAgICAgICAgICAgICBsZXQgaWR4ID0gMDsNCiAgICAgICAg' +
            'ICAgICAgICB3aGlsZSAodHJ1ZSkgew0KICAgICAgICAgICAgICAgICAgICBpZiAoaWR4ID09PSB0aGlz' +
            'LmRhdGEubGVuZ3RoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAg' +
            'ICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkdCA9IHRoaXMuZGF0YVtpZHhdOw0K' +
            'ICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoZHQuc2Vs' +
            'ZWN0b3IpOw0KICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGR0LmNhbGxiYWNrID09PSAnZnVu' +
            'Y3Rpb24nKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXR2YWwgPSBkdC5jYWxsYmFj' +
            'ayhlbCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAocmV0dmFsKSB7DQogICAgICAgICAgICAg' +
            'ICAgICAgICAgICAgICAgaWR4Kys7DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAg' +
            'ICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGF0YS5zcGxpY2UoaWR4LCAxKTsNCiAgICAgICAg' +
            'ICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAg' +
            'ICAgICAgICAgICAgIGlkeCsrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAg' +
            'fQ0KICAgICAgICAgICAgICAgIGlmICh0aGlzLmRhdGEubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAg' +
            'ICAgICAgICAgIG8uZGlzY29ubmVjdCgpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAg' +
            'ICB0aGlzLnNldFN0YXRlKCdpbml0JywgZmFsc2UpOw0KICAgICAgICAgICAgfSk7DQogICAgICAgIH0g' +
            'ZWxzZSB7DQogICAgICAgICAgICB0aGlzLnNldFN0YXRlKCdpbml0JywgZmFsc2UpOw0KICAgICAgICB9' +
            'DQogICAgfSwNCiAgICBpc0Vycm9yKCkgew0KICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZXM/LmVycm9y' +
            'Ow0KICAgIH0sDQogICAgaXNMb2FkaW5nICgpIHsNCiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGVzPy5s' +
            'b2FkaW5nOw0KICAgIH0sDQogICAgZ2V0TWVzc2FnZXMoKSB7DQogICAgICAgIHJldHVybiB0aGlzLm1l' +
            'c3NhZ2VzID8gdGhpcy5tZXNzYWdlcyA6IFtdOw0KICAgIH0sDQogICAgZ2V0TGFzdE1lc3NhZ2UoKSB7' +
            'DQogICAgICAgIGNvbnN0IG1lc3NhZ2VzID0gdGhpcy5nZXRNZXNzYWdlcygpOw0KICAgICAgICByZXR1' +
            'cm4gbWVzc2FnZXMubGVuZ3RoID8gbWVzc2FnZXNbbWVzc2FnZXMubGVuZ3RoIC0gMV0gOiBudWxsOw0K' +
            'ICAgIH0sDQogICAgY2xlYXJNZXNzYWdlcygpIHsNCiAgICAgICAgdGhpcy5tZXNzYWdlcyA9IFtdOw0K' +
            'ICAgIH0sDQogICAgZ2V0T2JzZXJ2ZWRDaGlsZHJlbigpIHsNCiAgICAgICAgcmV0dXJuIHRoaXMub2Jz' +
            'ZXJ2ZXMgPz8ge307DQogICAgfQ0KfQ0KaWYgKGcuc3RhdGVzLmluaXQpIHsNCiAgICBhZGRFdmVudExp' +
            'c3RlbmVyKCdsb2FkJywgZSA9PiBnLmluaXQoKSk7DQp9DQo='
        );
    }

    static get LOGIN_FORM() { return '//div[contains(@class,"auth-box")]/div/form' }
    static get CAPTCHA_CONTAINER() { return '//div[contains(@class,"css-S-k-eg4wgs")]' }
    static get SPINNER_CHAKRA() { return 'chakra-spinner' }
    static get ANIMATE_SPIN() { return 'animate-spin' }
    static get ANIMATE_PULSE() { return 'animate-pulse' }
    static get MENU_UTAMA() { return 'Menu Utama' }
    static get MENU_PENATAUSAHAAN() { return 'Penatausahaan' }
    static get MENU_LAPORAN() { return 'Laporan' }
    static get MENU_BANTUAN() { return 'bantuan' }
}

module.exports = Sipd;