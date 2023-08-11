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

const WebRobot = require('@ntlab/webrobot');
const { By, error } = require('selenium-webdriver');

class Siap extends WebRobot {

    initialize() {
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.daerah = this.options.daerah;
        this.year = this.options.year || new Date().getFullYear();
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
                            [w => el.findElement(By.xpath('./../span[contains(@class,"select2")]'))],
                            [w => w.res.click()],
                            [w => this.findElement(By.xpath('//span[@class="select2-results"]/ul/li[contains(text(),_X_)]'.replace(/_X_/, this.escapeStr(value))))],
                            [w => w.res.click()],
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
            [w => this.waitAndClick(By.xpath('//button[@type="button"][contains(@class,"swal2-confirm")][contains(text(),' + this.escapeStr(caption) + ')]'))],
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

module.exports = Siap;