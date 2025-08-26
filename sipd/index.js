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
        return require('debug')([this.options.tag ?? 'sipd', tag].join(':'));
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
            [w => this.getDriver().getCurrentUrl()],
            [w => this.dismissUpdate(), w => w.getRes(0).indexOf('login') < 0],
            [w => this.navigate('Keluar'), w => w.getRes(0).indexOf('login') < 0],
        ]);
    }

    /**
     * Load additional script on every page load.
     *
     * @returns {Promise<any>}
     */
    handlePageLoad() {
        return this.getDriver().sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
            source: this.getHelperScript(),
        });
    }

    /**
     * Clear SIPD messages.
     *
     * @returns {Promise<any>}
     */
    clearMessages() {
        return this.getDriver().executeScript('clearSipdMessages()');
    }

    /**
     * Get SIPD messages.
     *
     * @returns {Promise<string[]>}
     */
    getMessages() {
        return this.getDriver().executeScript('return getSipdMessages()');
    }

    /**
     * Get SIPD last message.
     *
     * @returns {Promise<string>}
     */
    getLastMessage() {
        return this.getDriver().executeScript('return getSipdLastMessage()');
    }

    /**
     * Get HTML representation on an element.
     *
     * @param {WebElement} el The element
     * @returns {Promise<string>}
     */
    getHtml(el) {
        return this.getDriver().executeScript('return arguments[0].outerHTML', el);
    }

    /**
     * Do submit form.
     *
     * @param {By} form Form element selector
     * @param {By} submit Form submit selector
     * @param {Array} values Form values
     * @param {object} options Submit options
     * @returns {Promise<WebElement>}
     */
    formSubmit(form, submit, values, options = null) {
        options = options || {};
        if (options.wait === undefined) {
            options.wait = 0;
        }
        if (options.dismiss === undefined) {
            options.dismiss = true;
        }
        return this.works([
            [w => this.sleep(this.opdelay)],
            [w => this.fillInForm(
                values,
                form,
                () => this.confirmSubmission(submit, options),
                options.wait,
                form => this.waitSpinner(form))],
            [w => this.sleep(this.opdelay)],
            [w => Promise.resolve(w.getRes(1))],
        ]);
    }

    /**
     * Do confirm submission.
     *
     * @param {By} clicker The confirm clicker
     * @param {object} options Submit options
     * @returns {Promise<WebElement>}
     */
    confirmSubmission(clicker, options = null) {
        options = options || {};
        const success = message => {
            return message === null ||
                message.toLowerCase().includes('berhasil') ||
                message.toLowerCase().includes('dibuat');
        }
        return this.works([
            [w => this.clearMessages()],
            [w => this.waitAndClick(clicker)],
            [w => this.waitSpinner(w.getRes(1), typeof options.spinner === 'string' ? options.spinner : null), w => options.spinner],
            [w => this.sleep(this.opdelay)],
            [w => this.getLastMessage()],
            [w => Promise.resolve(this.debug(dtag)('Form submit return:', w.getRes(4))), w => w.getRes(4)],
            [w => Promise.resolve(w.getRes(1)), w => success(w.getRes(4))],
            [w => Promise.reject(w.getRes(4)), w => !w.getRes(6)],
        ]);
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
     * @returns {Promise<any>}
     */
    waitPage() {
        return new Promise((resolve, reject) => {
            const f = () => {
                let restart = false;
                this.works([
                    [w => this.waitForPresence(By.id('cw-wwwig-gw'), {presence: false, timeout: 0})],
                    [w => this.findElements(By.xpath('//button[text()="Muat Ulang Halaman"]'))],
                    [w => w.getRes(1)[0].click(), w => w.getRes(1).length],
                    [w => Promise.resolve(restart = true), w => w.getRes(1).length],
                ])
                .then(() => {
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
     * @returns {Promise<any>}
     */
    observeChildren({data, options}) {
        if (!options.observed && data.el) {
            options.observed = true;
            return this.getDriver().executeScript('_xchildObserve(arguments[0], arguments[1])', data.el, options.classname);
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
                [w => this.getDriver().executeScript('return getObservedChildren()')],
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
                        let root, parent = res ?? this.getDriver(), n = 3;
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
        return this.getDriver().executeScript('window.scrollTo(0, 0);');
    }

    /**
     * Get additional helper script.
     *
     * @returns {string}
     */
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
                        selector: '[data-rht-toaster]',
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
                                window._xlogs.push(status.textContent);
                            }
                        });
                    }
                }
                window._xchildObserve = (el, classname) => {
                    if (el) {
                        window._xobserves = {};
                        const observer = window._xobserve(el, mutation => {
                            if (!window._xobserves.state) {
                                window._xobserves.state = {};
                            }
                            if (!window._xobserves.added) {
                                window._xobserves.added = [];
                            }
                            for (const node of mutation.addedNodes) {
                                if (!window._xobserves.added.includes(node.outerHTML)) {
                                    window._xobserves.added.push(node.outerHTML);
                                }
                                if (classname && node.classList && node.classList.includes(classname)) {
                                    window._xobserves.state[classname] = 'added';
                                }
                            }
                            if (!window._xobserves.removed) {
                                window._xobserves.removed = [];
                            }
                            for (const node of mutation.removedNodes) {
                                if (!window._xobserves.removed.includes(node.outerHTML)) {
                                    window._xobserves.removed.push(node.outerHTML);
                                }
                                if (classname && node.classList && node.classList.includes(classname)) {
                                    window._xobserves.state[classname] = 'removed';
                                }
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
                window.getObservedChildren = () => {
                    return window._xobserves ?? {};
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