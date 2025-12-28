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
    CAPTCHA_CONTAINER = '//div[contains(@class,"css-S-k-eg4wgs")]'

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
        super.constructor.expectErr(SipdRestartError);
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
                [w => this.doPreLogin()],
                [w => this.logout(), w => force],
                [w => this.isLoggedIn(), w => !force],
                [w => this.doLogin(username, password, role), w => force || !w.getRes(2)],
                [w => this.doPostLogin()],
            ])
            .then(() => resolve())
            .catch(err => reject(new SipdRetryError(err instanceof Error ? err.message : err)));
        });
    }

    /**
     * Perform pre login task.
     *
     * @returns {Promise<any>}
     */
    doPreLogin() {
        return this.works([
            [w => this.isWafError()],
            [w => this.isInMaintenance()],
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
            [w => this.waitSidebar()],
            [w => this.dismissStatuses()],
            [w => this.checkMessages()],
            [w => this.dismissUpdate()],
        ]);
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
            [w => new Promise((resolve, reject) => {
                const f = () => {
                    this.formSubmit(
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
                        {spinner: true, prefillCallback: () => this.waitCaptcha()}
                    )
                    .then(() => resolve())
                    .catch(err => {
                        // retry on invalid captcha
                        if (typeof err === 'string' && err.toLowerCase().includes('invalid captcha')) {
                            setTimeout(f, this.loopdelay);
                        } else {
                            reject(err);
                        }
                    });
                }
                f();
            })],
            [w => this.selectAccount(role)],
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
                    [w => Promise.resolve(this.debug(dtag)('Form submit return', w.getRes(4))), w => w.getRes(4)],
                    [w => Promise.resolve(w.getRes(1)), w => success(w.getRes(4))],
                    [w => Promise.reject(errmsg(w.getRes(4))), w => !w.getRes(6)],
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
            [w => this.findElements(By.xpath(this.CAPTCHA_CONTAINER))],
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
            [w => Promise.resolve(this.debug(dtag)('Awaiting captcha to be solved...'))],
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
                            setTimeout(f, this.loopdelay);
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
            [w => this.findElements(By.xpath(this.CAPTCHA_CONTAINER))],
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
            [w => this.findElements(By.xpath(this.CAPTCHA_CONTAINER))],
            [w => w.getRes(0)[0].findElements(By.xpath('.//input[@data-index]')), w => w.getRes(0).length],
            [w => Promise.resolve(w.getRes(1).length === code.length), w => w.getRes(0).length],
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
            [w => this.findElements(By.xpath(this.CAPTCHA_CONTAINER))],
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
                    reject('No opened window');
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
            [w => Promise.reject(`Cloudflare: ${w.getRes(1)[0]} (${w.getRes(1)[1]})`), w => w.getRes(0)],
        ]);
    }

    /**
     * Check if in maintenance mode?
     *
     * @returns {Promise<undefined>}
     */
    isInMaintenance() {
        return this.works([
            [w => this.waitForPresence(By.xpath('//h1[contains(@class,"css-n-ca-jf-qawac") and text()="Maintenance"]'), {timeout: this.delay})],
            [w => Promise.reject('SIPD Penatausahaan is in maintenance!'), w => w.getRes(0)],
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
                            return reject(`SIPD Penatausahaan is experiencing problem: ${msg}!`);
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
        return this.doDismiss(By.xpath('//h1[contains(@class,"css-nwjwe-j2aft") and text()="Pembaruan"]'),
            By.xpath('//button[text()="Sembunyikan"]'));
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
            }), w => w.getRes(2) === true],
            [w => Promise.resolve(options.sres = this.truncate(options.sres)),
                w => typeof options.sres === 'string'],
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
            'YWxsYmFjayhlbCkgew0KICAgICAgICAgICAgICAgIHdpbmRvdy5feGxvZyhlbCk7DQogICAgICAgICAg' +
            'ICAgICAgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgXTsNCiAgICB3' +
            'aW5kb3cuX3hvYnNlcnZlID0gKGVsLCBjYikgPT4gew0KICAgICAgICBpZiAoZWwgaW5zdGFuY2VvZiBO' +
            'b2RlKSB7DQogICAgICAgICAgICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKG11' +
            'dGF0aW9ucyA9PiB7DQogICAgICAgICAgICAgICAgbXV0YXRpb25zLmZvckVhY2gobXV0YXRpb24gPT4g' +
            'ew0KICAgICAgICAgICAgICAgICAgICBpZiAobXV0YXRpb24udHlwZSA9PT0gJ2NoaWxkTGlzdCcgJiYg' +
            'bXV0YXRpb24udGFyZ2V0ID09PSBlbCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY2IobXV0YXRp' +
            'b24pOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAg' +
            'ICB9KTsNCiAgICAgICAgICAgIG9ic2VydmVyLm9ic2VydmUoZWwsIHthdHRyaWJ1dGVzOiBmYWxzZSwg' +
            'Y2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlfSk7DQogICAgICAgICAgICByZXR1cm4gb2JzZXJ2' +
            'ZXI7DQogICAgICAgIH0NCiAgICB9DQogICAgd2luZG93Ll94bG9nID0gZWwgPT4gew0KICAgICAgICBp' +
            'ZiAoZWwpIHsNCiAgICAgICAgICAgIGNvbnN0IG9ic2VydmVyID0gd2luZG93Ll94b2JzZXJ2ZShlbCwg' +
            'KCkgPT4gew0KICAgICAgICAgICAgICAgIGlmICh3aW5kb3cuX3hsb2dzID09PSB1bmRlZmluZWQpIHsN' +
            'CiAgICAgICAgICAgICAgICAgICAgd2luZG93Ll94bG9ncyA9IFtdOw0KICAgICAgICAgICAgICAgIH0N' +
            'CiAgICAgICAgICAgICAgICBjb25zdCBzdGF0dXMgPSBlbC5xdWVyeVNlbGVjdG9yKCdkaXZbcm9sZT0i' +
            'c3RhdHVzIl0nKTsNCiAgICAgICAgICAgICAgICBpZiAoc3RhdHVzKSB7DQogICAgICAgICAgICAgICAg' +
            'ICAgIHdpbmRvdy5feGxvZ3MucHVzaChzdGF0dXMudGV4dENvbnRlbnQpOw0KICAgICAgICAgICAgICAg' +
            'IH0NCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KICAgIHdpbmRvdy5feGNoaWxkT2Jz' +
            'ZXJ2ZSA9IChlbCwgY2xhc3NuYW1lKSA9PiB7DQogICAgICAgIGlmIChlbCkgew0KICAgICAgICAgICAg' +
            'd2luZG93Ll94b2JzZXJ2ZXMgPSB7fTsNCiAgICAgICAgICAgIGNvbnN0IG9ic2VydmVyID0gd2luZG93' +
            'Ll94b2JzZXJ2ZShlbCwgbXV0YXRpb24gPT4gew0KICAgICAgICAgICAgICAgIGlmICghd2luZG93Ll94' +
            'b2JzZXJ2ZXMuc3RhdGUpIHsNCiAgICAgICAgICAgICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZXMuc3Rh' +
            'dGUgPSB7fTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgaWYgKCF3aW5kb3cuX3hv' +
            'YnNlcnZlcy5hZGRlZCkgew0KICAgICAgICAgICAgICAgICAgICB3aW5kb3cuX3hvYnNlcnZlcy5hZGRl' +
            'ZCA9IFtdOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG5vZGUg' +
            'b2YgbXV0YXRpb24uYWRkZWROb2Rlcykgew0KICAgICAgICAgICAgICAgICAgICBpZiAoIXdpbmRvdy5f' +
            'eG9ic2VydmVzLmFkZGVkLmluY2x1ZGVzKG5vZGUub3V0ZXJIVE1MKSkgew0KICAgICAgICAgICAgICAg' +
            'ICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZXMuYWRkZWQucHVzaChub2RlLm91dGVySFRNTCk7DQogICAg' +
            'ICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGUuY2xhc3NMaXN0KSB7' +
            'DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGFzc2VzID0gQXJyYXkuZnJvbShub2RlLmNs' +
            'YXNzTGlzdCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2xhc3NuYW1lICYmIGNsYXNzZXMu' +
            'aW5jbHVkZXMoY2xhc3NuYW1lKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdy5f' +
            'eG9ic2VydmVzLnN0YXRlW2NsYXNzbmFtZV0gPSAnYWRkZWQnOw0KICAgICAgICAgICAgICAgICAgICAg' +
            'ICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAg' +
            'ICAgIGlmICghd2luZG93Ll94b2JzZXJ2ZXMucmVtb3ZlZCkgew0KICAgICAgICAgICAgICAgICAgICB3' +
            'aW5kb3cuX3hvYnNlcnZlcy5yZW1vdmVkID0gW107DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAg' +
            'ICAgICAgIGZvciAoY29uc3Qgbm9kZSBvZiBtdXRhdGlvbi5yZW1vdmVkTm9kZXMpIHsNCiAgICAgICAg' +
            'ICAgICAgICAgICAgaWYgKCF3aW5kb3cuX3hvYnNlcnZlcy5yZW1vdmVkLmluY2x1ZGVzKG5vZGUub3V0' +
            'ZXJIVE1MKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZXMucmVtb3Zl' +
            'ZC5wdXNoKG5vZGUub3V0ZXJIVE1MKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAg' +
            'ICAgICAgICBpZiAobm9kZS5jbGFzc0xpc3QpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0' +
            'IGNsYXNzZXMgPSBBcnJheS5mcm9tKG5vZGUuY2xhc3NMaXN0KTsNCiAgICAgICAgICAgICAgICAgICAg' +
            'ICAgIGlmIChjbGFzc25hbWUgJiYgY2xhc3Nlcy5pbmNsdWRlcyhjbGFzc25hbWUpKSB7DQogICAgICAg' +
            'ICAgICAgICAgICAgICAgICAgICAgd2luZG93Ll94b2JzZXJ2ZXMuc3RhdGVbY2xhc3NuYW1lXSA9ICdy' +
            'ZW1vdmVkJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0K' +
            'ICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KICAgIHdp' +
            'bmRvdy5feGluaXQgPSAoKSA9PiB7DQogICAgICAgIGNvbnN0IHogPSBkb2N1bWVudC5nZXRFbGVtZW50' +
            'QnlJZCgnWkVVUycpOw0KICAgICAgICBjb25zdCBvID0gd2luZG93Ll94b2JzZXJ2ZSh6LCAoKSA9PiB7' +
            'DQogICAgICAgICAgICBsZXQgaWR4ID0gMDsNCiAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7DQogICAg' +
            'ICAgICAgICAgICAgaWYgKGlkeCA9PT0gd2luZG93Ll94aGVscGVyLmxlbmd0aCkgew0KICAgICAgICAg' +
            'ICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgY29uc3Qg' +
            'eGggPSB3aW5kb3cuX3hoZWxwZXJbaWR4XTsNCiAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGRvY3Vt' +
            'ZW50LnF1ZXJ5U2VsZWN0b3IoeGguc2VsZWN0b3IpOw0KICAgICAgICAgICAgICAgIGlmICh0eXBlb2Yg' +
            'eGguY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmV0' +
            'dmFsID0geGguY2FsbGJhY2soZWwpOw0KICAgICAgICAgICAgICAgICAgICBpZiAocmV0dmFsKSB7DQog' +
            'ICAgICAgICAgICAgICAgICAgICAgICBpZHgrKzsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsN' +
            'CiAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdy5feGhlbHBlci5zcGxpY2UoaWR4LCAxKTsNCiAg' +
            'ICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAg' +
            'ICAgICAgIGlkeCsrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAg' +
            'IGlmICh3aW5kb3cuX3hoZWxwZXIubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAgICAgby5kaXNj' +
            'b25uZWN0KCk7DQogICAgICAgICAgICB9DQogICAgICAgIH0pOw0KICAgIH0NCiAgICB3aW5kb3cuaXNT' +
            'aXBkTG9hZGluZyA9ICgpID0+IHsNCiAgICAgICAgcmV0dXJuIHdpbmRvdy5feHN0YXRlcyAmJiB3aW5k' +
            'b3cuX3hzdGF0ZXMubG9hZGluZyAhPT0gdW5kZWZpbmVkID8gd2luZG93Ll94c3RhdGVzLmxvYWRpbmcg' +
            'OiB0cnVlOw0KICAgIH0NCiAgICB3aW5kb3cuZ2V0U2lwZE1lc3NhZ2VzID0gKCkgPT4gew0KICAgICAg' +
            'ICByZXR1cm4gd2luZG93Ll94bG9ncyA/IHdpbmRvdy5feGxvZ3MgOiBbXTsNCiAgICB9DQogICAgd2lu' +
            'ZG93LmdldFNpcGRMYXN0TWVzc2FnZSA9ICgpID0+IHsNCiAgICAgICAgY29uc3QgbWVzc2FnZXMgPSB3' +
            'aW5kb3cuZ2V0U2lwZE1lc3NhZ2VzKCk7DQogICAgICAgIHJldHVybiBtZXNzYWdlcy5sZW5ndGggPyBt' +
            'ZXNzYWdlc1ttZXNzYWdlcy5sZW5ndGggLSAxXSA6IG51bGw7DQogICAgfQ0KICAgIHdpbmRvdy5jbGVh' +
            'clNpcGRNZXNzYWdlcyA9ICgpID0+IHsNCiAgICAgICAgd2luZG93Ll94bG9ncyA9IFtdOw0KICAgIH0N' +
            'CiAgICB3aW5kb3cuZ2V0T2JzZXJ2ZWRDaGlsZHJlbiA9ICgpID0+IHsNCiAgICAgICAgcmV0dXJuIHdp' +
            'bmRvdy5feG9ic2VydmVzID8/IHt9Ow0KICAgIH0NCiAgICBhZGRFdmVudExpc3RlbmVyKCdsb2FkJywg' +
            'ZSA9PiB3aW5kb3cuX3hpbml0KCkpOw0KfQ0K'
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

class SipdRestartError extends Error {
}

class SipdRetryError extends Error {
}

class SipdCleanAndRetryError extends SipdRetryError {
}

module.exports = {Sipd, SipdAnnouncedError, SipdRestartError, SipdRetryError, SipdCleanAndRetryError};