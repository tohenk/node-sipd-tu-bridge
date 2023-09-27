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
const WebRobot = require('@ntlab/webrobot');
const { By, error } = require('selenium-webdriver');

class Siap extends WebRobot {

    initialize() {
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.daerah = this.options.daerah;
        this.year = this.options.year || new Date().getFullYear();
        WebRobot.expectErr(SiapAnnouncedError);
    }

    stop() {
        return this.works([
            [w => this.close()],
            [w => new Promise((resolve, reject) => setTimeout(() => resolve(), this.opdelay))],
        ]);
    }

    isLoggedIn() {
        return this.works([
            [w => this.findElements(By.id('loginForm'))],
            [w => Promise.resolve(w.getRes(0).length > 0 ? false : true)],
        ]);
    }

    login(username, password) {
        return this.works([
            [w => this.isLoggedIn()],
            [w => this.logout(), w => w.getRes(0)],
            [w => this.waitFor(By.id('loginForm'))],
            [w => this.fillInForm([
                    {parent: w.res, target: By.name('userName'), value: username},
                    {parent: w.res, target: By.name('password'), value: password},
                    {parent: w.res, target: By.name('tahunanggaran'), value: this.year},
                    {parent: w.res, target: By.name('idDaerah'), value: this.daerah, onfill: (el, value) => {
                        return this.works([
                            [x => el.findElement(By.xpath('./../span[contains(@class,"select2")]'))],
                            [x => x.res.click()],
                            [x => this.findElements(By.xpath('//span[@class="select2-results"]/ul/li[contains(text(),_X_)]'.replace(/_X_/, this.escapeStr(value))))],
                            [x => Promise.reject(SiapAnnouncedError.create(`Tidak dapat login, instansi ${value} tidak tersedia!`)), x => !x.getRes(2).length],
                            [x => x.getRes(2)[0].click(), x => x.getRes(2).length],
                        ]);
                    }},
                ],
                By.id('loginForm'),
                By.xpath('//button[@type="submit"]'))],
            [w => this.waitLoader()],
        ]);
    }

    logout() {
        return this.works([
            [w => this.findElement(By.xpath('//ul/li/a[contains(@class,"profile-header")]'))],
            [w => w.getRes(0).click()],
            [w => w.getRes(0).findElement(By.xpath('./../ul/li/a/span[text()="Logout"]'))],
            [w => this.waitForVisibility(w.getRes(2), true)],
            [w => w.getRes(2).click()],
        ]);
    }

    navigateTo(category, title) {
        return this.works([
            [w => this.findElement(By.xpath('//nav/ul/li/a/span[text()=_X_]/..'.replace(/_X_/, this.escapeStr(category))))],
            [w => this.focusTo(w.getRes(0))],
            [w => this.sleep(this.opdelay)],
            [w => w.getRes(0).findElement(By.xpath('./../ul/li/a/span[text()=_X_]/..'.replace(/_X_/, this.escapeStr(title))))],
            [w => this.focusTo(w.getRes(3))],
            [w => this.waitLoader()],
        ]);
    }

    waitAndFocus(data) {
        return this.works([
            [w => this.waitFor(data)],
            [w => this.focusTo(w.getRes(0))],
        ]);
    }

    focusTo(el, click = true) {
        return this.works([
            [w => this.waitForVisibility(el, true)],
            [w => el.getRect()],
            [w => this.scrollTo(w.getRes(1).y)],
            [w => el.click(), w => click],
        ]);
    }

    scrollTo(top) {
        return this.getDriver().executeScript(`
let top = ${top};
let wtop = window.scrollY;
let wbottom = wtop + window.innerHeight;
let header = document.getElementById('header');
if (header) {
    top -= header.clientHeight;
    wtop += header.clientHeight;
}
if (top < wtop || top > wbottom) {
    window.scrollTo(0, top);
}
`
        );
    }

    addPadding(el, padding = 'p-5') {
        return this.getDriver().executeScript(`$(arguments[0]).removeClass('pull-right').addClass('${padding}')`, el);
    }

    waitLoader() {
        return this.works([
            [w => this.waitFor(By.xpath('//div[contains(@class,"loader")]'))],
            [w => this.waitForVisibility(w.getRes(0), false)],
            [w => this.sleep(this.opdelay)],
        ]);
    }

    waitForVisibility(el, visible = true) {
        return new Promise((resolve, reject) => {
            const f = () => {
                el.isDisplayed()
                    .then(result => {
                        if (result != visible) {
                            setTimeout(f, 500);
                        } else {
                            resolve();
                        }
                    })
                    .catch(err => {
                        if (err instanceof error.StaleElementReferenceError) {
                            if (!visible) {
                                return resolve();
                            }
                        }
                        reject(err);
                    });
            }
            f();
        });
    }

    waitSwal2() {
        return this.waitFor(By.xpath('//div[contains(@class,"swal2-container")]'));
    }

    dismissSwal2(caption = 'OK') {
        return this.works([
            [w => this.waitSwal2()],
            [w => this.getSwal2Message()],
            [w => this.getSwal2Icon()],
            [w => this.waitAndClick(By.xpath('//button[@type="button"][contains(@class,"swal2-confirm")][contains(text(),' + this.escapeStr(caption) + ')]'))],
            [w => Promise.resolve([w.getRes(1), w.getRes(2)])],
        ]);
    }

    getSwal2Icon() {
        return this.works([
            [w => this.findElements(By.xpath('//div[contains(@class,"swal2-icon")]'))],
            [w => new Promise((resolve, reject) => {
                let icon;
                const q = new Queue(w.getRes(0), el => {
                    this.works([
                        [x => el.getAttribute('class')],
                        [x => el.isDisplayed()],
                        [x => Promise.resolve(icon = 'error'), x => x.getRes(1) && x.getRes(0).indexOf('swal2-error') > 0],
                        [x => Promise.resolve(icon = 'question'), x => x.getRes(1) && x.getRes(0).indexOf('swal2-question') > 0],
                        [x => Promise.resolve(icon = 'warning'), x => x.getRes(1) && x.getRes(0).indexOf('swal2-warning') > 0],
                        [x => Promise.resolve(icon = 'info'), x => x.getRes(1) && x.getRes(0).indexOf('swal2-info') > 0],
                        [x => Promise.resolve(icon = 'success'), x => x.getRes(1) && x.getRes(0).indexOf('swal2-success') > 0],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve(icon));
            })]
        ]);
    }

    getSwal2Message() {
        return this.works([
            [w => this.findElement(By.xpath('//div[@class="swal2-content"]'))],
            [w => w.getRes(0).getAttribute('innerText')],
        ]);
    }

    // https://stackoverflow.com/questions/642125/encoding-xpath-expressions-with-both-single-and-double-quotes
    escapeStr(s) {
        // does not contain double quote
        if (s.indexOf('"') < 0) {
            return '"' + s + '"';
        }
        // does not contain single quote
        if (s.indexOf('\'') < 0) {
            return '\'' + s + '\'';
        }
        // contains both, escape single quote
        return 'concat(\'' + s.replace(/'/g, '\', "\'", \'') + '\')';
    }
}

class SiapAnnouncedError extends Error {

    toString() {
        return this.message;
    }

    [util.inspect.custom](depth, options, inspect) {
        return this.toString();
    }

    static create(message, queue = null) {
        const err = new SiapAnnouncedError(message);
        if (queue) {
            err._queue = queue;
        }
        return err;
    }
}

module.exports = {Siap, SiapAnnouncedError};