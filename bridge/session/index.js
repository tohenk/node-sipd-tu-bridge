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
const { Sipd, SipdAnnouncedError } = require('../../sipd');
const SipdPage = require('../../sipd/page');
const { By, Key } = require('selenium-webdriver');
const debug = require('debug')('sipd:session');

class SipdSession {

    PAGE_REKANAN = 1
    PAGE_REKANAN_ALT = 2
    PAGE_SPP = 3

    fn = ['stop', 'sleep', 'captchaImage', 'solveCaptcha', 'reloadCaptcha', 'cancelCaptcha']

    constructor(options) {
        this.options = options;
        this.bridge = options.bridge;
        this.sipd = new Sipd(options);
        this.works = this.sipd.works;
        const ctx = this.sipd;
        for (const fn of this.fn) {
            this[fn] = function(...args) {
                return this.sipd[fn].apply(ctx, args);
            }
        }
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

    start() {
        return this.works([
            [w => this.waitUntilReady(), w => !this.sipd.ready],
            [w => this.doStartup(), w => this.options.startup],
            [w => this.sipd.handlePageLoad()],
            [w => this.sipd.open()],
        ]);
    }

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

    doStartup() {
        if (!this.options.startup) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            debug('Startup', this.options.startup);
            const exec = require('child_process').exec;
            exec(this.options.startup, (err, stdout, stderr) => {
                resolve(err);
            });
        });
    }

    login() {
        return this.works([
            [w => this.start()],
            [w => this.sipd.login(this.cred.username, this.cred.password, this.cred.role)],
        ]);
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

    getTippy(el) {
        return this.sipd.getDriver().executeScript(
            function(el) {
                if (el._tippy && el._tippy.popper) {
                    return el._tippy.popper.innerText;
                }
            }, el);
    }

    getTippyText(items, el) {
        return new Promise((resolve, reject) => {
            const res = {};
            const q = new Queue(Object.keys(items), tippy => {
                this.works([
                    [w => el.findElements(items[tippy])],
                    [w => this.getTippy(w.getRes(0)[0]), w => w.getRes(0).length],
                    [w => Promise.resolve(res[tippy] = w.getRes(1)), w => w.getRes(0).length],
                ])
                .then(res => q.next())
                .catch(err => reject(err));
            });
            q.once('done', () => resolve(res));
        });
    }

    getPageOptions(page, title) {
        const res = {title};
        switch (page) {
            case this.PAGE_REKANAN:
            case this.PAGE_REKANAN_ALT:
                const placeholder = page === this.PAGE_REKANAN ? 'perusahaan' : 'nik';
                res.selector = '//h1[contains(@class,"card-title")]/h1[text()="%TITLE%"]/../../../..';
                res.search = {
                    input: By.xpath(`//input[contains(@placeholder,"Cari ${placeholder}")]`),
                    submit: By.xpath('//button[text()="Cari Sekarang"]'),
                    toggler: By.xpath('//button/div/p[text()="Filter Pencarian"]/../..'),
                }
                break;
            case this.PAGE_SPP:
                res.search = {
                    filter: By.xpath('//div[@class="container-form-filter-table"]/*/*/*/*[1]/div/button'),
                    input: By.xpath('//div[@class="container-form-filter-table"]/*/*/*/*[2]/div/input'),
                    submit: By.xpath('//div[@class="container-form-filter-table"]/*/*/*/*[3]/div/div'),
                }
                break;
        }
        return res;
    }

    createPage(page, title) {
        return new SipdPage(this.sipd, this.getPageOptions(page, title));
    }

    doChoose(title, value, values, options, callback = null) {
        return new Promise((resolve, reject) => {
            if (typeof options === 'function') {
                callback = options;
                options = undefined;
            }
            options = options || {};
            const pageOptions = Object.assign({
                title: title,
                selector: '//header[text()="%TITLE%"]/../div[contains(@class,"chakra-modal__body")]',
                tableSelector: './/table/..',
                pageSelector: 'li/a[text()="%PAGE%"]',
            }, options.page ? this.getPageOptions(options.page, title) : {});
            const searchIdx = options.searchIdx !== undefined ? options.searchIdx : 0;
            const page = new SipdPage(this.sipd, pageOptions);
            let clicker;
            this.works([
                [w => page.setup()],
                [w => page.search(Array.isArray(value) ? value[searchIdx] : value), w => page._search],
                [w => page.each(el => [
                    [x => this.sipd.getText([...values], el)],
                    [x => el.findElement(By.xpath('.//button'))],
                    [x => new Promise((resolve, reject) => {
                        const v = x.getRes(0);
                        const expected = Array.isArray(value) ? value.join('|') : value;
                        let checked = typeof callback === 'function' ? callback(v) : v;
                        if (Array.isArray(checked)) {
                            checked = checked.join('|');
                        }
                        if (expected === checked) {
                            clicker = x.getRes(1);
                            reject(SipdPage.stop());
                        } else {
                            resolve();
                        }
                    })],
                ])],
                [w => clicker.click(), w => clicker],
                [w => Promise.reject(new SipdAnnouncedError(`${title}: ${value} tidak ada!`)), w => !clicker],
            ])
            .then(() => resolve())
            .catch(err => reject(err));
        });
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
            [w => el.getAttribute('value'), w => !w.getRes(2)],
            [w => Promise.resolve(this.getDate(w.getRes(6))), w => !w.getRes(2)],
            [w => Promise.reject(`Date ${w.getRes(7)} is not expected of ${value}!`), w => !w.getRes(2) && this.dateSerial(value) != this.dateSerial(w.getRes(7))],
        ]);
    }

    fillDatePicker2(el, value) {
        return this.works([
            [w => Promise.reject(`Date "${value}" is not valid!`), w => value instanceof Date && isNaN(value)],
            [w => this.sipd.getDriver().executeScript(
                function(el, date) {
                    if (el._flatpickr) {
                        el._flatpickr.setDate(date);
                        return el._flatpickr.selectedDates[el._flatpickr.selectedDates.length - 1].toString();
                    }
                }, el, value)],
            [w => Promise.resolve(this.getDate(w.getRes(1)))],
            [w => Promise.reject(`Date ${w.getRes(2)} is not expected of ${value}!`), w => this.dateSerial(value) != this.dateSerial(w.getRes(2))],
        ]);
    }

    fillRole(el, value) {
        return this.works([
            [w => el.click()],
            [w => this.doChoose('Pilih Pegawai', value, [By.xpath('./td[1]/div/span/div/span[1]')])],
        ]);
    }

    fillRekanan(el, value) {
        const alt = (Array.isArray(value) ? value[0] : value).indexOf('\'') >= 0;
        return this.works([
            [w => el.click()],
            [w => this.doChoose('Daftar Rekanan', value, [By.xpath('./td[2]/div/div/div[2]/span[1]'), By.xpath('./td[1]/div/div/div[2]/span[2]')], {page: alt ? this.PAGE_REKANAN_ALT : this.PAGE_REKANAN, searchIdx: alt ? 1 : 0}, values => {
                // clean nik
                if (values.length > 1 && values[1]) {
                    values[1] = this.pickNumber(values[1]);
                }
                return values;
            })],
        ]);
    }

    fillKegiatan(el, value) {
        return this.works([
            [w => el.click()],
            [w => this.sipd.waitAndClick(By.xpath('//div[@class="css-j-3jq-af-a2fa"]'))],
            [w => this.sipd.findElements(By.xpath('//div[@class="css-j03r-a-cf3fa"]/div/span/div/span[2]'))],
            [w => new Promise((resolve, reject) => {
                let done = false;
                const items = w.getRes(2);
                const q = new Queue(items, item => {
                    this.works([
                        [x => item.getAttribute('innerText')],
                        [x => Promise.resolve(this.pickNumber(x.getRes(0)))],
                        [x => item.findElement(By.xpath('../../../../div[2]/button')), x => value.startsWith(x.getRes(1))],
                        [x => x.getRes(2).click(), x => value.startsWith(x.getRes(1))],
                        [x => Promise.resolve(done = true), x => value.startsWith(x.getRes(1))],
                    ])
                    .then(() => {
                        if (done) {
                            q.done();
                        } else {
                            q.next();
                        }
                    })
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
            [w => this.sipd.sleep(this.sipd.opdelay)],
        ]);
    }

    fillAfektasi(el, value, rekening) {
        let allocated = false;
        return this.works([
            [w => this.sipd.waitForPresence({el, data: By.xpath('.//div/div/div[@class="animate-pulse"]')}, false, 0)],
            [w => this.sipd.sleep(this.sipd.opdelay)],
            [w => this.sipd.findElements(By.xpath('//div/div/div/div[@class="col-span-7"]/div/div[1]/div/span[1]'))],
            [w => new Promise((resolve, reject) => {
                const items = w.getRes(2);
                const q = new Queue(items, item => {
                    this.works([
                        [x => item.getAttribute('innerText')],
                        [x => Promise.resolve(this.pickCurr(x.getRes(0)))],
                        [x => item.findElement(By.xpath('../../../../../div[@class="col-span-5"]/div/div/input')), x => x.getRes(1) === rekening],
                        [x => item.findElement(By.xpath('../../../../../div[@class="col-span-5"]/div/p[2]')), x => x.getRes(1) === rekening],
                        [x => Promise.resolve(x.getRes(3).getAttribute('innerText')), x => x.getRes(1) === rekening],
                        [x => Promise.resolve(parseFloat(this.pickCurr(x.getRes(4)))), x => x.getRes(1) === rekening],
                        [x => this.sipd.fillInput(x.getRes(2), null, this.options.clearUsingKey), x => x.getRes(1) === rekening && x.getRes(5) >= value],
                        [x => new Promise((resolve, reject) => {
                            const input = x.getRes(2);
                            const chars = value.toString().split('');
                            const f = () => {
                                if (chars.length) {
                                    const x = chars.shift();
                                    input.sendKeys(x)
                                        .then(() => setTimeout(f, 10))
                                        .catch(err => reject(err));
                                } else {
                                    resolve();
                                }
                            }
                            f();
                        }), x => x.getRes(1) === rekening && x.getRes(5) >= value],
                        [x => Promise.resolve(allocated = true), x => x.getRes(1) === rekening && x.getRes(5) >= value],
                    ])
                    .then(() => {
                        if (allocated) {
                            q.done();
                        } else {
                            q.next();
                        }
                    })
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
            [w => Promise.reject(`Tidak dapat mengalokasikan ${value} pada rekening ${rekening}!`), w => !allocated],
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
            [w => this.sipd.fillSelect(w.getRes(3), date.getMonth())],
            [w => el.findElements(By.xpath(`.//span[contains(@class,"flatpickr-day") and text()="${date.getDate()}"]`))],
            [w => new Promise((resolve, reject) => {
                const q = new Queue([...w.getRes(5)], flatpickrDay => {
                    this.works([
                        [x => flatpickrDay.getAttribute('class')],
                        [x => flatpickrDay.click(), x => x.getRes(0).indexOf('flatpickr-disabled') < 0],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
        ]);
    }

    handleFormFill(name, queue, files) {
        const result = [];
        const maps = queue.getMap(name);
        const trunc = (s, len = 100) => {
            if (s instanceof Buffer) {
                s = s.toString();
            }
            if (typeof s === 'string' && s.length > len) {
                s = s.substr(0, len) + '...';
            }
            return s;
        }
        Object.keys(maps).forEach(k => {
            const selector = [];
            const f = this.getFormKey(k);
            let key = f.selector, attr, vtype, skey;
            switch (true) {
                case f.sflags.indexOf('#') >= 0:
                    attr = 'id';
                    break;
                case f.sflags.indexOf('=') >= 0:
                    break;
                default:
                    attr = 'name';
                    break;
            }
            let value = queue.getMappedData([name, k]);
            debug(`Mapped value ${name + '->' + key} = ${trunc(value)}`);
            // fall back to non mapped value if undefined
            if (value === undefined) {
                if (f.flags.indexOf('*') >= 0) {
                    throw new Error(`Form ${name}: ${key} value is mandatory`);
                }
                value = maps[k];
            }
            // handle special value TYPE:value
            if (typeof value === 'string' && value.indexOf(':') > 0 && queue.getMap([name, k]) === value) {
                const x = value.split(':');
                vtype = x[0];
                value = x[1];
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
                debug(`Special TYPE:value ${name + '->' + key} = ${trunc(value)}`);
            }
            // check for safe string
            if (typeof value === 'string' && value.length) {
                value = this.getSafeStr(value);
            }
            // handle special key
            if (key.indexOf(':') > 0) {
                const y = key.split(':');
                skey = y[0];
                key = y[1];
                switch (skey) {
                    case 'spp':
                        this.spp[key.toLowerCase()] = value;
                        break;
                }
            }
            if (f.sflags.indexOf('=') < 0) {
                selector.push(`[@${attr}="${key}"]`);
            }
            // form data
            let data = {
                target: By.xpath(f.sflags.indexOf('=') >= 0 ? key : `.//*${selector.join('')}`),
                value: value
            }
            // check form parent
            if (f.parent) {
                if (f.parent.substring(0, 1) === '#') {
                    data.parent = By.id(f.parent.substring(1));
                } else {
                    data.parent = By.xpath(f.parent);
                }
            }
            switch (skey) {
                case 'spp':
                    if (this.spp.tgl && this.spp.keg && this.spp.rek && this.spp.nominal) {
                        data = {
                            target: By.xpath('.//p[contains(@class,"form-label") and text()="Belanja"]/../div[2]'),
                            value: this.spp.nominal,
                            onfill: (el, value) => this.fillAfektasi(el, value, this.spp.rek),
                        }
                    } else {
                        data = null;
                    }
                    break;
            }
            // form data and handler
            if (data) {
                switch (vtype) {
                    case 'RADIO':
                        data.onfill = (el, value) => this.fillRadio(el, value);
                        break;
                    case 'ROLE':
                        data.onfill = (el, value) => this.fillRole(el, this.bridge.getUser(value));
                        break;
                    case 'REKANAN':
                        data.onfill = (el, value) => this.fillRekanan(el, value);
                        break;
                    case 'KEG':
                        data.onfill = (el, value) => this.fillKegiatan(el, value);
                        break;
                    case 'FILE':
                        const docfile = this.genFilename('doctmp', `${queue.id}.pdf`);
                        files.push(docfile);
                        data.onfill = (el, value) => new Promise((resolve, reject) => {
                            if (value) {
                                // is it saved buffer?
                                if (typeof value === 'object' && value.type === 'Buffer' && value.data) {
                                    value = Buffer.from(value.data);
                                }
                                if (!Buffer.isBuffer(value)) {
                                    reject('To upload file, value must be Buffer!');
                                } else {
                                    this.saveFile(docfile, value);
                                    el.sendKeys(docfile)
                                        .then(() => resolve(true))
                                        .catch(err => reject(err));
                                }
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
                    case f.flags.indexOf('?') >= 0:
                        data.onfill = (el, value) => this.readValue(el, value, queue);
                        break;
                    // fill value using javascript
                    case f.flags.indexOf('$') >= 0:
                        data.onfill = (el, value) => this.sipd.getDriver().executeScript(
                            function(el, value) {
                                $(el).val(value);
                            }, el, value);
                        break;
                    // add waiting
                    case f.flags.indexOf('+') >= 0:
                        data.done = (d, next) => {
                            this.sipd.waitLoader()
                                .then(() => next())
                                .catch(err => {
                                    throw err;
                                });
                        }
                        break;
                    // optional
                    case f.flags.indexOf('~') >= 0:
                        data.optional = true;
                        break;
                }
                // generic handler of special tag
                if (!data.onfill) {
                    // date time picker
                    if (key.toLowerCase().indexOf('tanggal') >= 0) {
                        data.onfill = (el, value) => this.fillDatePicker(el, this.getDate(value, f.flags.indexOf('&') >= 0));
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
                if (this.options.clearUsingKey) {
                    data.clearUsingKey = true;
                }
                result.push(data);
            }
        });
        return result;
    }

    fillForm(queue, name, form, submit, options = null) {
        options = options || {};
        if (options.wait === undefined) {
            options.wait = 0;
        }
        if (options.dismiss === undefined) {
            options.dismiss = true;
        }
        if (!this.files) {
            this.files = [];
        }
        return this.works([
            [w => this.sipd.sleep(this.sipd.opdelay)],
            [w => this.sipd.fillInForm(
                this.handleFormFill(name, queue, this.files),
                form,
                submit,
                options.wait)],
            [w => this.sipd.sleep(this.sipd.opdelay)],
            [w => this.sipd.waitLoader()],
        ]);
    }

    cleanFiles() {
        return new Promise((resolve, reject) => {
            const q = new Queue(this.files, file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
                q.next();
            });
            q.once('done', () => resolve());
        });
    }

    getDate(date, skipHoliday = false) {
        if (date && (!isNaN(date) || typeof date === 'string')) {
            if (typeof date === 'string' && date.indexOf(' ') > 0) {
                const dt = date.split(' ');
                if (dt.length === 3) {
                    let d, m, y;
                    for (const part of dt) {
                        if (!isNaN(part)) {
                            if (part.length === 4) {
                                y = parseInt(part);
                            } else {
                                d = parseInt(part);
                            }
                        } else {
                            m = [
                                'Januari',
                                'Februari',
                                'Maret',
                                'April',
                                'Mei',
                                'Juni',
                                'Juli',
                                'Agustus',
                                'September',
                                'Oktober',
                                'November',
                                'Desember',
                            ].indexOf(part) + 1;
                        }
                    }
                    if (d !== undefined && m !== undefined && y !== undefined) {
                        date = [y.toString(), m.toString().padStart(2, '0'), d.toString().padStart(2, '0')].join('-');
                    }
                } else if (dt[1] === '00:00:00') {
                    date = dt[0];
                }
            }
            if (typeof date === 'string' && date.indexOf('/') > 0) {
                const dtpart = date.split('/');
                if (dtpart.length === 3) {
                    date = Date.UTC(parseInt(dtpart[2]), parseInt(dtpart[1]) - 1, parseInt(dtpart[0]));
                }
            }
            date = new Date(date);
        }
        if (date && skipHoliday) {
            while (true) {
                if ([0, 6].indexOf(date.getDay()) < 0) {
                    break;
                }
                date.setDate(date.getDate() + 1);
            }
        }
        return date;
    }

    getMonth(s) {
        if (typeof s === 'string') {
            s = s.substring(0, 3);
            const month = ['Jan', 'Feb', 'Mar', 'Apr', ['May', 'Mei'], 'Jun', 'Jul', ['Aug', 'Agu'], 'Sep', ['Oct', 'Okt'], ['Nov', 'Nop'], ['Dec', 'Des']];
            month.forEach((m, i) => {
                const mm = Array.isArray(m) ? m : [m];
                mm.forEach(x => {
                    if (s === x) {
                        s = i;
                        return true;
                    }
                });
                if (s == i) {
                    return true;
                }
            });
        }
        return s;
    }

    dateSerial(date) {
        if (date) {
            return (date.getFullYear() * 10000) + ((date.getMonth() + 1) * 100) + date.getDate();
        }
    }

    dateCreate(s) {
        const x = s.split(' ');
        return new Date(Date.UTC(parseInt(x[1]), this.getMonth(x[0]), 1));
    }

    dateDiffMonth(dt1, dt2) {
        const d1 = (dt1.getFullYear() * 12) + dt1.getMonth() + 1;
        const d2 = (dt2.getFullYear() * 12) + dt2.getMonth() + 1;
        return d1 - d2;
    }

    pickNumber(s) {
        let result = '';
        for (let i = 0; i < s.length; i++) {
            if (!isNaN(s.charAt(i))) {
                result += s.charAt(i);
            }
        }
        return result.trim();
    }

    pickCurr(s) {
        if (s) {
            const matches = s.match(/([0-9\.]+)/);
            if (matches) {
                return this.pickNumber(matches[0]);
            }
        }
    }

    getSafeStr(s) {
        if (s) {
            return s.replace(/\s{2,}/g, ' ').trim();
        }
    }

    getFlags(flags, s, multiple = false) {
        const res = [];
        if (typeof flags === 'string') {
            flags = flags.split('');
        }
        if (!Array.isArray(flags)) {
            flags = [flags];
        }
        while (true) {
            if (flags.indexOf(s.substr(0, 1)) >= 0) {
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
}

module.exports = SipdSession;