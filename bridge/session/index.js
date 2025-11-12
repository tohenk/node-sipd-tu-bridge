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

const fs = require('fs');
const path = require('path');
const Queue = require('@ntlab/work/queue');
const SipdPage = require('../../sipd/page');
const SipdUtil = require('../../sipd/util');
const { Sipd, SipdAnnouncedError } = require('../../sipd');
const { SipdColumnQuery } = require('../../sipd/query');
const { SipdActivitySelector } = require('./activity');
const { SipdQueryBase, SipdVoterPegawai, SipdVoterRekanan, SipdQueryRekanan, SipdVoterNpd } = require('./pages');
const { By, Key, WebElement } = require('selenium-webdriver');

const dtag = 'session';

/**
 * Provides base functionality to work with SIPD feature.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdSession {

    fn = ['stop', 'sleep', 'captchaImage', 'solveCaptcha', 'reloadCaptcha']

    constructor(options) {
        this.options = options;
        this.bridge = options.bridge;
        this.sipd = new Sipd(options);
        this.works = this.sipd.works;
        this.initialize();
        this.doInitialize();
    }

    initialize() {
        const ctx = this.sipd;
        for (const fn of this.fn) {
            this[fn] = function(...args) {
                return this.sipd[fn].apply(ctx, args);
            }
        }
        const normalizers = {
            tgl: value => SipdUtil.getDate(value),
            num: value => parseInt(SipdUtil.pickNumber(value)),
            nom: value => parseFloat(SipdUtil.pickCurr(value)),
            nr: value => SipdUtil.pickNumber(value),
            nama: value => {
                if (typeof value === 'string') {
                    value = SipdUtil.getSafeStr(value);
                    if (value.includes('\n')) {
                        value = value.split('\n')[0];
                    }
                }
                return value;
            },
            default: value => typeof value === 'string' ? SipdUtil.getSafeStr(value) : value,
        }
        const stringables = {
            tgl: value => SipdUtil.dateSerial(value),
            nom: value => SipdUtil.fmtCurr(value),
            default: value => value.toString(),
        }
        for (const [normalizer, fn] of Object.entries(normalizers)) {
            if (SipdColumnQuery.normalizers[normalizer] === undefined) {
                SipdColumnQuery.normalizers[normalizer] = fn;
            }
        }
        for (const [stringable, fn] of Object.entries(stringables)) {
            if (SipdColumnQuery.stringables[stringable] === undefined) {
                SipdColumnQuery.stringables[stringable] = fn;
            }
        }
        // PDF optimizer using Ghostscript:
        // {
        //     "global": {
        //         "pdfOptimize": {
        //           "bin": "gs",
        //           "args": [
        //              "-q",
        //              "-dNOPAUSE",
        //              "-dBATCH",
        //              "-dSAFER",
        //              "-dSimulateOverprint=true",
        //              "-sDEVICE=pdfwrite",
        //              "-dCompatibilityLevel=1.4",
        //              "-dPDFSETTINGS=/ebook",
        //              "-dEmbedAllFonts=true",
        //              "-dSubsetFonts=true",
        //              "-dAutoRotatePages=/None",
        //              "-dColorImageDownsampleType=/Bicubic",
        //              "-dColorImageResolution=100",
        //              "-dGrayImageDownsampleType=/Bicubic",
        //              "-dGrayImageResolution=100",
        //              "-dMonoImageDownsampleType=/Bicubic",
        //              "-dMonoImageResolution=100",
        //              "-sOutputFile=\"%OUT%\"",
        //              "\"%IN%\""
        //           ]
        //     }
        // }
        if (this.options.pdfOptimize) {
            let pdfOptimizer = this.options.pdfOptimize;
            if (pdfOptimizer.bin && Array.isArray(pdfOptimizer.args)) {
                pdfOptimizer = `${pdfOptimizer.bin} ${pdfOptimizer.args.join(' ')}`;
            }
            this.pdfOptimizer = pdfOptimizer;
        }
    }

    doInitialize() {
    }

    debug(tag) {
        return this.sipd.debug(tag);
    }

    onStateChange(handler) {
        if (typeof handler === 'function') {
            this.sipd.onState = handler;
        }
    }

    state() {
        return this.sipd.state;
    }

    ready() {
        return this.sipd.ready;
    }

    /**
     * Create account charge.
     *
     * @param {string} key The key
     * @returns {SipdSession}
     */
    createAfektasi(key) {
        key = key.toLowerCase();
        this[key] = SipdAfektasi.get(key);
        return this;
    }

    /**
     * Get account charge.
     *
     * @param {string} key The key
     * @returns {SipdAfektasi}
     */
    getAfektasi(key) {
        key = key.toLowerCase();
        if (this[key] === undefined || !this[key] instanceof SipdAfektasi) {
            throw new Error(`Account charges ${key} is not registered!`);
        }
        return this[key];
    }

    genFilename(dir, filename) {
        return path.join(this.options.workdir, dir, filename);
    }

    saveFile(filepath, content) {
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        if (fs.existsSync(dir)) {
            fs.writeFileSync(filepath, content);
        }
    }

    saveCaptcha(data, dir = 'captcha') {
        if (typeof data === 'string') {
            const [mimetype, payload] = data.split(';');
            const [encoding, content] = payload.split(',');
            if (content) {
                const buff = Buffer.from(content, encoding);
                const shasum = require('crypto')
                    .createHash('md5')
                    .update(buff)
                    .digest('hex');
                const filename = this.genFilename(dir, shasum + '.' + (mimetype.indexOf('png') > 0 ? 'png' : 'jpg'));
                this.saveFile(filename, buff);
                return filename;
            }
        }
    }

    /**
     * Get flag modifiers for input string.
     *
     * @param {string} flags Flag modifiers
     * @param {string} s The input string
     * @param {boolean} multiple True to allows multiple modifier
     * @returns {string[]}
     */
    getFlags(flags, s, multiple = false) {
        const res = [];
        if (typeof flags === 'string') {
            flags = flags.split('');
        }
        if (!Array.isArray(flags)) {
            flags = [flags];
        }
        while (true) {
            if (flags.includes(s.substr(0, 1))) {
                res.push(s.substr(0, 1));
                s = s.substr(1);
                if (multiple) {
                    continue;
                } else {
                    break;
                }
            }
            break;
        }
        return res;
    }

    /**
     * Get form key data which includes element selector, modifiers, and
     * selector modifiers.
     *
     * @param {string} key Form field key
     * @returns {object}
     */
    getFormKey(key) {
        const res = {};
        // flags:
        // + add wait
        // ? perform read operatiron
        // * required
        // ~ optional
        // $ set value using javascript
        // - ignored, used to duplicate selector
        // & advance date to skip holiday
        res.flags = this.getFlags('+?*~$-&', key, true);
        if (res.flags.length) {
            key = key.substr(res.flags.length);
        }
        // check parent
        if (key.indexOf('!') > 1) {
            const part = key.split('!');
            res.parent = part[0];
            key = part[1];
        }
        // selector flags:
        // # id selector
        // = xpath selector
        res.sflags = this.getFlags('#=', key);
        if (res.sflags.length) {
            key = key.substr(res.sflags.length);
        }
        res.selector = key;
        return res;
    }

    /**
     * Is queue editable?
     *
     * @param {object} queue The queue
     * @returns {boolean}
     */
    isEditable(queue) {
        return !queue.readonly;
    }

    /**
     * Get form submit number of retry.
     *
     * @param {object} queue The queue
     * @returns {number}
     */
    getRetry(queue) {
        return Array.isArray(queue.files) && queue.files.length ? 3 : 0;
    }

    /**
     * Wait for state to be ready.
     *
     * @returns {Promise<any>}
     */
    waitUntilReady() {
        return new Promise((resolve, reject) => {
            const f = () => {
                if (this.ready()) {
                    resolve();
                } else {
                    setTimeout(f, 100);
                }
            }
            f();
        });
    }

    /**
     * Execute startup command.
     *
     * @returns {Promise<any>}
     */
    doStartup() {
        if (!this.options.startup) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const cmd = `${this.options.startup}`.replace(/%BRIDGE%/g, this.bridge.name);
            const exec = require('child_process').exec;
            exec(cmd, (err, stdout, stderr) => {
                this.debug(dtag)('Startup', cmd, err ? `failed with ${err}` : 'completed');
                resolve(err);
            });
        });
    }

    /**
     * Do start of work.
     *
     * @returns {Promise<any>}
     */
    start() {
        return this.works([
            [w => this.waitUntilReady(), w => !this.sipd.ready],
            [w => this.doStartup(), w => this.options.startup],
            [w => this.sipd.open()],
        ]);
    }

    /**
     * Login to SIPD Penatausahaan.
     *
     * @returns {Promise<any>}
     */
    login() {
        return this.works([
            [w => this.start()],
            [w => this.sipd.login(this.cred.username, this.cred.password, [this.cred.role, this.cred.idx])],
        ]);
    }

    /**
     * Get tippy text content.
     *
     * @param {WebElement} el Tippy element
     * @returns {Promise<string>}
     */
    getTippy(el) {
        return this.sipd.driver.executeScript(
            function(el) {
                if (el._tippy && el._tippy.popper) {
                    return el._tippy.popper.innerText;
                }
            }, el);
    }

    /**
     * Get progress value.
     *
     * @param {WebElement} el Progress element
     * @returns {Promise<string>}
     */
    getProgress(el, selector) {
        let res;
        return this.works([
            [w => el.findElements(selector)],
            [w => new Promise((resolve, reject) => {
                const q = new Queue([...w.getRes(0).reverse()], p => {
                    if (!res) {
                        this.works([
                            [x => p.getAttribute('innerHTML')],
                            [x => p.findElement(By.xpath('../*[@class="stepProgressBar__step__button__label"]'))],
                            [x => x.getRes(1).getAttribute('innerText')],
                            [x => Promise.resolve(res = x.getRes(2)), x => x.getRes(0)],
                        ])
                        .then(() => q.next())
                        .catch(err => reject(err));
                    } else {
                        q.next();
                    }
                });
                q.once('done', () => resolve(res ?? (w.getRes(0).length ? this.progressInitialValue : null)));
            })],
        ]);
    }

    /**
     * Get row data for data paging colums.
     *
     * @param {SipdColumnQuery[]} columns Columns data
     * @param {WebElement} el The Element
     * @returns {Promise<object>}
     */
    getRowData(columns, el) {
        return new Promise((resolve, reject) => {
            const res = {};
            const q = new Queue([...columns], col => {
                let works;
                switch (col.type) {
                    case SipdColumnQuery.COL_ACTION:
                        works = [
                            [w => this.sipd.findElement({el, data: col.xpath})]
                        ];
                        break;
                    case SipdColumnQuery.COL_PROGRESS:
                        works = [
                            [w => this.getProgress(el, col.xpath)]
                        ];
                        break;
                    default:
                        const tippy = col.tippyXpath;
                        if (tippy) {
                            works = [
                                [w => el.findElements(tippy)],
                                [w => this.getTippy(w.res[0]), w => w.res.length],
                            ];
                        } else {
                            works = [
                                [w => this.sipd.getText([col.xpath], el)],
                                [w => Promise.resolve(w.res[0])],
                            ];
                        }
                        break;
                }
                this.works([
                    ...works,
                    [w => Promise.resolve(res[col.name] = typeof w.res === 'string' ? col.normalize(w.res) : w.res)],
                ])
                .then(() => q.next())
                .catch(err => reject(err));
            });
            q.once('done', () => resolve(res));
        });
    }

    /**
     * Perform data query match operation.
     *
     * @param {SipdQueryBase} query Query data
     * @returns {Promise<WebElement|undefined>}
     */
    doQuery(query) {
        let result, clicker, statusCol, actionCol, expectedValue;
        return this.works([
            [w => this.sipd.navigate(...query.navigates), w => query.navigates],
            [w => this.sipd.waitLoader()],
            [w => this.sipd.gotoPageTop(), w => query.group],
            [w => this.sipd.subPageNav(...(Array.isArray(query.group) ? query.group : [query.group])), w => query.group],
            [w => query.page.setup()],
            [w => query.page.search(...(Array.isArray(query.search) ? query.search : [query.search])), w => query.search],
            [w => query.page.each(el => [
                [x => this.getRowData(query.columns, el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0);
                    const dbg = (l, s) => `${l} (${s ? '✓' : '✗'})`;
                    const f = (...args) => {
                        const res = {
                            states: [],
                            info: [],
                        }
                        for (const arg of args) {
                            if (arg[2]) {
                                let okay;
                                if (typeof arg[0] === 'string' && typeof arg[1] === 'string') {
                                    okay = arg[0].toLowerCase() === arg[1].toLowerCase();
                                } else {
                                    okay = arg[0] == arg[1];
                                }
                                res.states.push(okay);
                                res.info.push(dbg(arg[1], okay));
                            } else {
                                res.info.push(arg[1]);
                            }
                        }
                        res.okay = true;
                        res.states.forEach(state => {
                            if (!state) {
                                res.okay = false;
                                return true;
                            }
                        });
                        return res;
                    }
                    const compares = [];
                    for (const [col, value, required] of query.diffs) {
                        const column = query.columns.find(column => column.name === col);
                        if (column) {
                            compares.push([column.asString(value), column.asString(values[col]), required !== undefined ? required : true]);
                        }
                    }
                    expectedValue = compares
                        .filter(v => v[2])
                        .map(v => v[0])
                        .join('-');
                    statusCol = query.columns.find(column => [SipdColumnQuery.COL_STATUS, SipdColumnQuery.COL_PROGRESS].includes(column.type));
                    actionCol = query.columns.find(column => column.type === SipdColumnQuery.COL_ACTION);
                    let status;
                    if (statusCol) {
                        status = values[statusCol.name];
                    }
                    const states = f(...compares);
                    const rowstate = `[${states.okay ? '✓' : '✗'}]`;
                    if (status !== undefined) {
                        this.debug(dtag)('Row state:', rowstate, `<${status}>`, ...states.info);
                    } else {
                        this.debug(dtag)('Row state:', rowstate, ...states.info);
                    }
                    if (states.okay) {
                        result = el;
                        if (query.isActionEnabled() && actionCol) {
                            clicker = values[actionCol.name];
                        }
                        if (status !== undefined) {
                            query.data.STATUS = status;
                        }
                        query.data.values = values;
                        if (typeof query.onResult === 'function') {
                            query.onResult();
                        }
                        reject(SipdPage.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [w => Promise.resolve(result), w => !query.isActionEnabled()],
            [w => clicker.click(), w => query.isActionEnabled() && clicker],
            [w => Promise.reject(new SipdAnnouncedError(`${query.options.title}: ${expectedValue} not found!`)), w => query.isActionEnabled() && actionCol && !clicker],
        ]);
    }

    executeAction(queue, action, status) {
        if (queue.STATUS === status && queue.values && queue.values.action) {
            const el = queue.values.action;
            return this.works([
                [w => el.click()],
                [w => this.sipd.click({el, data: By.xpath(`../div/div/button/span/p[text()="${action}"]/../..`)})],
            ]);
        } else {
            return Promise.resolve();
        }
    }

    dismissModal(title) {
        return this.sipd.waitAndClick(By.xpath(`//header[text()="${title}"]/../button[@aria-label="Close"]`));
    }

    readValue(el, value, queue) {
        return this.works([
            [w => el.getAttribute('type')],
            [w => el.getAttribute(w.getRes(0) === 'checkbox' ? 'checked' : 'value')],
            [w => Promise.resolve(queue[value] = w.getRes(1))],
        ]);
    }

    fillComboBox(el, value) {
        return this.works([
            [w => el.click()],
            [w => el.getAttribute('aria-controls')],
            [w => this.sipd.findElements(By.xpath(`//*[@id="${w.getRes(1)}"]/div[contains(text(),"${value}")]`))],
            [w => Promise.reject(`Combobox value ${value} not available!`), w => w.getRes(2).length === 0],
            [w => w.getRes(2)[0].click(), w => w.getRes(2).length],
        ]);
    }

    fillRadio(el, value) {
        return this.works([
            [w => el.getAttribute('value')],
            [w => el.findElement(By.xpath('..')), w => w.getRes(0) == value],
            [w => w.getRes(1).click(), w => w.getRes(0) == value],
        ]);
    }

    fillDatePicker(el, value) {
        return this.works([
            [w => Promise.reject(`Date "${value}" is not valid!`), w => value instanceof Date && isNaN(value)],
            [w => this.sipd.clickWait(el)],
            [w => el.getAttribute('readonly')],
            [w => this.flatpickrGet()],
            [w => this.flatpickrPick(w.getRes(3), value)],
            [w => el.sendKeys(Key.TAB), w => w.getRes(2)],
            [w => el.getAttribute('value')],
            [w => Promise.resolve(SipdUtil.getDate(w.getRes(6)))],
            [w => Promise.reject(`Date ${w.getRes(7)} is not expected of ${value}!`), w => SipdUtil.dateSerial(value) != SipdUtil.dateSerial(w.getRes(7))],
        ]);
    }

    fillDatePicker2(el, value) {
        return this.works([
            [w => Promise.reject(`Date "${value}" is not valid!`), w => value instanceof Date && isNaN(value)],
            [w => this.sipd.driver.executeScript(
                function(el, date) {
                    if (el._flatpickr) {
                        el._flatpickr.setDate(date);
                        return el._flatpickr.selectedDates[el._flatpickr.selectedDates.length - 1].toString();
                    }
                }, el, value)],
            [w => Promise.resolve(SipdUtil.getDate(w.getRes(1)))],
            [w => Promise.reject(`Date ${w.getRes(2)} is not expected of ${value}!`), w => SipdUtil.dateSerial(value) != SipdUtil.dateSerial(w.getRes(2))],
        ]);
    }

    fillRole(el, value) {
        return this.works([
            [w => el.click()],
            [w => this.doQuery(new SipdVoterPegawai(this.sipd, {value}))],
        ]);
    }

    fillRekanan(el, value) {
        return this.works([
            [w => el.click()],
            [w => this.doQuery(new SipdVoterRekanan(this.sipd, {value}))],
        ]);
    }

    fillNpd(el, value, queue) {
        return this.works([
            [w => el.click()],
            [w => this.doQuery(new SipdVoterNpd(this.sipd, {value, queue}))],
        ]);
    }

    fillKegiatan(el, value) {
        let fulfilled = false;
        /** @type {SipdActivitySelector} */
        const selector = this.kegSeq++ === 0 ? this.kegSelector : this.subkegSelector;
        return this.works([
            [w => el.click()],
            [w => this.sipd.waitForPresence(selector.loadingSelector, {presence: false, timeout: 0})],
            [w => this.sipd.waitAndClick(selector.clicker), w => selector.clicker],
            [w => this.sipd.findElements(selector.listSelector)],
            [w => new Promise((resolve, reject) => {
                const items = w.getRes(3);
                const q = new Queue(items, item => {
                    let itemText;
                    this.works([
                        [x => item.getAttribute('innerText')],
                        [x => Promise.resolve(SipdUtil.pickKeg(x.getRes(0)))],
                        [x => Promise.resolve(SipdUtil.matchKeg(x.getRes(1), value))],
                        [x => item.findElement(selector.chooseSelector), x => x.getRes(2)],
                        [x => x.getRes(3).click(), x => x.getRes(2)],
                        [x => Promise.resolve(fulfilled = true), x => x.getRes(2)],
                        [x => Promise.resolve(itemText = x.getRes(1))],
                    ])
                    .then(() => {
                        this.debug(dtag)(`Fill activity: ${itemText}, done = ${fulfilled ? 'yes' : 'no'}`);
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
            [w => this.sipd.sleep(this.sipd.opdelay), w => fulfilled],
        ]);
    }

    fillAfektasi(el, value, afektasi) {
        return this.works([
            [w => this.sipd.waitForPresence({el, data: By.xpath('.//div/div/div[@class="animate-pulse"]')}, {presence: false, timeout: 0})],
            [w => this.sipd.sleep(this.sipd.opdelay)],
            [w => this.sipd.findElements(By.xpath('//div[@class="css-kw-3t-2fa3"]/div/div/div[@class="col-span-7"]/div/div[1]/div/span[1]'))],
            [w => this.fillAccount(w.getRes(2), value, afektasi)],
            [w => Promise.reject(`Unable to allocate ${SipdUtil.fmtCurr(value)} to ${afektasi.keg}-${afektasi.rek}, available ${SipdUtil.fmtCurr(afektasi.sisa)}!`), w => !w.getRes(3)],
        ]);
    }

    fillAccount(accounts, value, afektasi) {
        return new Promise((resolve, reject) => {
            let result = false;
            const q = new Queue(accounts, el => {
                this.works([
                    [w => this.isAccount(el, afektasi)],
                    [w => this.canFillAccount(el, value, afektasi), w => w.getRes(0)],
                ])
                .then(res => {
                    if (res) {
                        result = true;
                        q.done();
                    } else {
                        q.next();
                    }
                })
                .catch(err => reject(err));
            });
            q.once('done', () => resolve(result));
        });
    }

    isAccount(el, afektasi) {
        return this.works([
            [w => el.getAttribute('innerText')],
            [w => Promise.resolve(SipdUtil.pickCurr(w.getRes(0)) === afektasi.rek)],
        ]);
    }

    canFillAccount(el, value, afektasi) {
        return this.works([
            [w => el.findElement(By.xpath('../../../../../div[@class="col-span-5"]/div/div/input'))],
            [w => el.findElement(afektasi.kuota === 1 ?
                By.xpath('../../../../../div[@class="col-span-5"]/div/p[2]') : By.xpath('../div/span')
            )],
            [w => Promise.resolve(w.getRes(1).getAttribute('innerText'))],
            [w => Promise.resolve(afektasi.sisa = parseFloat(SipdUtil.pickCurr(w.getRes(2))))],
            [w => this.sipd.fillInput(w.getRes(0), null, this.options.clearUsingKey), w => afektasi.sisa >= value],
            [w => new Promise((resolve, reject) => {
                const input = w.getRes(0);
                const chars = value.toString().split('');
                const f = () => {
                    if (chars.length) {
                        const x = chars.shift();
                        input.sendKeys(x)
                            .then(() => setTimeout(f, this.sipd.typedelay))
                            .catch(err => reject(err));
                    } else {
                        resolve(true);
                    }
                }
                f();
            }), w => afektasi.sisa >= value],
            [w => Promise.resolve(false), w => afektasi.sisa < value],
        ]);
    }

    flatpickrGet() {
        return this.works([
            [w => this.sipd.findElements(By.xpath('//div[contains(@class,"flatpickr-calendar")]'))],
            [w => new Promise((resolve, reject) => {
                let res = null;
                const q = new Queue([...w.getRes(0)], dtpicker => {
                    this.works([
                        [x => dtpicker.getAttribute('class')],
                        [x => Promise.resolve(res = dtpicker), x => x.getRes(0).indexOf('open') >= 0],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve(res));
            })],
        ]);
    }

    flatpickrPick(el, date) {
        return this.works([
            [w => el.findElement(By.xpath('.//input[@aria-label="Year"]'))],
            [w => w.getRes(0).getAttribute('value')],
            [w => this.sipd.fillInput(w.getRes(0), date.getFullYear()), w => w.getRes(1) != date.getFullYear()],
            [w => el.findElement(By.xpath('.//select[@aria-label="Month"]'))],
            [w => w.getRes(3).getAttribute('value')],
            [w => this.sipd.fillSelect(w.getRes(3), date.getMonth()), w => w.getRes(4) != date.getMonth()],
            [w => el.findElements(By.xpath(`.//div[@class="dayContainer"]/span[contains(@class,"flatpickr-day") and text()="${date.getDate()}"]`))],
            [w => this.flatpickrDay(w.getRes(6), date)],
        ]);
    }

    flatpickrDay(days, date) {
        return new Promise((resolve, reject) => {
            let picked = false;
            const dayOkay = s => {
                if (s) {
                    for (const state of ['flatpickr-disabled', 'nextMonthDay', 'prevMonthDay']) {
                        if (s.includes(state)) {
                            return false;
                        }
                    }
                    return true;
                }
            }
            const q = new Queue([...days], flatpickrDay => {
                let dayel;
                this.works([
                    [w => flatpickrDay.getAttribute('outerHTML')],
                    [w => Promise.resolve(dayel = w.getRes(0))],
                    [w => flatpickrDay.getAttribute('class')],
                    [w => Promise.resolve(dayOkay(w.getRes(2)))],
                    [w => flatpickrDay.click(), w => w.getRes(3)],
                    [w => Promise.resolve(picked = true), w => w.getRes(3)],
                ])
                .then(() => {
                    if (picked) {
                        this.debug(dtag)('Picked day', dayel);
                        q.done();
                    } else {
                        this.debug(dtag)('Skipped day', dayel);
                        q.next();
                    }
                })
                .catch(err => reject(err));
            });
            q.once('done', () => {
                if (!picked) {
                    reject(`Unable to fill date ${date}!`);
                } else {
                    resolve();
                }
            });
        });
    }

    handleFormFill(name, queue, files) {
        const result = [];
        const maps = queue.getMap(name);
        const trunc = (s, len = 100) => {
            if (Array.isArray(s)) {
                s = s.map(s => trunc(s, len));
            }
            if (s instanceof Buffer) {
                s = s.toString();
            }
            if (typeof s === 'string' && s.length > len) {
                s = s.substr(0, len) + '...';
            }
            return s;
        }
        delete this.afektasi;
        this.kegSeq = 0;
        for (const k of Object.keys(maps)) {
            const selector = [];
            const f = this.getFormKey(k);
            let key = f.selector, attr, vcond, vtype, data, afektasi;
            switch (true) {
                case f.sflags.includes('#'):
                    attr = 'id';
                    break;
                case f.sflags.includes('='):
                    break;
                default:
                    attr = 'name';
                    break;
            }
            let value = queue.getMappedData([name, k]);
            this.debug(dtag)(`Mapped value ${name + '->' + key} = ${trunc(value)}`);
            // fall back to non mapped value if undefined
            if (value === undefined) {
                if (f.flags.includes('*')) {
                    throw new Error(`Form ${name}: ${key} value is mandatory`);
                }
                value = maps[k];
            }
            // handle condition or special value
            if (typeof value === 'string' && queue.getMap([name, k]) === value) {
                // condition (?) with evaluated values separated by comma (,)
                let okay, p = value.indexOf('?');
                if (p > 0) {
                    vcond = value.substr(0, p);
                    value = value.substr(p + 1);
                    const operators = {
                        '!=': (a, b) => a !== b,
                        '<=': (a, b) => a <= b,
                        '>=': (a, b) => a >= b,
                        '<':  (a, b) => a < b,
                        '>':  (a, b) => a > b,
                        '=':  (a, b) => a === b,
                    }
                    for (const [op, fn] of Object.entries(operators)) {
                        if (vcond.indexOf(op) > 0) {
                            const params = vcond.split(op).map(p => p.trim());
                            for (let i = 0; i < params.length; i++) {
                                const pvalue = queue.getDataValue(params[i]);
                                if (pvalue !== undefined) {
                                    params[i] = pvalue;
                                }
                            }
                            okay = fn(params[0], params[1]);
                            break;
                        }
                    }
                    this.debug(dtag)(`Condition ${vcond} evaluated to ${okay ? 'true' : 'false'}`);
                    const [vtrue, vfalse] = value.split(',');
                    value = okay ? vtrue : vfalse;
                    if (!value) {
                        continue;
                    }
                }
                // special value TYPE:value
                p = value.indexOf(':');
                if (p > 0) {
                    vtype = value.substr(0, p);
                    value = value.substr(p + 1);
                }
            }
            // handle special value TYPE:value
            if (vtype) {
                const v = queue.getDataValue(value);
                if (v === undefined) {
                    // try multiple values
                    if (value.indexOf('|') > 0) {
                        const values = [];
                        value.split('|').forEach(val => {
                            const vv = queue.getDataValue(val);
                            values.push(vv !== undefined ? vv : val);
                        });
                        if (values.length) {
                            value = values;
                        }
                    }
                } else {
                    value = v;
                }
                this.debug(dtag)(`Special TYPE:value ${name + '->' + key} = ${trunc(value)}`);
            }
            // check for safe string
            if (typeof value === 'string' && value.length) {
                value = SipdUtil.getSafeStr(value);
            }
            // handle special key
            if (key.indexOf(':') > 0) {
                const y = key.split(':');
                key = y[1];
                afektasi = this.getAfektasi(y[0])
                    .set(key, value);
            }
            if (!f.sflags.includes('=')) {
                selector.push(`[@${attr}="${key}"]`);
            }
            if (afektasi) {
                if (!this.afektasi) {
                    this.afektasi = afektasi;
                }
            } else {
                data = {
                    target: By.xpath(f.sflags.includes('=') ? key : `.//*${selector.join('')}`),
                    value
                }
                // check form parent
                if (f.parent) {
                    if (f.parent.substring(0, 1) === '#') {
                        data.parent = By.id(f.parent.substring(1));
                    } else {
                        data.parent = By.xpath(f.parent);
                    }
                }
            }
            // form data and handler
            if (data) {
                switch (vtype) {
                    case 'RADIO':
                        data.onfill = (el, value) => this.fillRadio(el, value);
                        break;
                    case 'ROLE':
                        data.onfill = (el, value) => this.fillRole(el, SipdUtil.normalize(this.bridge.getUser(value)?.username));
                        break;
                    case 'REKANAN':
                        data.onfill = (el, value) => this.fillRekanan(el, value);
                        break;
                    case 'KEG':
                        data.onfill = (el, value) => this.fillKegiatan(el, value);
                        break;
                    case 'NPD':
                        data.onfill = (el, value) => this.fillNpd(el, value, queue);
                        break;
                    case 'AFEKTASI':
                        data.onfill = (el, value) => {
                            if (this.afektasi) {
                                if (this.afektasi.isValid()) {
                                    return this.fillAfektasi(el, value, this.afektasi);
                                }
                                return Promise.reject('Unable to fill allocation with invalid metadata!');
                            } else {
                                return Promise.reject('Unable to fill allocation without metadata!');
                            }
                        }
                        break;
                    case 'FILE':
                    case 'PDF':
                        data.onfill = (el, value) => new Promise((resolve, reject) => {
                            if (value) {
                                this.storeFile(queue, value, vtype === 'PDF' ? 'pdf' : 'tmp')
                                    .then(filename => {
                                        if (!files.includes(filename)) {
                                            files.push(filename);
                                        }
                                        el.sendKeys(filename)
                                            .then(() => resolve(true))
                                            .catch(err => reject(err));
                                    })
                                    .catch(err => reject(err));
                            } else {
                                resolve();
                            }
                        });
                        break;
                    case 'DO':
                        data.onfill = (el, value) => {
                            switch (value.toLowerCase()) {
                                case 'click':
                                    return el.click();
                            }
                            throw new Error(`Invalid DO action: ${value}!`)
                        }
                        break;
                }
                switch (true) {
                    // read operation
                    case f.flags.includes('?'):
                        data.onfill = (el, value) => this.readValue(el, value, queue);
                        break;
                    // fill value using javascript
                    case f.flags.includes('$'):
                        data.onfill = (el, value) => this.sipd.driver.executeScript(
                            function(el, value) {
                                $(el).val(value);
                            }, el, value);
                        break;
                    // add waiting
                    case f.flags.includes('+'):
                        data.done = (d, next) => {
                            this.debug(dtag)(`Wait ${this.sipd.opdelay} ms before continuing`);
                            this.sipd.sleep(this.sipd.opdelay)
                                .then(() => next())
                                .catch(err => {
                                    throw err;
                                });
                        }
                        break;
                    // optional
                    case f.flags.includes('~'):
                        data.optional = true;
                        break;
                }
                // generic handler of special tag
                if (!data.onfill) {
                    // date time picker
                    if (key.toLowerCase().includes('tanggal')) {
                        data.onfill = (el, value) => this.fillDatePicker(el, SipdUtil.getDate(value, f.flags.includes('&')));
                    }
                    data.canfill = (tag, el, value) => {
                        return new Promise((resolve, reject) => {
                            let result = false;
                            this.works([
                                [w => el.getAttribute('role')],
                                [w => this.fillComboBox(el, value), w => w.getRes(0) === 'combobox'],
                                [w => Promise.resolve(result = true), w => w.getRes(0) === 'combobox'],
                            ])
                            .then(() => resolve(result))
                            .catch(err => reject(err));
                        });
                    }
                }
                data.prefill = (el, value) => {
                    this.debug(dtag)(`Do fill ${name + '->' + key} with ${trunc(value)}`);
                }
                data.afterfill = el => this.works([
                    [w => this.sipd.isStale(el)],
                    [w => this.getError(el), w => !w.getRes(0)],
                    [w => Promise.reject(w.getRes(1)), w => !w.getRes(0) && w.getRes(1)],
                    [w => Promise.resolve(), w => w.getRes(0) || !w.getRes(1)],
                ]);
                if (this.options.clearUsingKey) {
                    data.clearUsingKey = true;
                }
                result.push(data);
            }
        }
        return result;
    }

    getError(el) {
        return this.works([
            [w => el.getAttribute('class')],
            [w => Promise.resolve(w.getRes(0).includes('has-error-merged'))],
            [w => Promise.resolve(w.getRes(0).includes('has-error'))],
            // element is an error container
            [w => this.getValidationError(el), w => w.getRes(1) || w.getRes(2)],
            // has-error may not result in error message
            // so, lookup parent for error
            // but stop when reach body or head
            [w => el.getTagName(), w => !w.getRes(3) && !w.getRes(1)],
            [w => Promise.resolve(['body', 'head'].includes(w.getRes(4).toLowerCase())), w => !w.getRes(3) && !w.getRes(1)],
            [w => el.findElements(By.xpath('..')), w => !w.getRes(3) && !w.getRes(1) && !w.getRes(5)],
            [w => this.getError(w.getRes(6)[0]), w => !w.getRes(3) && !w.getRes(1) && !w.getRes(5) && w.getRes(6).length],
            // no error found
            [w => Promise.resolve(), w => !w.getRes(3) && !w.getRes(1) && w.getRes(5)],
        ]);
    }

    getValidationError(el) {
        return this.works([
            [w => el.findElements(By.xpath('./div[contains(@class,"text-danger-500")]'))],
            [w => w.getRes(0)[0].getAttribute('innerText'), w => w.getRes(0).length],
            [w => Promise.resolve(), w => !w.getRes(0).length],
        ]);
    }

    fillForm(queue, name, form, submit, options = null) {
        if (!queue.files) {
            queue.files = [];
        }
        delete queue.filesize;
        return this.sipd.formSubmit(form,
            submit,
            this.handleFormFill(name, queue, queue.files),
            {
                ...(options || {}),
                postfillCallback: form => {
                    if (this.options.waitFileUpload && queue.filesize) {
                        const multiplier = Math.ceil(queue.filesize / (100 * 1024));
                        const ms = this.sipd.delay * multiplier;
                        this.debug(dtag)('Wait for file upload in', ms, 'ms');
                        return this.sipd.sleep(ms);
                    } else {
                        return Promise.resolve();
                    }
                },
                onerror: message => `Form ${name} failed: ${message}!`,
            }
        );
    }

    cleanFiles(queue) {
        if (Array.isArray(queue.files) && queue.files.length) {
            return new Promise((resolve, reject) => {
                const q = new Queue(queue.files, file => {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                    }
                    q.next();
                });
                q.once('done', () => resolve());
            });
        } else {
            return Promise.resolve();
        }
    }

    storeFile(queue, value, ext) {
        return new Promise((resolve, reject) => {
            let maxSize, tmpdirname = 'temp';
            if (Array.isArray(value)) {
                if (value.length > 1) {
                    maxSize = value[1];
                }
                value = value[0];
            }
            // is it saved buffer?
            if (typeof value === 'object' && value.type === 'Buffer' && value.data) {
                value = Buffer.from(value.data);
            }
            if (!Buffer.isBuffer(value)) {
                return reject('Value for file upload must be buffer!');
            }
            let storedFile = this.genFilename(tmpdirname, `${queue.id}.${ext}`);
            let storedSize = value.byteLength;
            let maxSizeByte, saved = false;
            const done = () => {
                if (maxSizeByte && storedSize > maxSizeByte) {
                    reject(`File size is larger than ${maxSize}!`);
                } else {
                    if (!saved) {
                        this.saveFile(storedFile, value);
                    }
                    if (fs.existsSync(storedFile)) {
                        queue.filesize = storedSize;
                        resolve(storedFile);
                    } else {
                        reject(`File not found ${storedFile}!`);
                    }
                }
            }
            if (maxSize) {
                maxSizeByte = SipdUtil.getBytes(maxSize);
                // optimize PDF when size is larger than expected
                if (ext === 'pdf' && storedSize > maxSizeByte && typeof this.pdfOptimizer === 'string') {
                    const tmpfile = this.genFilename(tmpdirname, `${queue.id}.orig.${ext}`);
                    this.saveFile(tmpfile, value);
                    const exec = require('child_process').exec;
                    const cmd = this.pdfOptimizer
                        .replace(/%IN%/g, tmpfile)
                        .replace(/%OUT%/g, storedFile);
                    exec(cmd, (err, stdout, stderr) => {
                        if (!err && fs.existsSync(storedFile)) {
                            saved = true;
                            const newSize = fs.statSync(storedFile).size;
                            this.debug(dtag)(`Optimized PDF size ${newSize}, original was ${storedSize}`);
                            // is optimized PDF reduced in size?
                            if (newSize < storedSize) {
                                fs.unlinkSync(tmpfile);
                                storedSize = newSize;
                            } else {
                                // use original
                                fs.unlinkSync(storedFile);
                                storedFile = tmpfile;
                            }
                            done();
                        } else {
                            if (fs.existsSync(tmpfile)) {
                                fs.unlinkSync(tmpfile);
                            }
                            let msg = err instanceof Error ? err.toString() : err;
                            if (!msg) {
                                msg = stderr.toString().trim();
                            }
                            if (msg) {
                                reject(`Unable to optimize PDF: ${msg}!`);
                            } else {
                                reject(`An error occured while optimizing PDF!`);
                            }
                        }
                    });
                } else {
                    done();
                }
            } else {
                done();
            }
        });
    }

    createRekanan(queue, forceEdit = false) {
        const allowChange = this.isEditable(queue);
        return this.works([
            [w => this.doQuery(new SipdQueryRekanan(this.sipd, queue, {navigates: ['Pengeluaran', 'Daftar Rekanan']}))],
            [w => this.sipd.gotoPageTop(), w => !w.getRes(0) && allowChange],
            [w => this.sipd.waitAndClick(By.xpath('//button[text()="Tambah Rekanan"]')), w => !w.getRes(0) && allowChange],
            [w => queue.values.action.click(), w => w.getRes(0) && forceEdit && allowChange],
            [w => this.fillForm(queue, 'rekanan',
                By.xpath('//h1/h1[text()="Tambah Rekanan"]/../../../..'),
                By.xpath('//button[text()="Konfirmasi"]')), w => (!w.getRes(0) || forceEdit) && allowChange],
            [w => this.sipd.confirmSubmission(By.xpath('//section/footer/button[1]'), {spinner: true}), w => (!w.getRes(0) || forceEdit) && allowChange],
        ]);
    }
}

/**
 * Holds account charges.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdAfektasi {

    keys = {
        kuota: false,
        keg: true,
        rek: true,
        no: false,
        tgl: true,
        untuk: false,
        nominal: true,
        sisa: false,
    }

    /**
     * Set key value.
     *
     * @param {string} key The key
     * @param {any} value The value
     * @returns {SipdAfektasi}
     */
    set(key, value) {
        if (!key) {
            throw new Error('Key is required!');
        }
        key = key.toLowerCase();
        if (!Object.keys(this.keys).includes(key)) {
            throw new Error(`Unknown key ${key}!`);
        }
        this[key] = value;
        return this;
    }

    /**
     * Clear all values.
     *
     * @returns {SipdAfektasi}
     */
    clear() {
        for (const k of Object.keys(this.keys)) {
            delete this[k];
        }
        return this;
    }

    /**
     * Check if afektasi is valid.
     *
     * @returns {boolean}
     */
    isValid() {
        for (const [k, required] of Object.entries(this.keys)) {
            if (required && (this[k] === undefined || this[k] === null)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Create or get account charge.
     *
     * @param {string} id The account id
     * @returns {SipdAfektasi}
     */
    static get(id) {
        if (this.instances === undefined) {
            this.instances = {};
        }
        if (this.instances[id] === undefined) {
            this.instances[id] = new this();
        }
        return this.instances[id];
    }
}

module.exports = SipdSession;
