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

const fs = require('fs');
const path = require('path');
const util = require('util');
const Queue = require('@ntlab/work/queue');
const { Siap, SiapAnnouncedError } = require('../siap');
const SiapQueue = require('../queue');
const SiapPage = require('../siap/page');
const { By } = require('selenium-webdriver');
const debug = require('debug')('siap:bridge');

class SiapBridge {

    STATE_NONE = 1
    STATE_SELF_TEST = 2
    STATE_OPERATIONAL = 3

    ROLE_BP = 'bp'
    ROLE_PA = 'pa'
    ROLE_PPTK = 'pptk'
    ROLE_PPK = 'ppk'

    PAGE_REKANAN = 1
    PAGE_SPP = 2

    constructor(options) {
        this.options = options;
        this.state = this.STATE_NONE;
        this.siap = new Siap(options);
        this.works = this.siap.works;
        this.closeBrowser = true;
        this.clearUsingKey = true;
    }

    selfTest() {
        if (this.state < this.STATE_SELF_TEST) {
            this.state = this.STATE_SELF_TEST;
        }
        const f = () => {
            this.state = this.STATE_OPERATIONAL;
            return this.state;
        }
        return this.do([
            [w => this.waitUntilReady()],
            [w => Promise.resolve(f())],
        ]);
    }

    isOperational() {
        return this.state === this.STATE_OPERATIONAL;
    }

    isReady() {
        return this.siap.ready;
    }

    waitUntilReady() {
        return new Promise((resolve, reject) => {
            const f = () => {
                if (this.isReady()) {
                    resolve();
                } else {
                    setTimeout(f, 100);
                }
            }
            f();
        });
    }

    switchRole(role) {
        if (this.options.roles && this.options.roles.roles[role]) {
            this.role = this.options.roles.roles[role];
        }
    }

    getRoleTitle(role) {
        const roles = {
            [this.ROLE_BP]: 'Bendahara Pengeluaran',
            [this.ROLE_PA]: 'Pengguna Anggaran',
            [this.ROLE_PPK]: 'PPK SKPD',
        }
        return roles[role];
    }

    getUser(role) {
        if (this.role && this.role[role]) {
            return this.role[role];
        }
    }

    getCredential(user) {
        if (this.options.roles && this.options.roles.users) {
            return this.options.roles.users[user];
        }
    }

    getDate(date) {
        if (date && (!isNaN(date) || typeof date === 'string')) {
            if (typeof date === 'string' && date.indexOf(' ') > 0) {
                const dt = date.split(' ');
                if (dt[1] === '00:00:00') {
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
        return (date.getFullYear() * 10000) + ((date.getMonth() + 1) * 100) + date.getDate();
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

    getSafeStr(s) {
        return s.replace(/\s{2,}/g, ' ').trim();
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
        res.flags = this.getFlags('+?*~$-', key, true);
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

    sleep(ms) {
        return this.siap.sleep(ms);
    }

    do(theworks, status) {
        const works = [
            w => this.siap.open(),
        ];
        if (Array.isArray(theworks)) {
            works.push(...theworks);
        }
        if (typeof theworks === 'function') {
            works.push(theworks);
        }
        return this.works(works, {
            done: (w, err) => {
                if (err instanceof SiapAnnouncedError && err._queue) {
                    const queue = err._queue;
                    const callbackQueue = SiapQueue.createCallbackQueue({id: queue.getMappedData('info.id'), error: err.message}, queue.callback);
                    SiapQueue.addQueue(callbackQueue);
                }
                return this.works([
                    [e => this.siap.sleep(this.siap.timeout), e => err],
                    [e => this.siap.stop(), e => this.closeBrowser],
                ]);
            }
        });
    }

    doAs(role) {
        let user = this.getUser(role);
        if (!user) {
            return Promise.reject(util.format('Role not found: %s!', role));
        }
        let cred = this.getCredential(user);
        if (!cred) {
            return Promise.reject(util.format('User has no credential: %s!', user));
        }
        return this.siap.login(cred.username, cred.password, this.getRoleTitle(role));
    }

    checkRole(queue) {
        return this.works([
            [w => Promise.resolve(queue.getMappedData('info.role'))],
            [w => Promise.reject('Invalid queue, no role specified!'), w => !w.getRes(0)],
            [w => Promise.resolve(this.switchRole(w.getRes(0)))],
        ]);
    }

    getTippy(el) {
        return this.siap.getDriver().executeScript(
            function(el) {
                if (el._tippy && el._tippy.popper) {
                    return el._tippy.popper.innerText;
                }
            }, el);
    }

    getPageOptions(page, title) {
        const res = {title};
        switch (page) {
            case this.PAGE_REKANAN:
                res.selector = '//h1[contains(@class,"card-title")]/h1[text()="%TITLE%"]/../../../..';
                res.search = {
                    input: By.xpath('//input[contains(@placeholder,"Cari perusahaan")]'),
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
        return new SiapPage(this.siap, this.getPageOptions(page, title));
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
            const page = new SiapPage(this.siap, pageOptions);
            let clicker;
            this.works([
                [w => page.setup()],
                [w => page.search(Array.isArray(value) ? value[0] : value), w => page._search],
                [w => page.each(el => [
                    [x => this.siap.getText([...values], el)],
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
                            reject(SiapPage.stop());
                        } else {
                            resolve();
                        }
                    })],
                ])],
                [w => clicker.click(), w => clicker],
                [w => Promise.reject(new SiapAnnouncedError(`${title}: ${value} tidak ada!`)), w => !clicker],
            ])
            .then(() => resolve())
            .catch(err => reject(err));
        });
    }

    dismissModal(title) {
        return this.siap.waitAndClick(By.xpath(`//header[text()="${title}"]/../button[@aria-label="Close"]`));
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
            [w => this.siap.findElements(By.xpath(`//*[@id="${w.getRes(1)}"]/div[contains(text(),"${value}")]`))],
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
            [w => el.click()],
            [w => this.siap.findElements(By.xpath('//div[contains(@class,"flatpickr-calendar")]'))],
            [w => new Promise((resolve, reject) => {
                const q = new Queue(w.getRes(2), dtpicker => {
                    this.works([
                        [w => dtpicker.getAttribute('class')],
                        [w => Promise.resolve(w.getRes(0).indexOf('open') >= 0)],
                        [w => dtpicker.findElement(By.xpath('.//input[@aria-label="Year"]')), w => w.getRes(1)],
                        [w => w.getRes(2).getAttribute('value'), w => w.getRes(1)],
                        [w => dtpicker.findElement(By.xpath('.//select[@aria-label="Month"]')), w => w.getRes(1)],
                        [w => this.siap.fillInput(w.getRes(2), value.getFullYear()), w => w.getRes(1) && w.getRes(3) != value.getFullYear()],
                        [w => this.siap.fillSelect(w.getRes(4), value.getMonth()), w => w.getRes(1)],
                        [w => dtpicker.findElement(By.xpath(`.//span[@class="flatpickr-day" and text()="${value.getDate()}"]`)), w => w.getRes(1)],
                        [w => w.getRes(7).click(), w => w.getRes(1)],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
            [w => el.getAttribute('readonly')],
            [w => this.siap.getDriver().executeScript(
                function(el) {
                    if (el._flatpickr) {
                        el._flatpickr.close();
                    }
                }, el), w => w.getRes(4)],
            [w => el.getAttribute('value'), w => !w.getRes(4)],
            [w => Promise.resolve(this.getDate(w.getRes(6))), w => !w.getRes(4)],
            [w => Promise.reject(`Date ${w.getRes(7)} is not expected of ${value}!`), w => !w.getRes(4) && this.dateSerial(value) != this.dateSerial(w.getRes(7))],
        ]);
    }

    fillDatePicker2(el, value) {
        return this.works([
            [w => Promise.reject(`Date "${value}" is not valid!`), w => value instanceof Date && isNaN(value)],
            [w => this.siap.getDriver().executeScript(
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
        return this.works([
            [w => el.click()],
            [w => this.doChoose('Daftar Rekanan', value, [By.xpath('./td[2]/div/div/div[2]/span[1]'), By.xpath('./td[1]/div/div/div[2]/span[2]')], {page: this.PAGE_REKANAN}, values => {
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
            [w => this.siap.waitAndClick(By.xpath('//div[@class="css-j-3jq-af-a2fa"]'))],
            [w => this.siap.findElements(By.xpath('//div[@class="css-j03r-a-cf3fa"]/div/span/div/span[2]'))],
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
            [w => this.siap.sleep(this.siap.opdelay)],
        ]);
    }

    fillAfektasi(el, value, rekening) {
        let allocated = false;
        return this.works([
            [w => el.findElements(By.xpath('.//div/div/div/div[@class="col-span-7"]/div/div[1]/div/span[1]'))],
            [w => new Promise((resolve, reject) => {
                const items = w.getRes(0);
                const q = new Queue(items, item => {
                    this.works([
                        [x => item.getAttribute('innerText')],
                        [x => Promise.resolve(this.pickNumber(x.getRes(0)))],
                        [x => item.findElement(By.xpath('../../../../../div[@class="col-span-5"]/div/div/input')), x => x.getRes(1) === rekening],
                        [x => item.findElement(By.xpath('../../../../../div[@class="col-span-5"]/div/p[2]')), x => x.getRes(1) === rekening],
                        [x => Promise.resolve(x.getRes(3).getAttribute('innerText')), x => x.getRes(1) === rekening],
                        [x => Promise.resolve(parseFloat(this.pickNumber(x.getRes(4)))), x => x.getRes(1) === rekening],
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

    handleFormFill(name, queue, files) {
        const result = [];
        const maps = queue.getMap(name);
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
            debug(`Mapped value ${name + '->' + key} = ${value}`);
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
                debug(`Special TYPE:value ${name + '->' + key} = ${value}`);
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
                        data.onfill = (el, value) => this.fillRole(el, this.getUser(value));
                        break;
                    case 'REKANAN':
                        data.onfill = (el, value) => this.fillRekanan(el, value);
                        break;
                    case 'KEG':
                        data.onfill = (el, value) => this.fillKegiatan(el, value);
                        break;
                    case 'FILE':
                        const doctmp = path.join(this.options.workdir, 'doctmp');
                        const docfile = path.join(doctmp, `${queue.id}.pdf`);
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
                                    if (!fs.existsSync(doctmp)) {
                                        fs.mkdirSync(doctmp, {recursive: true})
                                    }
                                    fs.writeFileSync(docfile, value);
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
                        data.onfill = (el, value) => this.siap.getDriver().executeScript(
                            function(el, value) {
                                $(el).val(value);
                            }, el, value);
                        break;
                    // add waiting
                    case f.flags.indexOf('+') >= 0:
                        data.done = (d, next) => {
                            this.siap.waitLoader()
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
                        data.onfill = (el, value) => this.fillDatePicker(el, this.getDate(value));
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
                if (this.clearUsingKey) {
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
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.siap.fillInForm(
                this.handleFormFill(name, queue, this.files),
                form,
                submit,
                options.wait)],
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.siap.waitLoader()],
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
}

module.exports = SiapBridge;