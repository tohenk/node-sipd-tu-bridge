/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2023 Toha <tohenk@yahoo.com>
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
const SiapQueue = require('./queue');
const Siap = require('./siap');
const DataTable = require('./dataTable');
const { By, Key } = require('selenium-webdriver');

class SiapBridge {

    STATE_NONE = 1
    STATE_SELF_TEST = 2
    STATE_OPERATIONAL = 3

    ROLE_BPP = 'bpp'
    ROLE_KPA = 'kpa'
    ROLE_PPTK = 'pptk'
    ROLE_PPK = 'ppk'

    constructor(options) {
        this.options = options;
        this.state = this.STATE_NONE;
        this.siap = new Siap(options);
        this.works = this.siap.works;
        this.prefilter = options.usePreFilter || false;
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
        return this.state == this.STATE_OPERATIONAL;
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
        if (date && (!isNaN(date) || typeof date == 'string')) {
            date = new Date(date);
        }
        return date;
    }

    getMonth(s) {
        if (typeof s == 'string') {
            s = s.substring(0, 3);
            const month = ['Jan', 'Feb', 'Mar', 'Apr', ['May', 'Mei'], 'Jun', 'Jul', ['Aug', 'Agu'], 'Sep', ['Oct', 'Okt'], ['Nov', 'Nop'], ['Dec', 'Des']];
            month.forEach((m, i) => {
                const mm = Array.isArray(m) ? m : [m];
                mm.forEach(x => {
                    if (s == x) {
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
        let x = s.split(' ');
        return new Date(parseInt(x[1]), this.getMonth(x[0]), 1);
    }

    dateDiffMonth(dt1, dt2) {
        let d1 = (dt1.getFullYear() * 12) + dt1.getMonth() + 1;
        let d2 = (dt2.getFullYear() * 12) + dt2.getMonth() + 1;
        return d1 - d2;
    }

    pickNumber(s) {
        let result = '';
        for (let i = 0; i < s.length; i++) {
            if (!isNaN(s.charAt(i))) result += s.charAt(i);
        }
        return result;
    }

    sleep(ms) {
        return this.siap.sleep(ms);
    }

    do(theworks, status) {
        const works = [
            w => this.siap.open(),
        ];
        if (Array.isArray(theworks)) {
            Array.prototype.push.apply(works, theworks);
        }
        if (typeof theworks == 'function') {
            works.push(theworks);
        }
        return this.works(works, {
            done: () => this.siap.stop()
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
        return this.siap.login(cred.username, cred.password);
    }

    fillSearchable(el, value) {
        return this.works([
            [w => el.findElement(By.xpath('.//input[@type="text"]'))],
            [w => w.getRes(0).click()],
            [w => el.findElement(By.xpath('.//li[contains(text(),_X_)]'.replace(/_X_/, this.siap.escapeStr(value))))],
            [w => w.getRes(2).click()],
        ]);
    }

    fillKategoriRekanan(el, value) {
        return this.works([
            [w => el.click()],
            [w => el.sendKeys(Key.ALT, Key.DOWN)],
            [w => el.sendKeys(Key.DOWN, Key.DOWN, Key.RETURN), w => value == 'pns'],
            [w => el.sendKeys(Key.DOWN, Key.DOWN, Key.DOWN, Key.RETURN), w => value == 'non_pns'],
        ]);
    }

    fillDatePicker(el, value) {
        return this.works([
            [w => Promise.reject('Not a valid date!'), w => value instanceof Date && isNaN(value)],
            [w => el.click()],
            [w => new Promise((resolve, reject) => {
                const f = () => {
                    this.datePickerNavigate(value)
                        .then(result => {
                            if (result) {
                                resolve();
                            } else {
                                f();
                            }
                        })
                        .catch(err => reject(err));
                }
                f();
            })],
        ]);
    }

    datePickerNavigate(date) {
        return this.works([
            [w => this.siap.findElement(By.xpath('//div[contains(@class,"daterangepicker") and contains(@style,"display: block;")]/div[contains(@class,"first")]/div/table'))],
            [w => this.siap.getText([By.xpath('./thead/tr/th[2]')], w.getRes(0))],
            [w => Promise.resolve(this.dateDiffMonth(this.dateCreate(w.getRes(1)[0]), date))],
            [w => w.getRes(0).findElement(By.xpath('./thead/tr/th[1]')),
                w => w.getRes(2) > 0],
            [w => w.getRes(3).click(),
                w => w.getRes(2) > 0],
            [w => w.getRes(0).findElement(By.xpath('./thead/tr/th[3]')),
                w => w.getRes(2) < 0],
            [w => w.getRes(5).click(),
                w => w.getRes(2) < 0],
            [w => w.getRes(0).findElement(By.xpath('./tbody/tr/td[text()="_X_"]'.replace(/_X_/, date.getDate()))),
                w => w.getRes(2) == 0],
            [w => w.getRes(7).click(),
                w => w.getRes(2) == 0],
            [w => Promise.resolve(Math.abs(w.getRes(2)) == 0)],
        ]);
    }

    fillAfektasiSpp(el, value, tgl) {
        return this.works([
            [w => el.click()],
            [w => this.siap.findElements(By.xpath('//md-dialog-content/div/div/div/table/tbody/tr[@ng-repeat]'))],
            [w => Promise.reject('Tidak ada SPD tersedia!'), w => w.getRes(1).length == 0],
            [w => new Promise((resolve, reject) => {
                const q = new Queue(w.getRes(1), tr => {
                    this.works([
                        [w => this.siap.getText([By.xpath('./td[3]'), By.xpath('./td[4]')], tr)],
                        [w => Promise.resolve(this.getDate(w.getRes(0)[0]))],
                        [w => this.siap.click({el: tr, data: By.xpath('./td[1]/input[@type="checkbox"]')}),
                            w => w.getRes(1).valueOf() <= tgl.valueOf()],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
            [w => this.siap.waitAndClick(By.xpath('//button[@ng-click="tambahSpd()"]'))],
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.fillRekeningSpp(value)],
        ]);
    }

    fillRekeningSpp(value) {
        return this.works([
            [w => this.siap.findElement(By.xpath('//form[@ng-submit="beforeSimpanSpp($event)"]/div/div/div/div/table'))],
            [w => this.expandNestedTable(w.getRes(0), (tbl1, row1) => {                 // spd
                return this.expandNestedTable(tbl1, (tbl2, row2) => {                   // kegiatan
                    return this.expandNestedTable(tbl2, (tbl3, row3) => {               // sub kegiatan
                        return this.works([
                            [w => tbl3.findElements(By.xpath('./tbody/tr[@ng-repeat]'))],
                            [w => new Promise((resolve, reject) => {
                                const q = new Queue(w.getRes(0), tr => {
                                    this.works([
                                        [w => this.siap.getText([By.xpath('./td[2]')], tr)],
                                        [w => Promise.resolve(this.pickNumber(w.getRes(0)[0]))],
                                        [w => this.siap.getText([By.xpath('./td[4]')], tr),
                                            w => w.getRes(1) == this.spp.rek],
                                        [w => Promise.resolve(this.pickNumber(w.getRes(2)[0])),
                                            w => w.getRes(1) == this.spp.rek],
                                        [w => Promise.resolve(parseFloat(w.getRes(3))),
                                            w => w.getRes(1) == this.spp.rek],
                                        [w => this.siap.click({el: tr, data: By.xpath('./td[1]/input[@type="checkbox"]')}),
                                            w => w.getRes(1) == this.spp.rek && value > 0 && w.getRes(4) > value],
                                        [w => this.siap.fillFormValue({parent: tr, target: By.xpath('./td[5]/input[@type="text"]'), value: value}),
                                            w => w.getRes(1) == this.spp.rek && value > 0 && w.getRes(4) > value],
                                        [w => Promise.resolve(value = 0),
                                            w => w.getRes(1) == this.spp.rek && value > 0 && w.getRes(4) > value],
                                    ])
                                    .then(() => q.next())
                                    .catch(err => reject(err));
                                });
                                q.once('done', () => resolve());
                            })],
                        ]);
                    }, (row) => {
                        return this.works([
                            [w => this.siap.getText([By.xpath('./td[3]')], row)],
                            [w => Promise.resolve(this.pickNumber(w.getRes(0)[0]))],
                            [w => Promise.resolve(w.getRes(1) == this.spp.keg)],
                        ]);
                    }); // sub kegiatan
                }); // kegiatan
            }, null, true)], // spd
        ]);
    }

    expandNestedTable(table, callback, check = null, reversed = null) {
        return this.works([
            [w => table.findElements(By.xpath('./tbody/tr[@ng-repeat-start]'))],
            [w => new Promise((resolve, reject) => {
                const rows = reversed ? w.getRes(0).reverse() : w.getRes(0);
                const q = new Queue(rows, tr => {
                    const f = () => {
                        this.works([
                            // expand
                            [w => tr.findElement(By.xpath('./td[1]/span'))],
                            [w => this.siap.focusTo(w.getRes(0))],
                            // find table to be expanded
                            [w => tr.findElement(By.xpath('./following-sibling::tr[@ng-repeat-end]/td/table'))],
                            // wait for finish
                            [w => this.waitExpandedRows(w.getRes(2))],
                            // call the callback
                            [w => callback(w.getRes(2), tr)],
                        ])
                        .then(() => q.next())
                        .catch(err => reject(err));
                    }
                    if (typeof check == 'function') {
                        check(tr)
                            .then(result => {
                                if (result) {
                                    f();
                                } else {
                                    q.next();
                                }
                            })
                            .catch(err => reject(err));
                    } else {
                        f();
                    }
                });
                q.once('done', () => resolve());
            })],
        ]);
    }

    waitExpandedRows(table) {
        return this.works([
            [w => table.findElement(By.xpath('./tbody/tr[contains(@ng-show,"length") or contains(@ng-show,"status")]'))],
            [w => this.siap.waitForVisibility(w.getRes(0), false)],
        ]);
    }

    handleFormFill(name, form, queue) {
        const result = [];
        const maps = queue.getMap(name);
        Object.keys(maps).forEach(k => {
            const selector = [];
            const f = this.getFormKey(k);
            let key = f.selector;
            let attr;
            let vtype, vvalue;
            let skey;
            switch (f.prefix) {
                case '#':
                    attr = 'id';
                    break;
                case '=':
                    break;
                default:
                    attr = form ? 'ng-model' : 'name';
                    if (key.indexOf(':') < 0) {
                        key = form ? form + '.' + key : key;
                    }
                    break;
            }
            let value = queue.getMappedData(name + '.' + k);
            // fall back to non mapped value if undefined
            if (value == undefined) {
                if (f.prefix == '*') {
                    throw new Error(`Form ${name}: ${key} value is mandatory`);
                }
                value = maps[k];
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
                    case 'model':
                        attr = 'ng-model';
                        break;
                }
            }
            // handle special value TYPE:value
            if (typeof value == 'string' && value.indexOf(':') > 0) {
                const x = value.split(':');
                vtype = x[0];
                vvalue = x[1];
                switch (vtype) {
                    case 'CHOICE':
                        attr = 'name';
                        key = f.selector;
                        value = true;
                        break;
                    case 'ROLE':
                        const user = this.getUser(vvalue);
                        if (user) {
                            value = user;
                        }
                        break;
                }
            }
            if (f.prefix != '=') {
                selector.push('[@_X_="_Y_"]'.replace(/_X_/, attr).replace(/_Y_/, key));
            }
            // update selector on special case
            if (vtype == 'CHOICE') {
                selector.push('[@data-status="_X_"]'.replace(/_X_/, vvalue));
            }
            // form data
            let data = {
                target: By.xpath(f.prefix == '=' ? key : './/*_X_'.replace(/_X_/, selector.join(''))),
                value: value
            }
            // check form parent
            if (f.parent) {
                if (f.parent.substring(0, 1) == '#') {
                    data.parent = By.id(f.parent.substring(1));
                } else {
                    data.parent = By.xpath(f.parent);
                }
            }
            // handle form rekanan
            if (f.selector == 'kategori') {
                // hack: not a normal select, why?
                data.onfill = (el, value) => this.fillKategoriRekanan(el, value);
            }
            // handle form spp
            if (skey == 'spp') {
                if (this.spp.tgl && this.spp.keg && this.spp.rek && this.spp.nominal) {
                    data = {
                        target: By.xpath('//button[@ng-click="beforePilihSpp()"]'),
                        onfill: (el, value) => this.fillAfektasiSpp(el, value, this.getDate(this.spp.tgl)),
                        value: this.spp.nominal
                    };
                } else {
                    data = null;
                }
            }
            // handle form spm
            if (skey == 'spm') {
                switch (key) {
                    case 'REKENING':
                        data.target = By.xpath(value);
                        data.onfill = (el, value) => this.works([
                            [w => el.click()],
                            [w => this.siap.waitLoader()],
                            [w => this.siap.dismissSwal2('Tutup')],
                        ]);
                        break;
                }
            }
            // form data and handler
            if (data) {
                // handle read operation
                if (f.prefix == '?') {
                    data.onfill = (el, value) => this.works([
                        [w => el.getAttribute('type')],
                        [w => el.getAttribute(w.getRes(0) == 'checkbox' ? 'checked' : 'value')],
                        [w => Promise.resolve(queue[value] = w.getRes(1))],
                    ]);
                }
                // generic date time picker handler
                if (key.indexOf('tanggal') >= 0) {
                    data.value = this.getDate(data.value);
                    data.onfill = (el, value) => this.fillDatePicker(el, value);
                }
                // generic handler of special tag
                if (!data.onfill) {
                    data.canfill = (tag, el, value) => {
                        return new Promise((resolve, reject) => {
                            if (tag == 'searchable-dropdown') {
                                this.fillSearchable(el, value)
                                    .then(() => resolve(true))
                                    .catch(err => reject(err));
                            } else {
                                resolve(false);
                            }
                        });
                    }
                }
                // add waiting
                if (f.prefix == '+') {
                    data.done = (d, next) => {
                        this.siap.waitLoader()
                            .then(() => next())
                            .catch(err => {
                                throw err;
                            });
                    }
                }
                result.push(data);
            }
        });
        return result;
    }

    getFormKey(key) {
        const result = {};
        // check parent
        const part = key.split('!');
        if (part.length > 1) {
            result.parent = part[0];
            key = part[1];
        }
        // check prefixes
        if (['#', '+', '?', '=', '*'].indexOf(key.substring(0, 1)) >= 0) {
            result.prefix = key.substring(0, 1);
            key = key.substring(1);
        }
        result.selector = key;
        return result;
    }

    fillForm(queue, name, form, submit, dismiss = true) {
        return this.works([
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.siap.scrollTo(0)],
            [w => this.siap.fillInForm(
                this.handleFormFill(name, 'formTambah', queue),
                form,
                submit)],
            [w => this.siap.dismissSwal2(), w => dismiss],
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.siap.waitLoader()],
        ]);
    }

    checkRole(queue) {
        return this.works([
            [w => Promise.resolve(queue.getMappedData('info.role'))],
            [w => Promise.reject('Invalid queue, no role specified!'), w => !w.getRes(0)],
            [w => Promise.resolve(this.switchRole(w.getRes(0)))],
        ]);
    }

    isRekananNeeded(queue) {
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_0_wrapper'),
                search: By.xpath('.//input[@ng-model="searchNama"]'),
                pager: By.id('DataTables_Table_0_paginate'),
            })],
            [w => w.getRes(0).search(queue.getMappedData('rekanan.kode'))],
            [w => Promise.resolve(!w.getRes(2))],
        ]);
    }

    checkRekanan(queue) {
        return this.works([
            [w => this.siap.navigateTo('Penatausahaan Pengeluaran', 'Rekanan')],
            [w => this.isRekananNeeded(queue)],
            [w => this.siap.waitAndClick(By.xpath('//button[@ng-click="OpenForm()"]')), w => w.getRes(1)],
            [w => this.fillForm(queue, 'rekanan',
                By.xpath('//form[@ng-submit="TambahRekanan($event)"]'),
                By.xpath('//button[contains(@class,"btnSubmit")]')), w => w.getRes(1)],
        ]);
    }

    isSppNeeded(queue) {
        let result = true;
        const no = queue.getMappedData('spp.spp:NO');
        const tgl = this.getDate(queue.getMappedData('spp.spp:TGL'));
        const nominal = queue.getMappedData('spp.spp:NOMINAL');
        const untuk = queue.getMappedData('spp.keteranganSpp');
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_0_wrapper'),
                search: By.xpath('.//input[@ng-model="searchSppLs"]'),
                pager: By.id('DataTables_Table_0_paginate'),
            })],
            [w => w.getRes(0).search(untuk)],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]'), By.xpath('./td[3]'), By.xpath('./td[4]'), By.xpath('./td[5]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    const noSpp = values[0];
                    const tglSpp = this.getDate(values[1]);
                    const untukSpp = values[2];
                    const nomSpp = parseFloat(this.pickNumber(values[3]));
                    if (no == noSpp || (this.dateSerial(tgl) == this.dateSerial(tglSpp) && nominal == nomSpp && untuk == untukSpp)) {
                        result = false;
                        queue.SPP = noSpp;
                        reject(DataTable.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [ w => Promise.resolve(result)],
        ]);
    }

    checkSpp(queue) {
        return this.works([
            [w => this.siap.navigateTo('Penatausahaan Pengeluaran', 'Pembuatan SPP')],
            [w => this.siap.waitAndClick(By.xpath('//a[@ng-click="getActiveSubTabLs()"]'))],
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.isSppNeeded(queue)],
            [w => this.siap.waitAndFocus(By.xpath('//button[contains(text(),"Buat SPP LS")]')), w => w.getRes(3)],
            [w => this.siap.waitAndClick(By.xpath('//ul/li/a/b[text()="SPP LS"]/..')), w => w.getRes(3)],
            [w => Promise.resolve(this.spp = {}), w => w.getRes(3)],
            [w => this.fillForm(queue, 'spp',
                By.xpath('//form[@ng-submit="beforeSimpanSpp($event)"]'),
                By.xpath('//button[@id="btnSubmitLsBiasa"]')), w => w.getRes(3)],
        ]);
    }

    isSptjmSppNeeded(queue) {
        let result = true;
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_1_wrapper'),
                search: By.xpath('.//input[@ng-model="searchNoSpp"]'),
                pager: By.id('DataTables_Table_1_paginate'),
            })],
            [w => w.getRes(0).search(queue.SPP), w => this.prefilter],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPP == values[0]) {
                        result = false;
                        reject(DataTable.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [ w => Promise.resolve(result)],
        ]);
    }

    createSptjmSpp(queue) {
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_0_wrapper'),
                search: By.xpath('.//input[@ng-model="searchNoSpp"]'),
                pager: By.id('DataTables_Table_0_paginate'),
            })],
            [w => w.getRes(0).search(queue.SPP), w => this.prefilter],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPP == values[0]) {
                        this.works([
                            [y => el.findElement(By.xpath('./td/button[contains(@class,"buat-sptjm")]'))],
                            [y => this.siap.focusTo(y.getRes(0))],
                            [y => this.fillForm(queue, 'sptjm-spp',
                                By.xpath('//form[@ng-submit="TambahSptjmSpp($event)"]'),
                                By.xpath('//button[@id="btnSubmit"]'),
                                false)],
                        ])
                        .then(() => reject(DataTable.stop()))
                        .catch(err => reject(err));
                    } else {
                        resolve();
                    }
                })],
            ])],
        ]);
    }

    checkSptjmSpp(queue) {
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.siap.navigateTo('Penatausahaan Pengeluaran', 'Pembuatan Surat Pernyataan Tanggung Jawab Mutlak (SPTJM) SPP')],
            [w => this.siap.waitAndClick(By.xpath('//a[@ng-click="getDataBatal()"]'))],
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.isSptjmSppNeeded(queue)],
            [w => this.siap.waitAndClick(By.xpath('//a[@ng-click="getDataSudahTerverifikasi()"]')), w => w.getRes(4)],
            [w => this.siap.sleep(this.siap.opdelay), w => w.getRes(4)],
            [w => this.createSptjmSpp(queue), w => w.getRes(4)],
        ]);
    }

    isVerifikasiSppNeeded(queue) {
        let result = true;
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_3_wrapper'),
                search: By.xpath('.//input[@ng-model="searchNoSpp"]'),
                pager: By.id('DataTables_Table_3_paginate'),
            })],
            [w => w.getRes(0).search(queue.SPP), w => this.prefilter],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPP == values[0]) {
                        result = false;
                        reject(DataTable.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [ w => Promise.resolve(result)],
        ]);
    }

    createVerifikasiSpp(queue) {
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_4_wrapper'),
                search: By.xpath('.//input[@ng-model="searchNoSpp"]'),
                pager: By.id('DataTables_Table_4_paginate'),
            })],
            [w => w.getRes(0).search(queue.SPP), w => this.prefilter],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPP == values[0]) {
                        this.works([
                            [y => el.findElement(By.xpath('./td/a[contains(@class,"btn-verifikasi-green")]'))],
                            [y => this.siap.focusTo(y.getRes(0))],
                            [y => this.fillForm(queue, 'verifikasi-spp',
                                By.xpath('//form[@ng-submit="TambahVERSPP($event)"]'),
                                By.xpath('//button[@id="btnSubmitVerif"]'))],
                        ])
                        .then(() => reject(DataTable.stop()))
                        .catch(err => reject(err));
                    } else {
                        resolve();
                    }
                })],
            ])],
        ]);
    }

    checkVerifikasiSpp(queue) {
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.siap.navigateTo('Penatausahaan Pengeluaran', 'Verifikasi SPP')],
            [w => this.siap.waitLoader()],
            [w => this.isVerifikasiSppNeeded(queue)],
            [w => this.siap.waitAndClick(By.xpath('//a[@ng-click="getDataBelumTerverifikasi()"]')), w => w.getRes(3)],
            [w => this.siap.waitLoader(), w => w.getRes(3)],
            [w => this.createVerifikasiSpp(queue), w => w.getRes(3)],
        ]);
    }

    isSpmNeeded(queue) {
        let result = true;
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_0_wrapper'),
                search: By.xpath('.//input[@ng-model="searchSpm"]'),
                pager: By.id('DataTables_Table_0_paginate'),
            })],
            [w => w.getRes(0).search(queue.getMappedData('spp.keteranganSpp'))],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[1]'), By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPP == values[1]) {
                        result = false;
                        queue.SPM = values[0];
                        reject(DataTable.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [ w => Promise.resolve(result)],
        ]);
    }

    createSpm(queue) {
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_6_wrapper'),
                search: By.xpath('.//input[@ng-model="searchSpm"]'),
                pager: By.id('DataTables_Table_6_paginate'),
            })],
            [w => w.getRes(0).search(queue.SPP)],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPP == values[0]) {
                        this.works([
                            [y => el.findElement(By.xpath('./td/input[@ng-click="beforeOpenFormSpmLs(dataSpp)"]'))],
                            [y => this.siap.focusTo(y.getRes(0))],
                            [y => this.fillForm(queue, 'spm',
                                By.xpath('//form[@name="form-input-ls"]'),
                                By.xpath('//button[@id="btnSubmitSpmLsNonGaji"]'))],
                        ])
                        .then(() => reject(DataTable.stop()))
                        .catch(err => reject(err));
                    } else {
                        resolve();
                    }
                })],
            ])],
        ]);
    }

    checkSpm(queue, creator = 'bp') {
        return this.works([
            [w => Promise.reject('SPP belum dibuat!'), w => !queue.SPP],
            [w => this.siap.navigateTo('Penatausahaan Pengeluaran', 'Pembuatan SPM')],
            [w => this.siap.waitLoader()],
            [w => this.isSpmNeeded(queue)],
            [w => this.siap.waitAndClick(By.xpath('//a[@id="tab-list-spm-ls"]')), w => w.getRes(3)],
            [w => this.siap.fillFormValue({target: By.id('btn-select-creator'), value: creator}), w => w.getRes(3)],
            [w => this.siap.sleep(this.siap.opdelay), w => w.getRes(3)],
            [w => this.createSpm(queue), w => w.getRes(3)],
        ]);
    }

    isSptjmSpmNeeded(queue) {
        let result = true;
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_1_wrapper'),
                search: By.xpath('.//input[@ng-model="searchNoSpmHasil"]'),
                pager: By.id('DataTables_Table_1_paginate'),
            })],
            [w => w.getRes(0).search(queue.SPM), w => this.prefilter],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPM == values[0]) {
                        result = false;
                        reject(DataTable.stop());
                    } else {
                        resolve();
                    }
                })],
            ])],
            [ w => Promise.resolve(result)],
        ]);
    }

    createSptjmSpm(queue) {
        return this.works([
            [w => Promise.resolve(new DataTable(this.siap))],
            [w => w.getRes(0).setup({
                wrapper: By.id('DataTables_Table_0_wrapper'),
                search: By.xpath('.//input[@ng-model="searchNoSpm"]'),
                pager: By.id('DataTables_Table_0_paginate'),
            })],
            [w => w.getRes(0).search(queue.SPM), w => this.prefilter],
            [w => w.getRes(0).each(el => [
                [x => this.siap.getText([By.xpath('./td[2]')], el)],
                [x => new Promise((resolve, reject) => {
                    const values = x.getRes(0); 
                    if (queue.SPM == values[0]) {
                        this.works([
                            [y => el.findElement(By.xpath('./td/button[contains(@class,"buat-sptjm")]'))],
                            [y => this.siap.focusTo(y.getRes(0))],
                            [y => this.fillForm(queue, 'sptjm-spm',
                                By.xpath('//form[@ng-submit="TambahSptjmSpm($event)"]'),
                                By.xpath('//button[@id="btnSubmit"]'),
                                false)],
                        ])
                        .then(() => reject(DataTable.stop()))
                        .catch(err => reject(err));
                    } else {
                        resolve();
                    }
                })],
            ])],
        ]);
    }

    checkSptjmSpm(queue) {
        return this.works([
            [w => Promise.reject('SPM belum dibuat!'), w => !queue.SPM],
            [w => this.siap.navigateTo('Penatausahaan Pengeluaran', 'Pembuatan Surat Pernyataan Tanggung Jawab Mutlak (SPTJM) SPM')],
            [w => this.siap.waitAndClick(By.xpath('//a[@ng-click="getDataBatal()"]'))],
            [w => this.siap.sleep(this.siap.opdelay)],
            [w => this.isSptjmSpmNeeded(queue)],
            [w => this.siap.waitAndClick(By.xpath('//a[@ng-click="getDataSudahTerverifikasi()"]')), w => w.getRes(4)],
            [w => this.siap.sleep(this.siap.opdelay), w => w.getRes(4)],
            [w => this.createSptjmSpm(queue), w => w.getRes(4)],
        ]);
    }

    createSpp(queue) {
        return this.do([
            // switch role
            [w => this.checkRole(queue)],
            // --- BPP ---
            [w => this.doAs(this.ROLE_BPP)],
            [w => this.checkRekanan(queue)],
            [w => this.checkSpp(queue)],
            // --- KPA ---
            [w => this.doAs(this.ROLE_KPA)],
            [w => this.checkSptjmSpp(queue)],
            // --- PPK ---
            [w => this.doAs(this.ROLE_PPK)],
            [w => this.checkVerifikasiSpp(queue)],
            [w => this.checkSpm(queue)],
            // --- KPA ---
            [w => this.doAs(this.ROLE_KPA)],
            [w => this.checkSptjmSpm(queue)],
            // result
            [ w => new Promise((resolve, reject) => {
                if (queue.SPP && queue.callback) {
                    const callbackQueue = SiapQueue.createCallbackQueue({id: queue.getMappedData('info.id'), spp: queue.SPP}, queue.callback);
                    SiapQueue.addQueue(callbackQueue);
                }
                resolve(queue.SPP ? queue.SPP : false);
            })],
        ]);
    }
}

module.exports = SiapBridge;